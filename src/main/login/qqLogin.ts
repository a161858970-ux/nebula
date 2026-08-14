import type { CookieStore } from '../cookieStore';
import type { HttpClient } from '../http';
import type { AccountInfo, PlaylistSummary } from '../types';
import type { QqRightsService } from '../services/qqRights';

/** QQ 统一 hash33（ptqrtoken / g_tk）。 */
export function hash33(s: string, seed = 0): number {
  let e = seed;
  for (let i = 0; i < s.length; i++) e += (e << 5) + s.charCodeAt(i);
  return 2147483647 & e;
}

const APPID = '716027609'; // QQ 音乐 web
const DAID = '383';
const U1 = encodeURIComponent('https://y.qq.com/portal/wsa.html?p=qq');

/**
 * QQ 扫码登录（ptlogin2，实验性——平台接口易变）。
 * 流程：ptqrshow 取二维码 + qrsig → ptqrtoken 轮询 → 成功跳 check_sig 收 p_skey。
 */
export class QqLogin {
  constructor(
    private http: HttpClient,
    private cookies: CookieStore,
    private qqRights?: QqRightsService,
  ) {}

  async createQr(): Promise<{ unikey: string; payload: string; imageDataUrl: string }> {
    const ts = Date.now();
    const url = `https://ssl.ptlogin2.qq.com/ptqrshow?appid=${APPID}&e=2&l=M&s=3&d=72&v=4&t=${ts}&daid=${DAID}&pt_3rd_aid=100497308&u1=${U1}`;
    const raw = await this.http.requestRaw(url, { platform: 'qq', timeoutMs: 15000 });
    if (!raw.ok) throw new Error(`获取 QQ 二维码失败 HTTP ${raw.status}`);
    const qrsig = raw.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .find((c) => c.startsWith('qrsig='));
    if (!qrsig) throw new Error('获取 QQ 二维码失败（缺少 qrsig）');
    this.cookies.set('qq', qrsig);
    const base64 = Buffer.from(raw.text, 'binary').toString('base64');
    return {
      unikey: qrsig.split('=')[1] ?? String(ts),
      payload: '',
      imageDataUrl: `data:image/gif;base64,${base64}`,
    };
  }

  async pollLogin(qrsigValue: string): Promise<{ ok: boolean; message: string }> {
    try {
      const qrsig = `qrsig=${qrsigValue}`;
      const token = hash33(qrsigValue);
      const ts = Date.now();
      const url =
        `https://ssl.ptlogin2.qq.com/ptqrlogin?u1=${U1}&ptqrtoken=${token}` +
        `&ptqrhash=${hash33('')}&sk=${APPID}&aid=${APPID}&daid=${DAID}&pt_3rd_aid=100497308` +
        `&mibao_css=m_qqmusic&t=1&d=72&from_ui=1&ptlang=2052&fp=loginerralert&action=0-0-${ts}` +
        `&js_ver=22070810&js_type=1&login_sig=&pt_randsalt=0`;
      const raw = await this.http.requestRaw(url, { platform: 'qq', cookie: qrsig, timeoutMs: 12000 });
      const text = raw.text;
      const m = text.match(/ptui_cb\('(\d+)','([^']*)','([^']*)','(\d+)','([^']*)','([^']*)'\)/);
      if (!m) return { ok: false, message: '登录状态解析失败' };
      const code = m[1];
      const nick = m[6];
      if (code === '0' && m[3]) {
        // 成功：携带 qrsig 访问 check_sig，收取 p_skey 等 Cookie
        const sig = await this.http.requestRaw(m[3], { platform: 'qq', cookie: qrsig, timeoutMs: 15000 });
        const extra = sig.headers
          .getSetCookie()
          .map((c) => c.split(';')[0])
          .filter((c) => c.includes('='))
          .join('; ');
        this.cookies.set('qq', extra ? `${qrsig}; ${extra}` : qrsig, qrsigValue, nick);
        return { ok: true, message: `登录成功：${nick}` };
      }
      const msgMap: Record<string, string> = {
        '65': '二维码已失效，请刷新',
        '66': '二维码已使用，请刷新',
        '67': '等待扫码…',
        '68': '已扫码，请在手机上确认',
      };
      return { ok: false, message: msgMap[code] ?? m[5] ?? `状态码 ${code}` };
    } catch (err) {
      return { ok: false, message: `网络波动（${err instanceof Error ? err.message : String(err)}）` };
    }
  }

