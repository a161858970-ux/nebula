import type { HttpClient } from '../http';
import type {
  AlbumSummary,
  ArtistSearchHit,
  ArtistInfo,
  CommentResult,
  Lyric,
  Playlist,
  PlatformAdapter,
  QualityOption,
  SongDetail,
  SongUrl,
  Track,
} from '../types';
import type { CookieStore } from '../cookieStore';
import { mergeLyric, normalizeJsonLrc } from '../parsers/lyricParser';
import { mapNeteaseTrack } from './mappers';
import { callNcmSafe } from '../ncm/ncmApi';

interface NeteasePlaylistResp {
  playlist?: {
    id?: number | string;
    name?: string;
    coverImgUrl?: string;
    description?: string;
    tracks?: Array<Record<string, any>>;
    trackIds?: Array<{ id?: number | string }>;
  };
}

const PLACEHOLDER_URL = /music\.163\.com\/song\/media/;

const QUALITY_DEFS: Array<QualityOption & { prefix: string }> = [
  { level: 'jymaster', label: '臻品母带', prefix: 'jymaster', needsSvip: true },
  { level: 'sky', label: '臻品全景声', prefix: 'sky', needsSvip: true },
  { level: 'hires', label: 'Hi-Res', prefix: 'hires', needsVip: true },
  { level: 'lossless', label: '无损', prefix: 'lossless', needsVip: true },
  { level: 'exhigh', label: '极高', prefix: 'exhigh' },
  { level: 'standard', label: '标准', prefix: 'standard' },
];

/**
 * Netease adapter (fetch URL / lyric via the mature @neteasecloudmusicapienhanced/api;
 * playlist / search / comments via plain web endpoints).
 *
 * Multi-quality fetch:
 * 1) song_url_v1 filtered by account rights (jymaster/sky need SVIP; hires/lossless need VIP);
 * 2) all v1 fail -> song_url with br 320k -> 192k -> 128k;
 * 3) freeTrialInfo marks trial; all failures return an explicit error.
 */
export class NeteaseAdapter implements PlatformAdapter {
  readonly platform = 'netease' as const;

  /** Account rights cache (5 minutes). */
  private rightsCache: { at: number; isVip: boolean; isSvip: boolean } | null = null;

  constructor(
    private http: HttpClient,
    private cookies: CookieStore,
  ) {}

  async fetchPlaylist(playlistId: string): Promise<Playlist> {
    const data = await this.http.requestJson<NeteasePlaylistResp>(
      `https://music.163.com/api/v6/playlist/detail?id=${encodeURIComponent(playlistId)}&limit=1000&offset=0`,
      { platform: 'netease' },
    );
    const pl = data.playlist;
    if (!pl) {
      throw new Error('playlist not found, deleted, or requires login (cookie)');
    }
    let tracks = (pl.tracks ?? [])
      .map(mapNeteaseTrack)
      .filter((t): t is NonNullable<typeof t> => !!t);

    // v6 endpoint returns only 10 tracks by default: backfill the full playlist via trackIds.
    const trackIds = pl.trackIds ?? [];
    if (tracks.length < trackIds.length) {
      const extra: Track[] = [];
      for (let i = tracks.length; i < trackIds.length; i += 100) {
        const chunk = trackIds.slice(i, i + 100).map((t) => t.id);
        if (!chunk.length) break;
        const c = JSON.stringify(chunk.map((id) => ({ id })));
        const detail = await this.http.requestJson<{ songs?: Array<Record<string, any>> }>(
          `https://music.163.com/api/v3/song/detail?c=${encodeURIComponent(c)}`,
          { platform: 'netease' },
        );
        extra.push(...(detail?.songs ?? []).map(mapNeteaseTrack).filter((t): t is Track => !!t));
      }
      if (extra.length) tracks = [...tracks, ...extra];
    }

    return {
      id: String(pl.id ?? playlistId),
      platform: 'netease',
      name: pl.name ?? '未命名歌单',
      cover: pl.coverImgUrl ?? '',
      description: pl.description,
      tracks,
    };
  }

  async fetchSongUrl(songId: string, _albumId?: string, quality?: string): Promise<SongUrl | null> {
    const cookie = this.cookies.getHeader('netease') ?? '';
    const rights = await this.getRights();
    const allowed = this.allowedLevels(rights);
    const levels = this.orderByPreference(allowed, quality);

    for (const level of levels) {
      const res = await callNcmSafe('song_url_v1', { id: songId, level, cookie });
      const item = res?.body?.data?.[0] as
        | { url?: string; level?: string; freeTrialInfo?: { startTime?: number; endTime?: number } }
        | undefined;
      const url = item?.url;
      if (url && !PLACEHOLDER_URL.test(url)) {
        return {
          url: url.replace(/^http:/, 'https:'),
          quality: item.level ?? level,
          level: item.level ?? level,
          playable: true,
          trial: !!item.freeTrialInfo,
          trialEndTime: item.freeTrialInfo?.endTime,
        };
      }
    }

    for (const br of ['320000', '192000', '128000']) {
      const res = await callNcmSafe('song_url', { id: songId, br, cookie });
      const item = res?.body?.data?.[0] as
        | { url?: string; freeTrialInfo?: { startTime?: number; endTime?: number }; br?: number }
        | undefined;
      const url = item?.url;
      if (url && !PLACEHOLDER_URL.test(url)) {
        return {
          url: url.replace(/^http:/, 'https:'),
          quality: `${Math.round((item.br ?? Number(br)) / 1000)}k`,
          playable: true,
          trial: !!item.freeTrialInfo,
          trialEndTime: item.freeTrialInfo?.endTime,
        };
      }
    }

    return {
      url: '',
      playable: false,
      trial: false,
      error: 'no playable source (may be unavailable, removed, or needs higher membership)',
    };
  }

