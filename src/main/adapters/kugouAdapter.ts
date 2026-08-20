import crypto from 'node:crypto';
import type { HttpClient } from '../http';
import type { CookieStore } from '../cookieStore';
import type { Lyric, Playlist, PlaylistSummary, PlatformAdapter, QualityOption, SongUrl, Track } from '../types';
import { parseLrc } from '../parsers/lyricParser';
import { mapKugouMobileTrack, mapKugouTrack } from './mappers';

// --- 签名常量 ---
const H5_SALT = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt';
const ANDROID_SALT = 'OIlwieks28dk2k092lksi2UIkp';
const SIGN_KEY_SALT = '57ae12eb6890223e355ccfcb74edf70d';
const H5_SRC_APPID = 2919;
const H5_CLIENTVER = 20000;
const ANDROID_APPID = 1005;
const ANDROID_CLIENTVER = 20489;
const ANDROID_UA = 'Android15-1070-11083-46-0-DiscoveryDRADProtocol-wifi';

function md5(s: string): string {
  return crypto.createHash('md5').update(s).digest('hex');
}

/** H5 签名：md5(H5_SALT + sorted k=v + H5_SALT) */
function h5Sign(params: Record<string, string>): string {
  const sorted = Object.keys(params).sort().map(k => k + '=' + params[k]).join('&');
  return md5(H5_SALT + sorted + H5_SALT);
}

/** Android 签名：md5(ANDROID_SALT + sorted k=v + body + ANDROID_SALT) */
function androidSign(params: Record<string, string>, body: string): string {
  const sorted = Object.keys(params).sort().map(k => k + '=' + params[k]).join('&');
  return md5(ANDROID_SALT + sorted + body + ANDROID_SALT);
}

/** mobile 云 key：md5(hash + 'kgcloud') */
function mobileKey(hash: string): string {
  return md5(hash + 'kgcloud');
}

interface VipStatus {
  isVip: boolean;
  isSvip: boolean;
  expireTime: number;
  probedAt: number;
}

interface UrlCacheEntry {
  url: string;
  quality: string;
  expireAt: number;
}

const VIP_TTL_MS = 5 * 60 * 1000;
const URL_CACHE_TTL_MS = 10 * 60 * 1000;

export class KugouAdapter implements PlatformAdapter {
  readonly platform = 'kugou' as const;

  private vipCache: VipStatus | null = null;
  private urlCache = new Map<string, UrlCacheEntry>();

  constructor(
    private http: HttpClient,
    private cookies: CookieStore,
  ) {}

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

  /** VIP 探测：登录后调用一次，缓存 5 分钟。 */
  async probeVip(): Promise<VipStatus> {
    if (this.vipCache && Date.now() - this.vipCache.probedAt < VIP_TTL_MS) {
      return this.vipCache;
    }
    const cookie = this.cookies.getHeader('kugou');
    if (!cookie) {
      const anon: VipStatus = { isVip: false, isSvip: false, expireTime: 0, probedAt: Date.now() };
      this.vipCache = anon;
      return anon;
    }
    try {
      const ts = Math.floor(Date.now() / 1000);
      const data = await this.http.requestJson<{
        data?: { is_vip?: number; is_svip?: number; vip_expire_time?: number };
      }>(
        `https://vip.kugou.com/recharge/roleinfo?n=${ts}`,
        {
          platform: 'kugou',
          headers: {
            'X-Requested-With': 'XMLHttpRequest',
            Referer: 'https://vip.kugou.com/',
          },
        },
      );
      const d = data?.data;
      const result: VipStatus = {
        isVip: d?.is_vip === 1 || d?.is_svip === 1,
        isSvip: d?.is_svip === 1,
        expireTime: d?.vip_expire_time ?? 0,
        probedAt: Date.now(),
      };
      this.vipCache = result;
      return result;
    } catch (err) {
      console.warn('[KugouAdapter] VIP 探测失败:', err instanceof Error ? err.message : err);
      const fallback: VipStatus = { isVip: false, isSvip: false, expireTime: 0, probedAt: Date.now() };
      this.vipCache = fallback;
      return fallback;
    }
  }