  async getAccount(): Promise<AccountInfo | null> {
    const cookie = this.cookies.getHeader('qq') ?? '';
    const uin = cookie.match(/(?:^|;\s*)uin=o?(\d+)/)?.[1] ?? cookie.match(/(?:^|;\s*)uin=(\d+)/)?.[1];
    if (!uin) return null;
    let nickname = `QQ ${uin}`;
    try {
      const data = await this.http.requestJson<{ data?: { nick?: string } }>(
        `https://c.y.qq.com/rsc/fcgi-bin/fcg_music_profile.fcg?uin=${uin}&format=json&inCharset=utf-8&outCharset=utf-8`,
        { platform: 'qq', cookie, timeoutMs: 8000 },
      );
      if (data?.data?.nick) nickname = data.data.nick;
    } catch {
      /* keep fallback nickname */
    }
    if (nickname === `QQ ${uin}`) {
      try {
        const data = await this.http.requestJson<{ data?: { hostname?: string } }>(
          `https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss?uin=${uin}&loginUin=${uin}&hostuin=${uin}&format=json&inCharset=utf-8&outCharset=utf-8&needNewCode=0&platform=yqq.json&g_tk=5381`,
          { platform: 'qq', cookie, timeoutMs: 8000 },
        );
        if (data?.data?.hostname) nickname = data.data.hostname;
      } catch {
        /* keep fallback nickname */
      }
    }
    let vip: { isVip?: boolean; isSvip?: boolean; vipType?: number } = {};
    if (this.qqRights) {
      try {
        const rights = await this.qqRights.getRights(cookie);
        if (rights) {
          vip = { isVip: rights.isVip, isSvip: rights.isSvip, vipType: rights.vipType };
        }
      } catch {
        /* rights are best-effort */
      }
    }
    // QQ 头像走 qlogo 官方头像地址（无需额外接口，uin 即 key）。
    const avatarUrl = `https://q1.qlogo.cn/g?b=qq&nk=${uin}&s=640`;
    return { loggedIn: true, userId: uin, nickname, avatarUrl, ...vip };
  }

  async getMyPlaylists(): Promise<PlaylistSummary[]> {
    const account = await this.getAccount();
    if (!account?.loggedIn) return [];
    const cookie = this.cookies.getHeader('qq') ?? '';
    const uin = String(account.userId ?? '');
    // g_tk 由播放票据（p_skey/skey/music_key/qm_keyst）以 5381 为种子生成，
    // 与 QQ 音乐官方 web 端一致；无票据时回退 5381。
    const ticket = cookie.match(/(?:^|;\s*)(?:p_skey|skey|music_key|qm_keyst)=([^;]+)/)?.[1] ?? '';
    const gtk = ticket ? hash33(ticket, 5381) : 5381;
    const comm = {
      ct: 24,
      cv: 4747474,
      platform: 'yqq.json',
      chid: '0',
      uin,
      g_tk: gtk,
      g_tk_new_20200303: gtk,
      format: 'json',
      inCharset: 'utf-8',
      outCharset: 'utf-8',
      notice: 0,
      need_new_code: 1,
    };
    const callMusicu = async (
      module: string,
      method: string,
      param: Record<string, unknown>,
    ): Promise<Array<Record<string, any>>> => {
      const data = await this.http.requestJson<{
        code?: number;
        req_0?: {
          code?: number;
          data?: {
            total?: number;
            v_playlist?: Array<Record<string, any>>;
            list?: Array<Record<string, any>>;
          };
        };
      }>('https://u.y.qq.com/cgi-bin/musicu.fcg', {
        platform: 'qq',
        method: 'POST',
        body: { comm, req_0: { module, method, param } },
        cookie,
        timeoutMs: 10000,
      });
      if (data?.code !== 0 || data.req_0?.code !== 0) return [];
      return data.req_0?.data?.v_playlist ?? data.req_0?.data?.list ?? [];
    };

    let items: Array<Record<string, any>> = [];
    try {
      // 主路径：登录态读取“我创建的歌单”（musicu.fcg，与官方 web 同款）
      items = await callMusicu('music.musicasset.PlaylistBaseRead', 'GetPlaylistByUin', { uin });
    } catch {
      /* fall through to secondary endpoint */
    }
    if (!items.length) {
      try {
        // 备用路径：UserSonglistService（部分账号返回 list 结构）
        items = await callMusicu('music.songlist.UserSonglistService', 'GetUserSonglist', {
          uin,
          page: 1,
          num: 50,
          sort: 5,
          onlyPlayList: 1,
        });
      } catch {
        /* keep whatever we got */
      }
    }
    return items
      .map((d) => ({
        id: String(d.tid ?? d.dissid ?? d.dirId ?? d.dirid ?? ''),
        name: d.dirName ?? d.dissname ?? d.title ?? d.name ?? '未命名歌单',
        cover: String(d.picUrl ?? d.picurl ?? d.cover ?? d.logo ?? '').replace(/^http:\/\//i, 'https://'),
        trackCount: Number(d.songNum ?? d.songnum ?? d.song_cnt ?? 0) || 0,
      }))
      .filter((p) => p.id);
  }
}
