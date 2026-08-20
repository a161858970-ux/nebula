import type { AdapterMap } from '../adapters/index';
import type {
  AlbumSummary,
  ArtistInfo,
  ArtistSearchHit,
  CommentResult,
  Lyric,
  Platform,
  SongDetail,
  Track,
} from '../types';
import { creditsFromLrc, mergeLyric } from '../parsers/lyricParser';
import { matchScore } from './songResolver';
import { LyricCache } from './lyricCache';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 歌词/评论统一入口：平台失败返回 null，不向上抛错。 */
export class LyricService {
  constructor(
    private adapters: AdapterMap,
    private cache?: LyricCache,
  ) {}

  async fetchLyric(track: Track): Promise<Lyric | null> {
    // 1) 磁盘缓存
    if (this.cache) {
      const cached = this.cache.get(track.platform, track.sourceId);
      if (cached) return cached;
    }
    try {
      let lyric: Lyric | null = null;
      if (track.platform === 'kugou') {
        lyric = await this.adapters.kugou.fetchLyric(
          track.sourceId,
          track.duration ? track.duration * 1000 : undefined,
        );
      } else {
        lyric = await this.adapters[track.platform].fetchLyric(track.sourceId);
      }
      if (!lyric) lyric = await this.fallbackLyric(track);
      if (lyric) {
        lyric = await this.enrichFromNetease(track, lyric);
        this.cache?.set(track.platform, track.sourceId, lyric);
      }
      return lyric;
    } catch (err) {
      console.warn('[LyricService] 歌词获取失败:', errMsg(err));
      return this.fallbackLyric(track);
    }
  }

  /**
   * 非网易源增强：
   * - 缺翻译 → 网易云搜同名歌补 tlyric/ytlrc（按时间轴合并进 lines）；
   * - 缺逐字（QQ 无 qrc）→ 从网易云补 yrc，前端统一按字高亮。
   */
  private async enrichFromNetease(track: Track, lyric: Lyric): Promise<Lyric> {
    if (lyric.source === 'netease') return lyric;
    const hasWord = !!lyric.yrc || !!lyric.qrc;
    const hasTrans = !!lyric.translationRaw || !!lyric.ytlrc;
    if (hasWord && hasTrans) return lyric;
    try {
      const netease = this.adapters.netease;
      if (!netease.searchSongs) return lyric;
      const keyword = `${track.title} ${track.artist}`.trim();
      const candidates = await netease.searchSongs(keyword, 5);
      const scored = candidates
        .map((c) => ({ c, score: matchScore(c, track) }))
        .filter((x) => x.score >= 0.5)
        .sort((a, b) => b.score - a.score);
      for (const { c } of scored.slice(0, 2)) {
        const nl = await netease.fetchLyric(c.sourceId);
        if (!nl) continue;
        const patch: Partial<Lyric> = {};
        if (!hasTrans && nl.tlyric) {
          const merged = mergeLyric(lyric.lrc ?? lyric.raw, nl.tlyric);
          if (merged.some((l) => l.translation)) {
            patch.lines = merged;
            patch.tlyric = nl.tlyric;
            patch.translationRaw = nl.tlyric;
          }
        }
        if (!hasWord && nl.yrc) {
          patch.yrc = nl.yrc;
          if (nl.ytlrc) patch.ytlrc = nl.ytlrc;
        }
        if (Object.keys(patch).length) {
          return { ...lyric, ...patch };
        }
      }
    } catch (err) {
      console.warn('[LyricService] 翻译补全失败:', errMsg(err));
    }
    return lyric;
  }

  /** 主源失败 → 用 title+artist 到 QQ/酷狗搜索匹配并取歌词。 */
  private async fallbackLyric(track: Track): Promise<Lyric | null> {
    const keyword = `${track.title} ${track.artist}`.trim();
    const sources = [this.adapters.qq, this.adapters.kugou, this.adapters.qishui];
    for (const source of sources) {
      if (!source.searchSongs) continue;
      try {
        const candidates = await source.searchSongs(keyword, 8);
        const scored = candidates
          .map((c) => ({ c, score: matchScore(c, track) }))
          .filter((x) => x.score >= 0.5)
          .sort((a, b) => b.score - a.score);
        for (const { c } of scored.slice(0, 2)) {
          const lyric = await source.fetchLyric(c.sourceId, c.duration ? c.duration * 1000 : undefined);
          if (lyric?.raw) {
            console.log(`[LyricService] 兜底命中《${c.title}》@${source.platform}`);
            return { ...lyric, source: source.platform, lrc: lyric.raw };
          }
        }
      } catch (err) {
        console.warn(`[LyricService] 兜底歌词失败 @${source.platform}:`, errMsg(err));
      }
    }
    return null;
  }