  private getCacheKey(hash: string): string {
    const rec = this.cookies.get('kugou');
    const userid = this.extractCookieValue(rec?.cookies, 'KugooID') || '0';
    const token = this.extractCookieValue(rec?.cookies, 't') || '';
    return `${userid}:${token}:${hash}`;
  }

  private extractCookieValue(cookie: string | undefined | null, name: string): string {
    if (!cookie) return '';
    for (const seg of cookie.split(';')) {
      const [k, v] = seg.trim().split('=');
      if (k === name) return v || '';
    }
    return '';
  }

  /**
   * 四路取链：hash 质量链（Res→SQ→HQ→File）× 四路（H5→Mobile→Web→Gateway）
   * H5 为主路径，音质受限时逐路降级补偿。
   */
  async fetchSongUrl(hash: string, albumId?: string, quality?: string, extra?: Record<string, unknown>): Promise<SongUrl | null> {
    // 构建 hash 候选链（质量从高到低）
    const candidates: string[] = [];
    if (extra?.resHash && extra.resHash !== hash) candidates.push(extra.resHash as string);
    if (extra?.sqHash && extra.sqHash !== hash) candidates.push(extra.sqHash as string);
    if (extra?.hqHash && extra.hqHash !== hash) candidates.push(extra.hqHash as string);
    candidates.push(hash);

    const cookie = this.cookies.getHeader('kugou') || '';
    const rec = this.cookies.get('kugou');
    const userid = this.extractCookieValue(rec?.cookies, 'userid') || '';
    const token = this.extractCookieValue(rec?.cookies, 't') || '';
    const mid = this.extractCookieValue(cookie, 'kg_mid') || String(Math.floor(Math.random() * 1e10));
    const dfid = this.extractCookieValue(cookie, 'kg_dfid') || '';

    for (const h of candidates) {
      // 检查缓存
      const ck = this.getCacheKey(h);
      const cached = this.urlCache.get(ck);
      if (cached && cached.expireAt > Date.now()) {
        return { url: cached.url, quality: cached.quality };
      }

      // 四路依次尝试
      const routes: Array<() => Promise<SongUrl | null>> = [
        () => this.fetchH5(h, albumId, quality, userid, token, mid, dfid, cookie),
        () => this.fetchMobile(h, albumId, userid, token),
        () => this.fetchWeb(h, albumId, mid, dfid, userid, token),
        () => this.fetchGateway(h, albumId, quality, userid, token, mid, dfid),
      ];

      for (const route of routes) {
        try {
          const result = await route();
          if (result?.url) {
            // 缓存结果
            this.urlCache.set(ck, { url: result.url, quality: result.quality || '', expireAt: Date.now() + URL_CACHE_TTL_MS });
            return result;
          }
        } catch { /* 继续下一路 */ }
      }
    }

    return { url: '', playable: false, trial: false, error: '酷狗四路取链均失败' };
  }

