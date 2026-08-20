import type { HttpClient } from '../http';
import type { Lyric, Playlist, PlatformAdapter, QualityOption, SongUrl, Track } from '../types';
import { parseLrc } from '../parsers/lyricParser';
import { mapKugouMobileTrack, mapKugouTrack } from './mappers';

/**
 * 酷狗适配器：主要承担「兜底搜歌」角色（SongResolver 二级检索）。
 * searchSongs 按关键词检索；fetchSongUrl 通过 play/getdata 拿到直链。
 */
export class KugouAdapter implements PlatformAdapter {
  readonly platform = 'kugou' as const;

  constructor(private http: HttpClient) {}

  async fetchPlaylist(specialId: string): Promise<Playlist> {
    const data = await this.http.requestJson<{
      data?: { info?: Array<Record<string, any>> };
    }>(
      `https://mobilecdn.kugou.com/api/v3/special/song?specialid=${encodeURIComponent(specialId)}&page=1&pagesize=100&plat=0&version=9000`,
      { platform: 'kugou' },
    );
    const list = data?.data?.info ?? [];
    if (!list.length) throw new Error('酷狗歌单不存在或已失效');
    return {
      id: specialId,
      platform: 'kugou',
      name: `酷狗歌单 ${specialId}`,
      cover: '',
      tracks: list.map(mapKugouMobileTrack).filter((t): t is Track => !!t),
    };
  }

  async searchSongs(keyword: string, pageSize = 10): Promise<Track[]> {
    try {
      const data = await this.http.requestJson<{
        data?: { lists?: Array<Record<string, any>> };
      }>(
        `https://songsearch.kugou.com/song_search_v2?keyword=${encodeURIComponent(keyword)}&page=1&pagesize=${pageSize}&platform=WebFilter&tag=em&filter=2&iscorrection=1&privilege_filter=0`,
        { platform: 'kugou' },
      );
      return (data?.data?.lists ?? []).map(mapKugouTrack).filter((t): t is Track => !!t);
    } catch (err) {
      console.warn('[KugouAdapter] 搜索失败:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  async fetchSongUrl(hash: string, albumId?: string, _quality?: string): Promise<SongUrl | null> {
    try {
      const data = await this.http.requestJson<{
        data?: { play_url?: string; quality?: string };
      }>(
        `https://wwwapi.kugou.com/yy/index.php?r=play/getdata&hash=${encodeURIComponent(hash)}${albumId ? `&album_id=${encodeURIComponent(albumId)}` : ''}&mid=${encodeURIComponent(String(Math.floor(Math.random() * 1e10)))}&platid=4`,
        { platform: 'kugou' },
      );
      const url = data?.data?.play_url;
      if (!url) {
        return { url: '', playable: false, trial: false, error: '酷狗取链失败（无播放地址）' };
      }
      return { url: url.replace(/^http:/, 'https:'), quality: data?.data?.quality ?? '' };
    } catch (err) {
      console.warn('[KugouAdapter] 取流失败:', err instanceof Error ? err.message : err);
      return { url: '', playable: false, trial: false, error: '酷狗取链失败（接口异常）' };
    }
  }

  async listQualities(): Promise<QualityOption[]> {
    return [{ level: 'auto', label: '标准' }];
  }

  /**
   * 歌词获取：krcs 双接口为主（search -> download，支持逐字 LRC），
   * m.kugou.com krc.php 为兜底（纯行级 LRC）。
   */
  async fetchLyric(hash: string, timeMs?: number): Promise<Lyric | null> {
    // 1) krcs 双接口（主链）
    try {
      const duration = timeMs ? Math.round(timeMs / 1000) : 0;
      const searchUrl = `https://krcs.kugou.com/search?ver=1&man=yes&client=pc&keyword=&duration=${duration}&hash=${encodeURIComponent(hash)}&album_audio_id=`;
      const searchData = await this.http.requestJson<{ candidates?: Array<{ id: string; accesskey: string }> }>(searchUrl, { platform: 'kugou' });
      const candidate = searchData?.candidates?.[0];
      if (candidate?.id && candidate?.accesskey) {
        const dlUrl = `https://krcs.kugou.com/download?ver=1&client=pc&id=${encodeURIComponent(candidate.id)}&accesskey=${encodeURIComponent(candidate.accesskey)}&fmt=lrc&charset=utf8`;
        const dlData = await this.http.requestJson<{ content?: string }>(dlUrl, { platform: 'kugou' });
        let raw = dlData?.content ?? '';
        // krcs 返回 content 可能为 base64 编码
        if (raw && !raw.includes('[offset=') && !raw.includes('[00:')) {
          try { raw = Buffer.from(raw, 'base64').toString('utf-8'); } catch { /* 非 base64 */ }
        }
        if (raw && (raw.includes('[offset=') || raw.includes('[00:'))) {
          return { lines: parseLrc(raw), raw, source: 'kugou' };
        }
      }
    } catch (err) {
      console.warn('[KugouAdapter] krcs 歌词搜索失败:', err instanceof Error ? err.message : err);
    }
    // 2) m.kugou.com krc.php（兜底）
    try {
      const raw = await this.http.requestText(
        `https://m.kugou.com/app/i/krc.php?cmd=100&hash=${encodeURIComponent(hash)}${timeMs ? `&timelength=${Math.round(timeMs)}` : ''}`,
        { platform: 'kugou' },
      );
      if (!raw || raw.includes('<')) return null;
      return { lines: parseLrc(raw), raw, source: 'kugou' };
    } catch (err) {
      console.warn('[KugouAdapter] krc.php 歌词兜底失败:', err instanceof Error ? err.message : err);
      return null;
    }
  }
}
