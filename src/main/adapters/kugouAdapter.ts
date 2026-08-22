import crypto from 'node:crypto';
import type { HttpClient } from '../http';
import type { CookieStore } from '../cookieStore';
import type { Lyric, Playlist, PlaylistSummary, PlatformAdapter, QualityOption, SongUrl, Track } from '../types';
import { parseLrc } from '../parsers/lyricParser';
import { mapKugouMobileTrack, mapKugouTrack } from './mappers';

// --- 文本处理（对齐 Mineradio） ---
function stripKugouHtml(text: string): string {
  return decodeKugouDisplayText(String(text || '').replace(/<[^>]+>/g, '').trim());
}
function decodeKugouDisplayText(text: string): string {
  let raw = String(text || '').trim();
  if (!raw) return '';
  if (/%u[0-9a-fA-F]{4}/.test(raw)) raw = raw.replace(/%u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  if (/%[0-9a-fA-F]{2}/.test(raw) && !/[\u3400-\u9fff]/.test(raw)) { try { raw = decodeURIComponent(raw.replace(/\+/g, ' ')); } catch { /* */ } }
  return raw.trim();
}
function stripKugouFileName(raw: string, fallbackArtist: string): string {
  let name = stripKugouHtml(raw || '').replace(/\.(mp3|flac|m4a|wav|ape|ogg)$/i, '').trim();
  const artist = stripKugouHtml(fallbackArtist || '');
  if (artist && name.indexOf(artist) === 0) name = name.slice(artist.length).replace(/^[\s\-–—]+/, '').trim();
  return name || stripKugouHtml(raw || '');
}
function extractKugouArtists(item: Record<string, any>): Array<{ id: string; name: string }> {
  const singers = Array.isArray(item.singerinfo) ? item.singerinfo : (Array.isArray(item.Singers) ? item.Singers : []);
  if (singers.length) return singers.map((s: any) => ({ id: String(s.id || s.SingerId || ''), name: stripKugouHtml(s.name || s.SingerName || '') })).filter(a => a.name);
  const names = String(item.SingerName || '').split(/、|\/|,| feat\.? /i).map(stripKugouHtml).filter(Boolean);
  const ids = Array.isArray(item.SingerId) ? item.SingerId : [];
  return names.map((name, i) => ({ id: String(ids[i] || ''), name }));
}

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

/** H5 签名：md5(H5_SALT + sorted k=v[+bodyJson] + H5_SALT) */
function h5Sign(params: Record<string, string>, bodyObj?: Record<string, unknown>): string {
  const parts = Object.keys(params).sort().map(k => k + '=' + params[k]);
  if (bodyObj && typeof bodyObj === 'object') parts.push(JSON.stringify(bodyObj));
  return md5(H5_SALT + parts.join('') + H5_SALT);
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

/** 解析酷狗歌单 ID：支持纯数字、collection_xxx_xxx_NUM_xxx 格式 */
function parseKugouListId(playlistId: string): string {
  const id = String(playlistId || '').trim();
  if (!id) return '';
  if (/^\d+$/.test(id)) return id;
  if (id.startsWith('collection_')) {
    const parts = id.split('_');
    if (parts.length >= 5 && parts[3]) return parts[3];
  }
  const matched = id.match(/collection_\d+_\d+_(\d+)_\d+/);
  return matched ? matched[1] : id;
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

/** H5 网关歌单歌曲映射（对齐 Mineradio mapKugouPlaylistTrack） */
function mapKugouPlaylistTrack(item: Record<string, any>): Track | null {
  try {
    const artists = extractKugouArtists(item);
    const artistLabel = artists.map(a => a.name).join(' / ');
    const hash = item.hash || item.FileHash || '';
    if (!hash) return null;
    const songName = stripKugouFileName(item.name || item.SongName || item.filename || '', artistLabel);
    if (!songName) return null;
    const albumInfo = item.albuminfo || {};
    return {
      id: `kugou:${hash}`,
      title: songName,
      artist: artistLabel || '未知歌手',
      artists: artists.map(a => a.name),
      album: stripKugouHtml(albumInfo.name || item.album_name || item.AlbumName || ''),
      cover: kugouCoverUrl(String(item.cover || item.img || item.Image || albumInfo.img || albumInfo.cover || (item.trans_param && item.trans_param.union_cover) || '')),
      duration: Number(item.duration || (item.timelen ? Math.round(Number(item.timelen) / 1000) : 0) || item.Duration || 0) || 0,
      platform: 'kugou',
      sourceId: hash,
      originalUrl: '',
      fallbackUrl: '',
      extra: {
        albumId: String(albumInfo.id || item.album_id || item.AlbumID || ''),
        mixSongId: String(item.mixsongid || item.MixSongID || item.album_audio_id || ''),
        hqHash: item.HQFileHash || '',
        sqHash: item.SQFileHash || '',
        resHash: item.ResFileHash || '',
        privilege: Number(item.media_privilege ?? item.privilege ?? item.Privilege ?? 0),
      },
    };
  } catch { return null; }
}

/** 酷狗封面 URL：替换 {size} 占位符 + 确保 HTTPS */
function kugouCoverUrl(raw: string, size = 240): string {
  const url = String(raw || '').trim();
  if (!url) return '';
  return url.replace(/\{size\}/g, String(size)).replace(/^http:\/\//, 'https://');
}

export class KugouAdapter implements PlatformAdapter {
  readonly platform = 'kugou' as const;

  private vipCache: VipStatus | null = null;
  private urlCache = new Map<string, UrlCacheEntry>();

  constructor(
    private http: HttpClient,
    private cookies: CookieStore,
  ) {}

  async fetchPlaylist(playlistId: string): Promise<Playlist> {
    const cookie = this.cookies.getHeader('kugou') ?? '';
    const userid = this.extractKugouUserId(cookie);
    const token = this.extractKugouToken(cookie);

    // 已登录 → 尝试 H5 网关（支持用户歌单 ID）
    if (userid && token) {
      try {
        return await this.fetchPlaylistViaH5(playlistId, cookie, userid, token);
      } catch (err) {
        console.warn('[KugouAdapter] H5 歌单失败，回退 mobile API:', err instanceof Error ? err.message : err);
      }
    }

    // 兜底：mobilecdn 公开歌单 API
    return this.fetchPlaylistViaMobile(playlistId);
  }

  /** H5 网关取歌单（需登录，支持用户歌单 listid） */
  private async fetchPlaylistViaH5(playlistId: string, cookie: string, userid: string, token: string): Promise<Playlist> {
    const mid = this.extractCookieValue(cookie, 'kg_mid') || '';
    const dfid = this.extractCookieValue(cookie, 'kg_dfid') || '-';
    const listid = parseKugouListId(playlistId);
    if (!listid) throw new Error('无效歌单 ID');

    let allTracks: Track[] = [];
    let playlistName = '酷狗歌单';
    let playlistCover = '';
    let page = 1;
    const pageSize = 100;

    // 分页获取所有歌曲
    while (true) {
      const params: Record<string, string> = {
        srcappid: String(H5_SRC_APPID), clientver: String(H5_CLIENTVER), clienttime: String(Date.now()),
        mid: mid || '0', uuid: String(Date.now()), dfid: dfid || '-',
        appid: '1014', token, userid, plat: '1',
      };
      const bodyObj = { listid: Number(listid) || listid, userid: Number(userid), token, area_code: 1, show_relate_goods: 0, pagesize: pageSize, allplatform: 1, show_cover: 1, type: 0, page };
      params.signature = h5Sign(params, bodyObj);
      const qs = Object.entries(params).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
      const url = 'https://gateway.kugou.com/v4/get_list_all_file?' + qs;
      const data = await this.http.requestJson<{ data?: { info?: Array<Record<string, any>>; listname?: string; pic?: string; count?: number } }>(
        url, { platform: 'kugou', method: 'POST', body: bodyObj, headers: { 'x-router': 'cloudlist.service.kugou.com' } },
      );

      if (page === 1) {
        playlistName = stripKugouHtml(String(data?.data?.listname || '酷狗歌单'));
        playlistCover = kugouCoverUrl(String(data?.data?.pic || ''));
      }

      const rawList = data?.data?.info ?? [];
      if (!rawList.length) break;

      const tracks = rawList.map(mapKugouPlaylistTrack).filter((t): t is Track => !!t);
      allTracks.push(...tracks);

      // 如果返回数量少于 pageSize，说明已到末页
      if (rawList.length < pageSize) break;
      page++;
      if (page > 20) break; // 安全上限
    }

    if (!allTracks.length) throw new Error('歌单为空');
    // 酷狗返回最旧在前，反转为最新在上
    allTracks.reverse();
    return { id: playlistId, platform: 'kugou', name: playlistName, cover: playlistCover, tracks: allTracks };
  }

  /** mobilecdn 公开歌单 API（无需登录） */
  private async fetchPlaylistViaMobile(specialId: string): Promise<Playlist> {
    const data = await this.http.requestJson<{
      data?: { info?: Array<Record<string, any>> };
    }>(
      `https://mobilecdn.kugou.com/api/v3/special/song?specialid=${encodeURIComponent(specialId)}&page=1&pagesize=300&plat=0&version=9000`,
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
    const userid = this.extractKugouUserId(rec?.cookies || '') || '0';
    const token = this.extractKugouToken(rec?.cookies || '') || '';
    return `${userid}:${token}:${hash}`;
  }

  private extractCookieValue(cookie: string | undefined | null, name: string): string {
    if (!cookie) return '';
    for (const seg of cookie.split(';')) {
      const eq = seg.indexOf('=');
      if (eq <= 0) continue;
      const k = seg.slice(0, eq).trim();
      const v = seg.slice(eq + 1).trim();
      if (k === name) return v;
    }
    return '';
  }

  /** 提取酷狗用户 ID（兼容多种 cookie 字段名） */
  private extractKugouUserId(cookie: string): string {
    for (const name of ['KugooID', 'kugooID', 'userid', 'UserId', 'kugouID', 'uid']) {
      const v = this.extractCookieValue(cookie, name);
      if (v && v !== '0') return v.replace(/\D/g, '');
    }
    // KuGoo 复合值中提取
    const kuGoo = this.extractCookieValue(cookie, 'KuGoo');
    if (kuGoo) {
      try {
        const decoded = decodeURIComponent(kuGoo.replace(/%u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))));
        const match = decoded.match(/(?:KugooID|userid|uid)=(\d+)/);
        if (match) return match[1];
      } catch { /* */ }
    }
    return '';
  }

  /** 提取酷狗 token（兼容多种 cookie 字段名） */
  private extractKugouToken(cookie: string): string {
    for (const name of ['t', 'token', 'Token', 'T']) {
      const v = this.extractCookieValue(cookie, name);
      if (v) return v;
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
    const userid = this.extractKugouUserId(rec?.cookies || '') || '';
    const token = this.extractKugouToken(rec?.cookies || '') || '';
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
    const userid = this.extractKugouUserId(cookie);
    const token = this.extractKugouToken(cookie);
    const mid = this.extractCookieValue(cookie, 'kg_mid') || '';
    const dfid = this.extractCookieValue(cookie, 'kg_dfid') || '';
    if (!userid || !token) return [];
    try {
      const params: Record<string, string> = {
        srcappid: String(H5_SRC_APPID),
        clientver: String(H5_CLIENTVER),
        clienttime: String(Date.now()),
        mid: mid || '0',
        uuid: String(Date.now()),
        dfid: dfid || '-',
        appid: '1014', token, userid, plat: '1',
      };
      const bodyObj = { userid: Number(userid), token, total_ver: 979, type: 2, page: 1, pagesize: 50 };
      params.signature = h5Sign(params, bodyObj);
      const qs = Object.entries(params).map(([k,v]) => k+'='+encodeURIComponent(v)).join('&');
      const url = 'https://gateway.kugou.com/v7/get_all_list?' + qs;
      console.log('[KugouAdapter] fetchMyPlaylists url:', url.substring(0,180));
      const data = await this.http.requestJson<{
        status?: number; error?: string;
        data?: { info?: Array<{ listid: string; specialname: string; imgurl: string; songcount: number }> };
      }>(url, { platform: 'kugou', method: 'POST', body: bodyObj, headers: { 'x-router': 'cloudlist.service.kugou.com' } });
      if (data.status === 0) { console.warn('[KugouAdapter] API error:', data.error); return []; }
      // 响应结构可能为 data.info / data.list / data.data.info
      const raw = data?.data;
      const items: Array<Record<string, unknown>> = (raw?.info as any[]) ?? (raw as any)?.list ?? (data as any)?.info ?? [];
      console.log('[KugouAdapter] fetchMyPlaylists:', items.length, 'items');
      if (!items.length) console.log('[KugouAdapter] raw:', JSON.stringify(data).substring(0,500));
      return items.map(item => ({
        id: String(item.global_collection_id || item.specialid || item.listid || item.list_id || item.id || ''),
        name: stripKugouHtml(String(item.name || item.listname || item.specialname || item.title || '酷狗歌单')),
        cover: kugouCoverUrl(String(item.pic || item.img || item.imgurl || item.sizable_cover || item.create_user_pic || '')),
        trackCount: Number(item.count || item.m_count || item.song_count || item.total || item.list_count || item.songcount || 0) || 0,
      }));
    } catch (err) {
      console.warn('[KugouAdapter] 歌单获取失败:', err instanceof Error ? err.message : err);
      return [];
    }
  }

  /** 歌单内歌曲（需登录） */
  async fetchPlaylistTracks(listId: string): Promise<Track[]> {
    const rec = this.cookies.get('kugou');
    const cookie = rec?.cookies || '';
    const userid = this.extractKugouUserId(cookie);
    const token = this.extractKugouToken(cookie);
    const mid = this.extractCookieValue(cookie, 'kg_mid') || '';
    const dfid = this.extractCookieValue(cookie, 'kg_dfid') || '';
    if (!userid || !token) return [];
    try {
      const params: Record<string, string> = {
        srcappid: String(H5_SRC_APPID),
        clientver: String(H5_CLIENTVER),
        clienttime: String(Date.now()),
        mid: mid || '0', uuid: String(Date.now()), dfid: dfid || '-',
        appid: '1014', token, userid,
      };
      const bodyObj = { listid: listId, userid: Number(userid), token, area_code: 1, show_relate_goods: 0, pagesize: 100, allplatform: 1, show_cover: 1, type: 0, page: 1 };
      params.signature = h5Sign(params, bodyObj);
      const qs = Object.entries(params).map(([k,v]) => k+'='+encodeURIComponent(v)).join('&');
      const url = 'https://gateway.kugou.com/v4/get_list_all_file?' + qs;
      const data = await this.http.requestJson<{ data?: { info?: Array<Record<string, any>> } }>(url, { platform: 'kugou', method: 'POST', body: bodyObj, headers: { 'x-router': 'cloudlist.service.kugou.com' } });
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
