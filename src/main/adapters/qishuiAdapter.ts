import type { HttpClient } from '../http';
import type { CookieStore } from '../cookieStore';
import type { Lyric, Playlist, PlaylistSummary, PlatformAdapter, QualityOption, SongUrl, Track } from '../types';
import { parseLrc } from '../parsers/lyricParser';

const PC_APP_PARAMS: Record<string, string> = {
  aid: '386088',
  app_name: 'luna_pc',
  region: 'cn',
  geo_region: 'cn',
  os_region: 'cn',
  channel: 'official',
  build_mode: 'master',
  ac: 'wifi',
  tz_name: 'Asia/Shanghai',
  device_platform: 'windows',
  device_type: 'Windows',
  os_version: 'Windows 11',
};

function pcParams(extra: Record<string, string> = {}): Record<string, string> {
  const now = String(Date.now());
  return {
    ...PC_APP_PARAMS,
    device_id: now,
    cdid: '',
    iid: String(Number(now) + 1),
    version_name: '3.3.0',
    version_code: '30030000',
    fp: now,
    ...extra,
  };
}

function pcHeaders(cookie?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Accept': 'application/json,text/plain,*/*',
    'User-Agent': 'LunaPC/3.3.0(359450208)',
    'x-luna-background-type': 'foreground',
    'x-luna-is-background-req': '0',
    'x-luna-is-local-user': '1',
  };
  if (cookie) headers.Cookie = cookie;
  return headers;
}

/** 汽水音质等级 */
const QISHUI_QUALITY_TIERS: Array<{ level: string; label: string }> = [
  { level: 'hires', label: 'Hi-Res' },
  { level: 'lossless', label: '无损 FLAC' },
  { level: 'exhigh', label: '极高 320k' },
  { level: 'standard', label: '标准 128k' },
];

/** 汽水封面 URL 补全：urls[0] 常为占位 base（如 .../img/），需拼接 uri + 尺寸后缀。 */
function qishuiCoverUrl(cover: any, suffix = ''): string {
  if (!cover) return '';
  if (typeof cover === 'string') {
    return /^https?:\/\//i.test(cover) ? (suffix && !cover.includes('~') ? cover + suffix : cover) : '';
  }
  if (Array.isArray(cover)) {
    for (const item of cover) {
      const url = qishuiCoverUrl(item, suffix);
      if (url) return url;
    }
    return '';
  }
  if (typeof cover !== 'object') return '';
  const urls = cover.urls || cover.url_list || cover.urlList || [];
  const uri = String(cover.uri || cover.url_key || cover.image_uri || cover.cover_uri || '');
  let out = Array.isArray(urls) ? String(urls[0] || '') : '';
  if (out && uri && !out.includes(uri)) out += uri;
  if (!out && /^https?:\/\//i.test(uri)) out = uri;
  if (!/^https?:\/\//i.test(out)) return '';
  // 用户上传图（tos-cn-i- 前缀）无法无签名拼接，视为不可用（fallback 到歌曲封面）
  if (/tos-cn-i-/.test(uri)) return '';
  return suffix && !out.includes('~') ? out + suffix : out;
}

/** 封面是否可用（占位/不可拼接的返回 false）。 */
function coverUsable(coverUrl: string): boolean {
  return !!coverUrl && /^https?:\/\//i.test(coverUrl) && !/\/img\/$/.test(coverUrl);
}

export class QishuiAdapter implements PlatformAdapter {
  readonly platform = 'qishui' as const;

  constructor(
    private http: HttpClient,
    private cookies: CookieStore,
  ) {}

  /** 获取登录 cookie */
  private getCookie(): string {
    return this.cookies.getHeader('qishui') || '';
  }

  /** PC API 请求（带 cookie + PC 参数） */
  private async pcRequest<T>(apiPath: string, params: Record<string, string> = {}, cookie?: string): Promise<T> {
    const qs = Object.entries({ ...pcParams(), ...params })
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
    const url = `https://api.qishui.com${apiPath}?${qs}`;
    return this.http.requestJson<T>(url, {
      platform: 'qishui',
      headers: pcHeaders(cookie || this.getCookie()),
    });
  }

  /** 搜索歌曲（PC 搜索优先，公开搜索兜底） */
  async searchSongs(keyword: string, pageSize = 10): Promise<Track[]> {
    // 1) PC 搜索（需 cookie）
    const cookie = this.getCookie();
    if (cookie) {
      try {
        const data = await this.pcRequest<any>('/luna/pc/search/track', {
          q: keyword,
          cursor: '0',
          count: String(pageSize),
          search_method: 'input',
        }, cookie);
        const groups = data?.data?.result_groups || [];
        const items: any[] = [];
        for (const group of groups) {
          const groupData = group?.data || group?.items || group?.list;
          if (Array.isArray(groupData)) items.push(...groupData);
        }
        if (items.length) {
          return items.slice(0, pageSize).map((item: any) => this.mapTrack(item)).filter(Boolean) as Track[];
        }
      } catch (err) {
        console.warn('[QishuiAdapter] PC 搜索失败:', err instanceof Error ? err.message : err);
      }
    }

    // 2) 公开搜索（免登录）
    try {
      const url = `https://api-vehicle.volcengine.com/v2/search/type?keyword=${encodeURIComponent(keyword)}&search_type=music&limit=${pageSize}&real_offset=0&search_source=qishui`;
      const data = await this.http.requestJson<any>(url, {
        platform: 'qishui',
        headers: { 'User-Agent': 'Mineradio/2.1.0 (Qishui public catalog bridge)' },
      });
      const list = data?.data?.list || [];
      return list.map((item: any) => this.mapPublicTrack(item)).filter(Boolean) as Track[];
    } catch (err) {
      console.warn('[QishuiAdapter] 公开搜索失败:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  /** 获取歌单详情 */
  async fetchPlaylist(playlistId: string): Promise<Playlist> {
    const cookie = this.getCookie();
    if (!cookie) throw new Error('汽水歌单需要登录');
    const json = await this.pcRequest<any>('/luna/pc/playlist/detail', {
      playlist_id: playlistId,
      cursor: '0',
      count: '300',
    }, cookie);
    // 实测结构：顶层 playlist + media_resources[].entity.track_wrapper.track
    const playlist = json?.playlist || json?.data?.playlist || {};
    const resources: any[] = json?.media_resources || json?.data?.media_resources || [];
    const allTracks: Track[] = [];
    for (const r of resources) {
      const t = this.mapTrack(r?.entity?.track_wrapper?.track || r?.track || r);
      if (t) allTracks.push(t);
    }
    // 分页拉全（has_more + next_cursor），与其它平台一致
    let cursor = String(json?.next_cursor || '');
    while (json?.has_more && cursor && allTracks.length < 2000) {
      const page = await this.pcRequest<any>('/luna/pc/playlist/detail', {
        playlist_id: playlistId,
        cursor,
        count: '100',
      }, cookie);
      const pageResources: any[] = page?.media_resources || [];
      for (const r of pageResources) {
        const t = this.mapTrack(r?.entity?.track_wrapper?.track || r?.track || r);
        if (t) allTracks.push(t);
      }
      cursor = String(page?.next_cursor || '');
      if (!page?.has_more) break;
    }
    let cover = qishuiCoverUrl(playlist.url_cover || playlist.cover, '~c5_300x300.jpg');
    if (!coverUsable(cover) && allTracks[0]?.cover) cover = allTracks[0]!.cover;
    return {
      id: playlistId,
      platform: 'qishui',
      name: playlist.title || playlist.name || '汽水歌单',
      cover,
      tracks: allTracks,
    };
  }

  /** 获取播放 URL（多音质） */
  async fetchSongUrl(songId: string, _albumId?: string, quality?: string, _extra?: Record<string, unknown>): Promise<SongUrl | null> {
    const cookie = this.getCookie();
    if (!cookie) throw new Error('汽水取链需要登录');

    const data = await this.pcRequest<any>('/luna/pc/track_v2', {
      track_id: songId,
      media_type: 'track',
    }, cookie);

    const track = data?.data?.track || data?.data?.track_info || {};
    const audioInfo = track.audio_info || {};
    const playInfoList = audioInfo.play_info_list || [];

    // 选择最佳音质
    const streams = playInfoList.map((info: any) => ({
      url: info.play_url || info.url || '',
      quality: info.quality || info.format || '',
      bitrate: Number(info.bitrate) || 0,
      size: Number(info.file_size) || 0,
    })).filter((s: any) => s.url);

    // 按音质排序
    const targetQuality = quality || 'standard';
    const sorted = streams.sort((a: any, b: any) => {
      const aIdx = QISHUI_QUALITY_TIERS.findIndex(t => t.level === a.quality);
      const bIdx = QISHUI_QUALITY_TIERS.findIndex(t => t.level === b.quality);
      const targetIdx = QISHUI_QUALITY_TIERS.findIndex(t => t.level === targetQuality);
      return Math.abs(aIdx - targetIdx) - Math.abs(bIdx - targetIdx);
    });

    const best = sorted[0];
    if (!best?.url) return null;

    return {
      url: best.url,
      quality: best.quality || targetQuality,
      level: best.quality || targetQuality,
      playable: true,
    };
  }

  /** 获取用户歌单列表 */
  async fetchMyPlaylists(): Promise<PlaylistSummary[]> {
    const cookie = this.getCookie();
    if (!cookie) return [];

    const playlists: PlaylistSummary[] = [];

    // 1) 我的歌单（实测：/luna/pc/me/playlist，顶层 playlists 数组）
    try {
      const data = await this.pcRequest<any>('/luna/pc/me/playlist', {
        cursor: '0',
        count: '100',
      }, cookie);
      const items = data?.playlists || data?.data?.playlists || [];
      for (const pl of items) {
        playlists.push({
          id: String(pl.id || pl.playlist_id || ''),
          name: pl.title || pl.name || '我的歌单',
          cover: qishuiCoverUrl(pl.url_cover || pl.cover, '~c5_300x300.jpg'),
          trackCount: Number(pl.count_tracks || pl.track_count || pl.song_count || 0),
        });
      }
      // 封面不可用的歌单（用户自定义图）→ 异步拉详情取第一首歌封面
      await Promise.all(
        playlists
          .filter((p) => !coverUsable(p.cover))
          .slice(0, 8)
          .map(async (p) => {
            try {
              const detail = await this.pcRequest<any>('/luna/pc/playlist/detail', {
                playlist_id: p.id,
                cursor: '0',
                count: '1',
              }, cookie);
              const res = detail?.media_resources?.[0]?.entity?.track_wrapper?.track;
              const first = res ? this.mapTrack(res) : null;
              if (first?.cover) p.cover = first.cover;
            } catch {
              /* 封面兜底失败不阻塞 */
            }
          }),
      );
    } catch (err) {
      console.warn('[QishuiAdapter] 我的歌单获取失败:', err instanceof Error ? err.message : err);
    }

    // 2) 收藏歌单
    try {
      const data = await this.pcRequest<any>('/luna/pc/me/collection/mixed', {
        cursor: '0',
        count: '50',
      }, cookie);
      const items = data?.playlists || data?.data?.playlists || [];
      for (const pl of items) {
        if (!playlists.some(p => p.id === String(pl.id || pl.playlist_id))) {
          playlists.push({
            id: String(pl.id || pl.playlist_id || ''),
            name: pl.title || pl.name || '收藏歌单',
            cover: qishuiCoverUrl(pl.url_cover || pl.cover, '~c5_300x300.jpg'),
            trackCount: Number(pl.count_tracks || pl.track_count || pl.song_count || 0),
          });
        }
      }
    } catch (err) {
      console.warn('[QishuiAdapter] 收藏歌单获取失败:', err instanceof Error ? err.message : err);
    }

    return playlists;
  }

  /** 获取可用音质列表 */
  async listQualities(): Promise<QualityOption[]> {
    return QISHUI_QUALITY_TIERS.map(t => ({
      level: t.level,
      label: t.label,
    }));
  }

  /** 歌词三源兜底 */
  async fetchLyric(trackId: string): Promise<Lyric | null> {
    // 1) SEO seo_track（免登录，原生逐字，首选）
    try {
      const seoUrl = `https://beta-luna.douyin.com/luna/h5/seo_track?id=${trackId}`;
      const seoData = await this.http.requestJson<any>(seoUrl, {
        platform: 'qishui',
        headers: { Referer: 'https://www.qishui.com/' },
      });
      const lrc = seoData?.lyric_text;
      if (lrc) {
        return {
          lines: parseLrc(lrc),
          raw: lrc,
          source: 'qishui',
          lrc,
          tlyric: seoData?.translated_lyric || undefined,
          translationRaw: seoData?.translated_lyric || undefined,
          yrc: seoData?.lyric_text || undefined,
        };
      }
    } catch (err) {
      console.warn('[QishuiAdapter] SEO 歌词失败:', err instanceof Error ? err.message : err);
    }

    // 2) /luna/pc/track_v2（登录态）
    const cookie = this.getCookie();
    if (cookie) {
      try {
        const data = await this.pcRequest<any>('/luna/pc/track_v2', {
          track_id: trackId,
          media_type: 'track',
        }, cookie);
        const track = data?.data?.track || data?.data?.track_info || {};
        const lyricInfo = track.lyric_info || {};
        const lrc = lyricInfo.lyric_text || lyricInfo.content || '';
        if (lrc) {
          return {
            lines: parseLrc(lrc),
            raw: lrc,
            source: 'qishui',
            lrc,
            tlyric: lyricInfo.translated_lyric || undefined,
            translationRaw: lyricInfo.translated_lyric || undefined,
            yrc: lrc,
          };
        }
      } catch (err) {
        console.warn('[QishuiAdapter] track_v2 歌词失败:', err instanceof Error ? err.message : err);
      }
    }

    // 3) volcengine 公开目录（免登录）
    try {
      const volUrl = `https://api-vehicle.volcengine.com/v2/custom/contents?sources=qishui&need_author=true&need_album=true&need_ugc=true&need_stat=true&item_ids=${trackId}`;
      const volData = await this.http.requestJson<any>(volUrl, {
        platform: 'qishui',
        headers: { 'User-Agent': 'Mineradio/2.1.0 (Qishui public catalog bridge)' },
      });
      const item = volData?.data?.[0];
      const lrc = item?.lyric_text;
      if (lrc) {
        return {
          lines: parseLrc(lrc),
          raw: lrc,
          source: 'qishui',
          lrc,
          tlyric: item?.translated_lyric || undefined,
          translationRaw: item?.translated_lyric || undefined,
        };
      }
    } catch (err) {
      console.warn('[QishuiAdapter] volcengine 歌词失败:', err instanceof Error ? err.message : err);
    }

    return null;
  }

  /** 映射 PC API 歌曲 */
  private mapTrack(item: any): Track | null {
    try {
      const id = String(item.id || item.track_id || '');
      if (!id) return null;
      const title = item.title || item.name || '';
      const artists = (item.artists || item.singers || [])
        .map((a: any) => a.name || a.artist_name || '')
        .filter(Boolean);
      const artist = artists.join(' / ') || item.artist || '';
      const album = item.album?.name || item.album_name || '';
      const cover = qishuiCoverUrl(item.album?.url_cover || item.album?.cover || item.cover, '~c5_300x300.jpg');
      const duration = Number(item.duration || item.duration_ms || 0);
      return {
        id: `qishui:${id}`,
        title,
        artist,
        artists,
        album,
        cover,
        duration: duration > 1000 ? Math.round(duration / 1000) : duration,
        platform: 'qishui',
        sourceId: id,
        originalUrl: '',
        fallbackUrl: '',
      };
    } catch {
      return null;
    }
  }

  /** 映射公开搜索歌曲 */
  private mapPublicTrack(item: any): Track | null {
    try {
      const id = String(item.id || '');
      if (!id) return null;
      return {
        id: `qishui:${id}`,
        title: item.title || item.name || '',
        artist: item.author || item.artist || '',
        artists: item.artists?.map((a: any) => a.name || '') || [],
        album: item.album?.name || '',
        cover: item.cover?.url_list?.[0] || '',
        duration: Number(item.duration || 0),
        platform: 'qishui',
        sourceId: id,
        originalUrl: '',
        fallbackUrl: '',
      };
    } catch {
      return null;
    }
  }
}