  /** Quality options allowed by the current account rights. */
  async listQualities(): Promise<QualityOption[]> {
    const rights = await this.getRights();
    const allowed = this.allowedLevels(rights);
    return QUALITY_DEFS.filter((d) => allowed.includes(d.level)).map(({ prefix: _p, ...d }) => d);
  }

  /** Current account rights (not logged in = normal user). */
  private async getRights(): Promise<{ isVip: boolean; isSvip: boolean }> {
    const now = Date.now();
    if (this.rightsCache && now - this.rightsCache.at < 5 * 60 * 1000) {
      return { isVip: this.rightsCache.isVip, isSvip: this.rightsCache.isSvip };
    }
    let rights = { isVip: false, isSvip: false };
    try {
      const res = await callNcmSafe('user_account', { cookie: this.cookies.getHeader('netease') ?? '' });
      const vipType = (res?.body?.profile as { vipType?: number } | undefined)?.vipType ?? 0;
      rights = { isVip: vipType > 0, isSvip: vipType >= 11 };
    } catch {
      /* not logged in or API error -> normal rights */
    }
    this.rightsCache = { at: now, ...rights };
    return rights;
  }

  private allowedLevels(rights: { isVip: boolean; isSvip: boolean }): string[] {
    const all = QUALITY_DEFS.map((d) => d.level);
    return all.filter((l) => {
      if (l === 'jymaster' || l === 'sky') return rights.isSvip;
      if (l === 'hires' || l === 'lossless') return rights.isVip;
      return true;
    });
  }

  /** Move the user-preferred quality to the front of the try order. */
  private orderByPreference(allowed: string[], quality?: string): string[] {
    if (!quality || !allowed.includes(quality)) return allowed;
    return [quality, ...allowed.filter((l) => l !== quality)];
  }

  /**
   * Lyric: 优先 lyric_new（带 yrc/ytlrc 逐字歌词），不够再补 lyric（普通 LRC）。
   * 返回统一结构：lrc/tlyric/romalrc 为普通 LRC，yrc/ytlrc 为逐字原始文本。
   */
  async fetchLyric(songId: string): Promise<Lyric | null> {
    const cookie = this.cookies.getHeader('netease') ?? '';
    let lrc = '';
    let tlyric = '';
    let romalrc = '';
    let yrc = '';
    let ytlrc = '';
    try {
      // 1) lyric_new：逐字歌词（yrc/ytlrc），lrc 可能是新版 JSON-Lines
      const nr = await callNcmSafe('lyric_new', { id: songId, cookie });
      const nb = nr?.body as Record<string, any> | undefined;
      if (nb) {
        yrc = nb.yrc?.lyric ?? '';
        ytlrc = nb.ytlrc?.lyric ?? '';
        lrc = normalizeJsonLrc(nb.lrc?.lyric ?? '');
        tlyric = normalizeJsonLrc(nb.tlyric?.lyric ?? '');
        romalrc = normalizeJsonLrc(nb.romalrc?.lyric ?? '');
      }
    } catch (err) {
      console.warn('[NeteaseAdapter] lyric_new failed:', err instanceof Error ? err.message : err);
    }
    try {
      // 2) lyric：普通 LRC 补充（lyric_new 缺失时兜底）
      const r = await callNcmSafe('lyric', { id: songId, cookie });
      const rb = r?.body as Record<string, any> | undefined;
      if (rb) {
        if (!lrc) lrc = rb.lrc?.lyric ?? '';
        if (!tlyric) tlyric = rb.tlyric?.lyric ?? '';
        if (!romalrc) romalrc = rb.romalrc?.lyric ?? '';
      }
    } catch (err) {
      console.warn('[NeteaseAdapter] lyric failed:', err instanceof Error ? err.message : err);
    }
    if (!lrc && !yrc && !tlyric) return null;
    return {
      lines: mergeLyric(lrc, tlyric),
      raw: lrc,
      translationRaw: tlyric,
      romanRaw: romalrc,
      source: 'netease',
      lrc,
      tlyric,
      romalrc,
      yrc,
      ytlrc,
    };
  }

