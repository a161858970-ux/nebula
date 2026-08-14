import type { CookieStore } from '../cookieStore';
import { normalizeCookieHeader, validatePlatformCookie } from '../cookieStore';
import type { HttpClient } from '../http';
import type { AccountInfo, PlaylistSummary } from '../types';
import { callNcmModule, callNcmSafe } from '../ncm/ncmApi';
import { createRequire } from 'node:module';

const require_ = createRequire(__filename);

export interface QrStatus {
  ok: boolean;
  message: string;
  nickname?: string;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function cookieOf(store: CookieStore): string {
  return store.getHeader('netease') ?? '';
}

/**
 * 网易云扫码登录（基于 @neteasecloudmusicapienhanced/api 成熟库）。
 *
 * - createQr：login_qr_key（type=3）→ 返回 unikey + qrurl（含 base64 qrimg，前端可直显）
 * - pollLogin：login_qr_check；803 成功时归一化并校验 MUSIC_U 后入库
 * - getAccount：user_account → profile（含 vipType / isVip / isSvip），登录态探活
 * - getMyPlaylists：user_playlist（uid + cookie）
 */
export class NeteaseLogin {
  constructor(
    _http: HttpClient,
    private cookies: CookieStore,
  ) {}

  async createQr(): Promise<{ unikey: string; payload: string; imageDataUrl?: string }> {
    const res = await callNcmSafe('login_qr_key', { type: 3 });
    const unikey = res?.body?.data?.unikey ?? (res?.body?.unikey as string | undefined);
    if (!unikey) {
      throw new Error(`获取二维码失败 (code=${res?.body?.code ?? 'unknown'}, msg=${res?.body?.message ?? ''})`);
    }
    const payload = `https://music.163.com/login?codekey=${unikey}`;
    let imageDataUrl: string | undefined;
    try {
      const QRCode = require_('qrcode') as { toDataURL: (t: string, o?: object) => Promise<string> };
      imageDataUrl = await QRCode.toDataURL(payload, { margin: 1 });
    } catch {
      /* 前端会回退用 payload 本地渲染二维码 */
    }
    return { unikey, payload, imageDataUrl };
  }

  async pollLogin(unikey: string): Promise<QrStatus> {
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await callNcmModule('login_qr_check', { key: unikey, cookie: cookieOf(this.cookies) });
        const code = res?.body?.code;
        switch (code) {
          case 800:
            return { ok: false, message: '二维码已过期，请重新生成' };
          case 801:
            return { ok: false, message: '等待扫码…' };
          case 802:
            return { ok: false, message: '已扫码，请在手机上确认' };
          case 803: {
            const raw = res?.body?.cookie ?? (Array.isArray(res?.cookie) ? res.cookie.join(';') : '');
            const normalized = normalizeCookieHeader(raw);
            const validation = validatePlatformCookie('netease', normalized);
            if (!validation.ok) {
              return { ok: false, message: validation.error };
            }
            this.cookies.set('netease', normalized, undefined, res?.body?.nickname);
            return { ok: true, message: `登录成功：${res?.body?.nickname ?? ''}`, nickname: res?.body?.nickname };
          }
          default:
            return {
              ok: false,
              message: res?.body?.message ?? `未知状态 (code=${code ?? 'unknown'})`,
            };
        }
      } catch (err) {
        lastErr = err;
        await sleep(800 * (attempt + 1));
      }
    }
    return {
      ok: false,
      message: `网络波动（${lastErr instanceof Error ? lastErr.message : String(lastErr)}），正在重试…`,
    };
  }

  /** 登录态探活 / 账号信息（含 VIP 权益）。cookie 失效返回 loggedIn:false。 */
  async getAccount(): Promise<AccountInfo> {
    const cookie = cookieOf(this.cookies);
    if (!cookie) return { loggedIn: false };
    const res = await callNcmSafe('user_account', { cookie });
    const profile = res?.body?.profile as
      | { userId?: number; nickname?: string; avatarUrl?: string; vipType?: number }
      | undefined;
    if (!res || res.body?.code === 301 || !profile?.userId) {
      return { loggedIn: false };
    }
    const vipType = profile.vipType ?? 0;
    return {
      loggedIn: true,
      userId: String(profile.userId),
      nickname: profile.nickname ?? '用户',
      avatarUrl: profile.avatarUrl,
      vipType,
      isVip: vipType > 0,
      isSvip: vipType >= 11,
    };
  }

  /** 登录状态下的「我创建 + 我收藏」歌单。 */
  async getMyPlaylists(): Promise<PlaylistSummary[]> {
    const account = await this.getAccount();
    if (!account.loggedIn || !account.userId) return [];
    const res = await callNcmSafe('user_playlist', {
      uid: account.userId,
      limit: 100,
      offset: 0,
      cookie: cookieOf(this.cookies),
    });
    const list = res?.body?.playlist as
      | Array<{ id?: number | string; name?: string; coverImgUrl?: string; trackCount?: number }>
      | undefined;
    return (list ?? [])
      .map((p) => ({
        id: String(p.id ?? ''),
        name: p.name ?? '未命名歌单',
        cover: p.coverImgUrl ?? '',
        trackCount: p.trackCount ?? 0,
      }))
      .filter((p) => p.id);
  }

  /** 启动探活：仅记录结果，不抛未捕获异常。 */
  async probeLogin(): Promise<void> {
    try {
      const account = await this.getAccount();
      if (account.loggedIn) {
        console.log(
          `[Netease][Probe] 已登录：${account.nickname}（VIP=${account.isVip ? '是' : '否'}, SVIP=${account.isSvip ? '是' : '否'}）`,
        );
      } else {
        console.log('[Netease][Probe] 未登录或 Cookie 已失效');
      }
    } catch (err) {
      console.warn('[Netease][Probe] 探活异常（忽略）:', err instanceof Error ? err.message : err);
    }
  }
}