  async fetchComments(track: Track): Promise<CommentResult | null> {
    try {
      const fn = this.adapters[track.platform].fetchComments;
      return fn ? await fn.call(this.adapters[track.platform], track.sourceId) : null;
    } catch (err) {
      console.warn('[LyricService] 评论获取失败:', errMsg(err));
      return null;
    }
  }

  async fetchSongDetail(track: Track): Promise<SongDetail | null> {
    try {
      const adapter = this.adapters[track.platform];
      let detail = adapter.fetchSongDetail ? await adapter.fetchSongDetail(track.sourceId) : null;
      if (detail && !detail.credits?.length) {
        const lyric = await this.fetchLyric(track);
        if (lyric?.lrc) detail = { ...detail, credits: creditsFromLrc(lyric.lrc) };
      }
      return detail;
    } catch (err) {
      console.warn('[LyricService] 歌曲详情失败:', errMsg(err));
      return null;
    }
  }

  async fetchArtistInfo(platform: Platform, artistId: string): Promise<ArtistInfo | null> {
    try {
      const adapter = this.adapters[platform];
      return adapter.fetchArtistInfo ? await adapter.fetchArtistInfo(artistId) : null;
    } catch (err) {
      console.warn('[LyricService] 歌手信息失败:', errMsg(err));
      return null;
    }
  }

  async fetchArtistSongs(platform: Platform, artistId: string): Promise<Track[]> {
    try {
      const adapter = this.adapters[platform];
      return adapter.fetchArtistSongs ? await adapter.fetchArtistSongs(artistId) : [];
    } catch (err) {
      console.warn('[LyricService] 歌手歌曲失败:', errMsg(err));
      return [];
    }
  }

  async fetchArtistAlbums(platform: Platform, artistId: string): Promise<AlbumSummary[]> {
    try {
      const adapter = this.adapters[platform];
      return adapter.fetchArtistAlbums ? await adapter.fetchArtistAlbums(artistId) : [];
    } catch (err) {
      console.warn('[LyricService] 歌手专辑失败:', errMsg(err));
      return [];
    }
  }

  /** 全网搜歌：网易云 + QQ（酷狗兜底），按页容量裁剪、去重。 */
  async searchSongs(keyword: string, pageSize = 8): Promise<Track[]> {
    const per = Math.max(2, Math.ceil(pageSize / 2));
    const out: Track[] = [];
    const seen = new Set<string>();
    const push = (t: Track) => {
      const key = `${t.platform}:${t.sourceId}`;
      if (seen.has(key)) return;
      seen.add(key);
      out.push(t);
    };
    const sources = [this.adapters.netease, this.adapters.qq, this.adapters.kugou];
    await Promise.all(
      sources.map(async (adapter) => {
        if (!adapter.searchSongs) return;
        try {
          const list = await adapter.searchSongs(keyword, per);
          list.forEach(push);
        } catch (err) {
          console.warn('[LyricService] searchSongs', adapter.platform, errMsg(err));
        }
      }),
    );
    return out.slice(0, pageSize);
  }

  /** 全网搜歌手：网易云 + QQ。 */
  async searchArtists(keyword: string, pageSize = 5): Promise<ArtistSearchHit[]> {
    const per = Math.max(2, Math.ceil(pageSize / 2));
    const out: ArtistSearchHit[] = [];
    const seen = new Set<string>();
    const sources = [this.adapters.netease, this.adapters.qq];
    await Promise.all(
      sources.map(async (adapter) => {
        if (!adapter.searchArtists) return;
        try {
          const list = await adapter.searchArtists(keyword, per);
          for (const hit of list) {
            const key = `${hit.platform}:${hit.id}`;
            if (seen.has(key)) continue;
            seen.add(key);
            out.push(hit);
          }
        } catch (err) {
          console.warn('[LyricService] searchArtists', adapter.platform, errMsg(err));
        }
      }),
    );
    return out.slice(0, pageSize);
  }
}