  /** Keyword search (for cross-platform fallback). */
  async searchSongs(keyword: string, pageSize = 10): Promise<Track[]> {
    try {
      const data = await this.http.requestJson<{
        result?: { songs?: Array<Record<string, any>> };
      }>(
        `https://music.163.com/api/search/get/web?s=${encodeURIComponent(keyword)}&type=1&offset=0&limit=${pageSize}`,
        { platform: 'netease' },
      );
      return (data?.result?.songs ?? []).map(mapNeteaseTrack).filter((t): t is Track => !!t);
    } catch (err) {
      console.warn('[NeteaseAdapter] search failed:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  async searchArtists(keyword: string, pageSize = 5): Promise<ArtistSearchHit[]> {
    try {
      const data = await this.http.requestJson<{
        result?: { artists?: Array<Record<string, any>> };
      }>(
        `https://music.163.com/api/search/get/web?s=${encodeURIComponent(keyword)}&type=100&offset=0&limit=${pageSize}`,
        { platform: 'netease' },
      );
      return (data?.result?.artists ?? [])
        .map((a) => ({
          platform: 'netease' as const,
          id: String(a.id),
          name: String(a.name ?? ''),
          avatar: a.img1v1Url || a.picUrl || '',
        }))
        .filter((a) => a.id && a.name);
    } catch (err) {
      console.warn('[NeteaseAdapter] searchArtists failed:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  async fetchComments(songId: string): Promise<CommentResult | null> {
    try {
      const data = await this.http.requestJson<{
        hotComments?: Array<Record<string, any>>;
        comments?: Array<Record<string, any>>;
      }>(
        `https://music.163.com/api/v1/resource/comments/R_SO_4_${encodeURIComponent(songId)}?limit=20&offset=0`,
        { platform: 'netease' },
      );
      const map = (list: Array<Record<string, any>> | undefined) =>
        (list ?? []).map((c) => ({
          id: String(c.commentId ?? c.user?.userId ?? ''),
          nickname: c.user?.nickname ?? '匿名用户',
          avatarUrl: c.user?.avatarUrl ?? '',
          content: c.content ?? '',
          likedCount: c.likedCount ?? 0,
        }));
      return { hot: map(data?.hotComments), latest: map(data?.comments) };
    } catch (err) {
      console.warn('[NeteaseAdapter] comments failed:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  async fetchSongDetail(songId: string): Promise<SongDetail | null> {
    try {
      const res = await callNcmSafe('song_detail', {
        ids: songId,
        cookie: this.cookies.getHeader('netease') ?? '',
      });
      const s = res?.body?.songs?.[0] as Record<string, any> | undefined;
      if (!s) return null;
      return {
        platform: 'netease',
        title: s.name ?? '',
        artists: (s.ar ?? []).map((a: Record<string, any>) => ({ id: String(a.id ?? ''), name: a.name ?? '' })),
        album: {
          id: String(s.al?.id ?? ''),
          name: s.al?.name ?? '',
          cover: s.al?.picUrl ?? '',
          publishDate: s.publishTime ? new Date(s.publishTime).toISOString().slice(0, 10) : undefined,
        },
        duration: s.dt ? Math.round(s.dt / 1000) : undefined,
      };
    } catch {
      return null;
    }
  }

  async fetchArtistInfo(artistId: string): Promise<ArtistInfo | null> {
    try {
      const cookie = this.cookies.getHeader('netease') ?? '';
      const res = await callNcmSafe('artist_detail', { id: artistId, cookie });
      const artist = res?.body?.data?.artist as Record<string, any> | undefined;
      if (!artist) return null;
      const desc = await callNcmSafe('artist_desc', { id: artistId, cookie });
      return {
        platform: 'netease',
        id: String(artist.id ?? artistId),
        name: artist.name ?? '',
        avatar: artist.picUrl ?? artist.img1v1Url ?? '',
        description: desc?.body?.briefDesc || undefined,
      };
    } catch {
      return null;
    }
  }

  async fetchArtistSongs(artistId: string): Promise<Track[]> {
    try {
      const res = await callNcmSafe('artist_songs', {
        id: artistId,
        limit: 50,
        offset: 0,
        cookie: this.cookies.getHeader('netease') ?? '',
      });
      return (res?.body?.songs ?? [] as Array<Record<string, any>>)
        .map(mapNeteaseTrack)
        .filter((t: Track | null): t is Track => !!t);
    } catch {
      return [];
    }
  }

  async fetchArtistAlbums(artistId: string): Promise<AlbumSummary[]> {
    try {
      const res = await callNcmSafe('artist_album', {
        id: artistId,
        limit: 50,
        offset: 0,
        cookie: this.cookies.getHeader('netease') ?? '',
      });
      return (res?.body?.hotAlbums ?? []).map((a: Record<string, any>) => ({
        platform: 'netease' as const,
        id: String(a.id ?? ''),
        name: a.name ?? '',
        cover: a.picUrl ?? '',
        year: a.publishTime ? new Date(a.publishTime).getFullYear() : undefined,
        songCount: a.size,
      }));
    } catch {
      return [];
    }
  }
}
