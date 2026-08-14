import type { HttpClient } from '../http';
import type { CookieStore } from '../cookieStore';
import type { CommentResult, Lyric, Playlist, PlatformAdapter, QualityOption, SongUrl, Track } from '../types';
import { mergeLyric } from '../parsers/lyricParser';
import { mapQQTrack } from './mappers';

function decodeMaybeBase64(s: string): string {
  if (!s) return '';
  try {
    if (/^[A-Za-z0-9+/=\s]+$/.test(s) && s.length > 40) {
      const decoded = Buffer.from(s, 'base64').toString('utf-8');
      if (decoded.includes('[')) return decoded;
    }
  } catch {
    /* not base64, return as-is */
  }
  return s;
}

interface QqPlaylistResp {
  cdlist?: Array<{
    disstid?: number | string;
    dissname?: string;
    logo?: string;
    desc?: string;
    songlist?: Array<Record<string, any>>;
  }>;
}

/** QQ quality tiers: filename prefix + label. */
const QQ_QUALITY_TIERS: Array<{ level: string; label: string; prefix: string }> = [
  { level: 'flac', label: '无损 FLAC', prefix: 'F000' },
  { level: '320k', label: 'HQ 320k', prefix: 'M800' },
  { level: '128k', label: '标准 128k', prefix: 'M500' },
];

function qqErrorMessage(code: number | undefined): string {
  switch (code) {
    case 1901:
      return 'QQ 需要登录（缺少有效登录票据）';
    case 20003:
    case 202:
      return 'QQ 该歌曲需要会员或无版权';
    default:
      return `QQ 取链失败（code=${code ?? 'unknown'}）`;
  }
}

/**
 * QQ music adapter:
 * - playlist: qzone fcg;
 * - audio: mobile express + musicu.fcg, multi-quality (flac/320k/128k);
 * - failures return explicit errors (never a silent empty url);
 * - keyword search supports cross-platform fallback.
 */
export class QqAdapter implements PlatformAdapter {
  readonly platform = 'qq' as const;

  constructor(
    private http: HttpClient,
    private cookies: CookieStore,
  ) {}

  async fetchPlaylist(playlistId: string): Promise<Playlist> {
    const data = await this.http.requestJson<QqPlaylistResp>(
      `https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&disstid=${encodeURIComponent(playlistId)}&format=json&g_tk=5381`,
      { platform: 'qq' },
    );
    const cd = data?.cdlist?.[0];
    if (!cd || !Array.isArray(cd.songlist)) {
      throw new Error('QQ 歌单不存在或已失效');
    }
    return {
      id: String(cd.disstid ?? playlistId),
      platform: 'qq',
      name: cd.dissname ?? '未命名歌单',
      cover: cd.logo ?? '',
      description: cd.desc,
      tracks: cd.songlist.map(mapQQTrack).filter((t): t is NonNullable<typeof t> => !!t),
    };
  }