  private async fetchH5(hash: string, albumId: string | undefined, quality: string | undefined, userid: string, token: string, mid: string, dfid: string, cookie: string): Promise<SongUrl | null> {
    if (!userid || !token) return null;
    const params: Record<string, string> = {
      srcappid: String(H5_SRC_APPID),
      clientver: String(H5_CLIENTVER),
      clienttime: String(Date.now()),
      mid, uuid: mid, dfid,
      appid: '1014', token, userid,
      area_code: '1', hash,
      ssa_flag: 'is_fromtrack', version: '11430',
      quality: quality || '320',
      album_audio_id: albumId || '',
      behavior: 'play', pid: '2', cmd: '26', pidversion: '3001',
      IsFreePart: '0', cdnBackup: '1', module: '',
    };
    params.key = md5(hash + SIGN_KEY_SALT + params.appid + mid + (userid || '0'));
    const signature = h5Sign(params);
    const qs = Object.entries({...params, signature}).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
    const data = await this.http.requestJson<{
      status?: number;
      url?: string;
      bitRate?: number;
      fileSize?: number;
    }>(
      `https://gateway.kugou.com/v5/url?${qs}`,
      {
        platform: 'kugou',
        headers: {
          'x-router': 'trackercdn.kugou.com',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        cookie: cookie || undefined,
      },
    );
    if (data?.status === 1 && data.url) {
      const q = data.bitRate ? (data.bitRate >= 900 ? 'lossless' : data.bitRate >= 320 ? 'hq' : 'sq') : '';
      return { url: data.url.replace(/^http:/, 'https:'), quality: q };
    }
    return null;
  }

  private async fetchMobile(hash: string, albumId: string | undefined, userid: string, token: string): Promise<SongUrl | null> {
    const key = mobileKey(hash);
    const qs = `cmd=playInfo&hash=${encodeURIComponent(hash)}&key=${key}${albumId ? '&album_id=' + encodeURIComponent(albumId) : ''}&pid=1&forceDown=0&vip=${token ? '1' : '65530'}${userid ? '&userid=' + userid : ''}${token ? '&token=' + token : ''}`;
    const data = await this.http.requestJson<{
      url?: string;
      fileSize?: number;
      bitRate?: number;
      vip?: number;
    }>(
      `http://m.kugou.com/app/i/getSongInfo.php?${qs}`,
      {
        platform: 'kugou',
        headers: { Referer: 'http://m.kugou.com/' },
      },
    );
    // vip=65530 表示 VIP 限制
    if (data?.vip === 65530) return null;
    if (data?.url) {
      const q = data.bitRate ? (data.bitRate >= 900 ? 'lossless' : data.bitRate >= 320 ? 'hq' : 'sq') : '';
      return { url: data.url.replace(/^http:/, 'https:'), quality: q };
    }
    return null;
  }

  private async fetchWeb(hash: string, albumId: string | undefined, mid: string, dfid: string, userid: string, token: string): Promise<SongUrl | null> {
    const params = new URLSearchParams({
      r: 'play/getdata',
      hash,
      appid: '1014',
      platid: '4',
      mid,
      dfid,
    });
    if (albumId) params.set('album_id', albumId);
    if (userid) params.set('userid', userid);
    if (token) params.set('token', token);
    const data = await this.http.requestJson<{
      data?: { play_url?: string; quality?: string; bitrate?: number };
    }>(
      `https://wwwapi.kugou.com/yy/index.php?${params.toString()}`,
      { platform: 'kugou' },
    );
    const url = data?.data?.play_url;
    if (url) {
      return { url: url.replace(/^http:/, 'https:'), quality: data?.data?.quality ?? '' };
    }
    return null;
  }

  private async fetchGateway(hash: string, albumId: string | undefined, quality: string | undefined, userid: string, token: string, mid: string, dfid: string): Promise<SongUrl | null> {
    if (!userid || !token) return null;
    const clienttime = String(Date.now());
    const params: Record<string, string> = {
      srcappid: String(ANDROID_APPID),
      clientver: String(ANDROID_CLIENTVER),
      clienttime, mid, uuid: mid, dfid,
      appid: String(ANDROID_APPID), token, userid,
      area_code: '1', hash,
      ssa_flag: 'is_fromtrack', version: '11430',
      quality: quality || '320',
      album_audio_id: albumId || '',
      behavior: 'play', pid: '2', cmd: '26', pidversion: '3001',
      IsFreePart: '0', cdnBackup: '1', module: '',
    };
    params.key = md5(hash + SIGN_KEY_SALT + params.appid + mid + (userid || '0'));
    const body = Object.entries(params).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
    params.signature = androidSign(params, body);
    const qs = Object.entries(params).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
    const data = await this.http.requestJson<{
      status?: number;
      url?: string;
      bitRate?: number;
    }>(
      `https://gateway.kugou.com/v5/url?${qs}`,
      {
        platform: 'kugou',
        headers: {
          'User-Agent': ANDROID_UA,
          dfid, mid,
          'kg-rc': '1',
          'kg-thash': '5d816a0',
          'kg-rec': '1',
          'kg-rf': 'B9EDA08A64250DEFFBCADDEE00F8F25F',
        },
      },
    );
    if (data?.status === 1 && data.url) {
      const q = data.bitRate ? (data.bitRate >= 900 ? 'lossless' : data.bitRate >= 320 ? 'hq' : 'sq') : '';
      return { url: data.url.replace(/^http:/, 'https:'), quality: q };
    }
    return null;
  }

  async listQualities(): Promise<QualityOption[]> {
    const vip = await this.probeVip();
    const base: QualityOption[] = [
      { level: '128', label: '标准 128k' },
      { level: '320', label: '高品 320k' },
    ];
    if (vip.isVip) base.push({ level: 'flac', label: '无损 FLAC', needsVip: true });
    if (vip.isSvip) base.push({ level: 'hires', label: 'Hi-Res', needsSvip: true });
    return base;
  }

  /** 用户歌单列表（需登录） */
  async fetchMyPlaylists(): Promise<PlaylistSummary[]> {
    const rec = this.cookies.get('kugou');
    const cookie = rec?.cookies || '';
    const userid = this.extractCookieValue(cookie, 'KugooID');
    const token = this.extractCookieValue(cookie, 't');
    if (!userid || !token) return [];
    try {
      const params: Record<string, string> = {
        srcappid: String(H5_SRC_APPID),
        clientver: String(H5_CLIENTVER),
        clienttime: String(Date.now()),
        mid: this.extractCookieValue(cookie, 'kg_mid') || '0',
        uuid: this.extractCookieValue(cookie, 'kg_mid') || '0',
        dfid: this.extractCookieValue(cookie, 'kg_dfid') || '',
        appid: '1014', token, userid,
      };
      const signature = h5Sign(params);
      const data = await this.http.requestJson<{
        data?: { info?: Array<{ listid: string; specialname: string; imgurl: string; songcount: number }> };
      }>('https://gateway.kugou.com/v7/get_all_list', {
        platform: 'kugou',
        method: 'POST',
        form: { ...params, signature, userid, token, total_ver: '979', type: '2', page: '1', pagesize: '100', plat: '1' },
        headers: { 'x-router': 'cloudlist.service.kugou.com' },
      });
      const items = data?.data?.info ?? [];
      console.log('[KugouAdapter] fetchMyPlaylists:', JSON.stringify({
        status: (data as any)?.status, errcode: (data as any)?.errcode,
        errmsg: (data as any)?.errmsg, itemCount: items.length,
        userid, hasToken: !!token,
        cookieKugouId: this.extractCookieValue(cookie, 'KugooID'),
        cookieToken: this.extractCookieValue(cookie, 't') ? 'yes' : 'no',
      }));
      if (items.length === 0) {
        console.log('[KugouAdapter] fetchMyPlaylists raw:', JSON.stringify(data).substring(0, 500));
      }
      return items.map((item) => ({
        id: item.listid,
        name: item.specialname,
        cover: item.imgurl || '',
        trackCount: item.songcount || 0,
      }));
    } catch (err) {
      console.warn('[KugouAdapter] 用户歌单获取失败:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  /** 歌单内歌曲（需登录） */
  async fetchPlaylistTracks(listId: string): Promise<Track[]> {
    const rec = this.cookies.get('kugou');
    const cookie = rec?.cookies || '';
    const userid = this.extractCookieValue(cookie, 'KugooID');
    const token = this.extractCookieValue(cookie, 't');
    if (!userid || !token) return [];
    try {
      const params: Record<string, string> = {
        srcappid: String(H5_SRC_APPID),
        clientver: String(H5_CLIENTVER),
        clienttime: String(Date.now()),
        mid: this.extractCookieValue(cookie, 'kg_mid') || '0',
        uuid: this.extractCookieValue(cookie, 'kg_mid') || '0',
        dfid: this.extractCookieValue(cookie, 'kg_dfid') || '',
        appid: '1014', token, userid,
      };
      const signature = h5Sign(params);
      const data = await this.http.requestJson<{
        data?: { info?: Array<Record<string, any>> };
      }>('https://gateway.kugou.com/v4/get_list_all_file', {
        platform: 'kugou',
        method: 'POST',
        form: { ...params, signature, listid: listId, userid, area_code: '1', show_relate_goods: '0', pagesize: '100', allplatform: '1', show_cover: '1', type: '0', token, page: '1' },
        headers: { 'x-router': 'cloudlist.service.kugou.com' },
      });
      return (data?.data?.info ?? []).map(mapKugouTrack).filter((t): t is Track => !!t);
    } catch (err) {
      console.warn('[KugouAdapter] 歌单歌曲获取失败:', err instanceof Error ? err.message : err);
      return [];
    }
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
