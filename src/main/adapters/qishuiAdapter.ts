import type { HttpClient } from '../http';
import type { Lyric, Playlist, PlatformAdapter, QualityOption, SongUrl, Track } from '../types';
import { parseLrc } from '../parsers/lyricParser';

/**
 * 汽水音乐适配器（阶段 0：仅歌词；登录/取链/歌单留阶段 1-2）。
 * 歌词三源兜底：
 *   1) beta-luna.douyin.com SEO（免登录，原生逐字）
 *   2) /luna/pc/track_v2（登录态，阶段 2 再接入）
 *   3) api-vehicle.volcengine.com 公开目录（免登录）
 */
export class QishuiAdapter implements PlatformAdapter {
  readonly platform = 'qishui' as const;

  constructor(private http: HttpClient) {}

  async fetchPlaylist(_playlistId: string): Promise<Playlist> {
    throw new Error('汽水歌单功能暂未实现（需要登录态，阶段 2 接入）');
  }

  async searchSongs(_keyword: string, _pageSize?: number): Promise<Track[]> {
    // 阶段 0 不实现搜索；后续走 /luna/pc/search/track
    return [];
  }

  async fetchSongUrl(_songId: string, _albumId?: string, _quality?: string): Promise<SongUrl | null> {
    throw new Error('汽水取链功能暂未实现（需要登录态 + 音频解密，阶段 2 接入）');
  }

  async listQualities(): Promise<QualityOption[]> {
    return [];
  }

  /**
   * 歌词三源兜底：SEO → track_v2（登录态，阶段 2） → volcengine 公开目录。
   * @param trackId 汽水歌曲 ID（纯数字）
   */
  async fetchLyric(trackId: string): Promise<Lyric | null> {
    // 1) SEO seo_track（免登录，原生逐字，首选）
    try {
      const seoUrl = `https://beta-luna.douyin.com/luna/h5/seo_track?id=${trackId}`;
      const seoData = await this.http.requestJson<{
        lyric_text?: string;
        translated_lyric?: string;
      }>(seoUrl, {
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
        };
      }
    } catch (err) {
      console.warn('[QishuiAdapter] SEO 歌词失败:', err instanceof Error ? err.message : err);
    }

    // 2) /luna/pc/track_v2（登录态，阶段 2 再接入）
    // TODO: 阶段 2 实现 — 需要登录 cookie

    // 3) volcengine 公开目录（免登录，仅元数据/歌词）
    try {
      const volUrl = `https://api-vehicle.volcengine.com/v2/custom/contents?sources=qishui&need_author=true&need_album=true&need_ugc=true&need_stat=true&item_ids=${trackId}`;
      const volData = await this.http.requestJson<{
        data?: Array<{
          lyric_text?: string;
          translated_lyric?: string;
          title?: string;
        }>;
      }>(volUrl, {
        platform: 'qishui',
        headers: {
          'User-Agent': 'Mineradio/2.1.0 (Qishui public catalog bridge)',
        },
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
}