  async fetchSongUrl(songmid: string, _albumId?: string, quality?: string): Promise<SongUrl | null> {
    const cookie = this.cookies.getHeader('qq') ?? '';
    const uin = cookie.match(/(?:^|;\s*)uin=o?(\d+)/)?.[1] ?? '';

    // Preferred tier first, then remaining tiers; express endpoint per tier.
    const tiers = [...QQ_QUALITY_TIERS].sort((a, b) => {
      if (quality === a.level) return -1;
      if (quality === b.level) return 1;
      return 0;
    });
    const lastErr: string[] = [];

    for (const tier of tiers) {
      try {
        const guid = String(Math.floor(Math.random() * 1e10));
        const filename = `${tier.prefix}${songmid}.${tier.level === 'flac' ? 'flac' : 'mp3'}`;
        const data = await this.http.requestJson<{ vkey?: string; sip?: string[] }>(
          `https://c.y.qq.com/qqmusicopenapi/fcgi-bin/fcg_music_express_mobile3.fcg?format=json&platform=yqq.json&cid=205361747&songmid=${encodeURIComponent(songmid)}&filename=${filename}&guid=${guid}`,
          { platform: 'qq', cookie },
        );
        const vkey = data?.vkey;
        const sip = data?.sip?.[0];
        if (!vkey || !sip) throw new Error('express no vkey/sip');
        return {
          url: `${sip}${filename}?vkey=${vkey}&guid=${guid}&uin=${uin || '0'}&fromtag=66`,
          quality: tier.level,
          playable: true,
        };
      } catch (err) {
        lastErr.push(`express(${tier.level}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Fallback: musicu.fcg with login cookie (C400 m4a).
    try {
      const guid = String(Math.floor(Math.random() * 1e10));
      const payload = JSON.stringify({
        req_0: {
          module: 'vkey.GetVkeyServer',
          method: 'CgiGetVkey',
          param: { guid, songmid: [songmid], songtype: [0], uin: uin || '0', loginflag: 1, platform: '20' },
        },
      });
      const data = await this.http.requestJson<{
        req_0?: { code?: number; data?: { sip?: string[]; midurlinfo?: Array<{ purl?: string }> } };
      }>(`https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&data=${encodeURIComponent(payload)}`, {
        platform: 'qq',
        cookie,
      });
      const purl = data?.req_0?.data?.midurlinfo?.[0]?.purl;
      const sip = data?.req_0?.data?.sip?.[0];
      if (purl && sip) {
        return { url: `${sip}${purl}`, quality: '128k', playable: true };
      }
      throw new Error(qqErrorMessage(data?.req_0?.code));
    } catch (err) {
      lastErr.push(`musicu: ${err instanceof Error ? err.message : String(err)}`);
    }

    return {
      url: '',
      playable: false,
      trial: false,
      error: `QQ 取链失败（${lastErr.join('；') || '未知原因'}）`,
    };
  }

  async listQualities(): Promise<QualityOption[]> {
    return QQ_QUALITY_TIERS.map(({ level, label }) => ({ level, label }));
  }

  /** QQ keyword search (for SongResolver / LyricService fallback). */
  async searchSongs(keyword: string, pageSize = 10): Promise<Track[]> {
    try {
      const data = await this.http.requestJson<{
        data?: { song?: { list?: Array<Record<string, any>> } };
      }>(
        `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w=${encodeURIComponent(keyword)}&t=0&p=1&n=${pageSize}&format=json&inCharset=utf-8&outCharset=utf-8&cr=1`,
        { platform: 'qq' },
      );
      return (data?.data?.song?.list ?? []).map(mapQQTrack).filter((t): t is Track => !!t);
    } catch (err) {
      console.warn('[QqAdapter] search failed:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  /**
   * QQ 逐字歌词：music.musichallSong.PlayLyricInfo/GetPlayLyricInfo
   * 返回 lyric(LRC) / trans / roma / qrc（均可能 base64），qrc 作为字级歌词返回，
   * 前端会把 qrc 映射进 yrc 统一走 parseYrcText。
   */
  async fetchLyric(songmid: string): Promise<Lyric | null> {
    const decode = (s: unknown): string =>
      typeof s === 'string' && s ? Buffer.from(s, 'base64').toString('utf-8') : '';
    try {
      const data = await this.http.requestJson<{
        req_0?: {
          code?: number;
          data?: { lyric?: string; trans?: string; roma?: string; qrc?: string };
        };
      }>('https://u.y.qq.com/cgi-bin/musicu.fcg', {
        platform: 'qq',
        method: 'POST',
        body: {
          req_0: {
            module: 'music.musichallSong.PlayLyricInfo',
            method: 'GetPlayLyricInfo',
            param: { songMID: songmid },
          },
        },
      });
      const d = data?.req_0?.data;
      if (d) {
        const lrc = decode(d.lyric);
        const tlyric = decode(d.trans);
        const roma = decode(d.roma);
        const qrc = decode(d.qrc);
        if (lrc || qrc) {
          return {
            lines: mergeLyric(lrc, tlyric),
            raw: lrc,
            translationRaw: tlyric,
            romanRaw: roma,
            source: 'qq',
            lrc,
            tlyric,
            romalrc: roma,
            qrc,
          };
        }
      }
    } catch (err) {
      console.warn('[QqAdapter] PlayLyricInfo failed:', err instanceof Error ? err.message : err);
    }
    try {
      const data = await this.http.requestJson<{ lyric?: string; trans?: string }>(
        `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(songmid)}&format=json&nobase64=1`,
        { platform: 'qq' },
      );
      const raw = decodeMaybeBase64(data?.lyric ?? '');
      if (!raw) return null;
      const trans = decodeMaybeBase64(data?.trans ?? '');
      return { lines: mergeLyric(raw, trans), raw, translationRaw: trans, source: 'qq', lrc: raw, tlyric: trans };
    } catch (err) {
      console.warn('[QqAdapter] lyric failed:', err instanceof Error ? err.message : err);
      return null;
    }
  }

  async fetchComments(songmid: string): Promise<CommentResult | null> {
    try {
      const data = await this.http.requestJson<{
        hot_comment?: { commentlist?: Array<Record<string, any>> };
        new_comment?: { commentlist?: Array<Record<string, any>> };
      }>(
        `https://c.y.qq.com/base/fcgi-bin/fcg_global_comment_h5.fcg?g_tk=5381&loginUin=0&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0&cid=205360772&reqtype=2&biztype=1&topid=${encodeURIComponent(songmid)}&cmd=8&needmusiccrit=0&pagenum=0&pagesize=25&domain=qq.com&ct=24`,
        { platform: 'qq' },
      );
      const map = (list: Array<Record<string, any>> | undefined) =>
        (list ?? []).map((c) => ({
          id: String(c.commentid ?? ''),
          nickname: c.nick ?? c.rootcommentnick ?? '匿名用户',
          avatarUrl: c.avatarurl ?? c.rootcommentavatar ?? '',
          content: c.rootcommentcontent ?? '',
          likedCount: c.rootcommentlikenum ?? 0,
        }));
      return {
        hot: map(data?.hot_comment?.commentlist),
        latest: map(data?.new_comment?.commentlist),
      };
    } catch (err) {
      console.warn('[QqAdapter] comments failed:', err instanceof Error ? err.message : err);
      return null;
    }
  }
}
