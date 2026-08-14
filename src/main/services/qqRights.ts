import type { HttpClient } from '../http';

/**
 * QQ 会员权益解析（借鉴 Mineradio 的严格字段白名单思路，独立实现）：
 * - 从任意 QQ 返回载荷中按字段名白名单识别 VIP/SVIP 标记、等级、有效期；
 * - 带短 TTL 缓存 + “已知有效保底”（stale-positive grace），接口抖动时不误判降权。
 */

export interface QqRights {
  isVip: boolean;
  isSvip: boolean;
  vipType: number;
  expiresAt: number | null;
}

const VIP_FLAG_KEYS = new Set([
  'isvip',
  'vip',
  'vipflag',
  'ivipflag',
  'inewvip',
  'isgreenvip',
  'greenvip',
  'ismember',
  'member',
  'isassociator',
  'associator',
]);

const SVIP_FLAG_KEYS = new Set([
  'issvip',
  'svip',
  'svipflag',
  'isupervip',
  'inewsupervip',
  'issupervip',
  'supervip',
  'isluxuryvip',
  'luxuryvip',
  'greensvip',
  'hugevip',
  'lmflag',
]);

const VIP_TYPE_KEYS = new Set([
  'viptype',
  'viplevel',
  'musicviptype',
  'musicviplevel',
  'greenviptype',
  'greenviplevel',
  'associatortype',
  'associatorlevel',
]);

const SVIP_TYPE_KEYS = new Set([
  'sviptype',
  'sviplevel',
  'superviptype',
  'superviplevel',
  'luxuryviptype',
  'luxuryviplevel',
  'greensviplevel',
]);

const EXPIRY_KEYS = new Set([
  'expire',
  'expires',
  'expireat',
  'expiretime',
  'vipexpireat',
  'vipexpiretime',
  'vipendtime',
  'svipexpiretime',
  'greenvipendtime',
  'associatorexpiretime',
  'deadline',
  'validuntil',
  'endtime',
  'overdate',
]);

function normalizeKey(key: string): string {
  return String(key ?? '').replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function parseFlag(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return Number.isFinite(v) ? v > 0 : null;
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (!s) return null;
  if (/^[1-9]\d*$/.test(s)) return true;
  if (/^(true|yes|active|valid|opened|open|vip|svip|premium|member)$/.test(s)) return true;
  if (/^(0|false|no|none|normal|ordinary|expired|inactive|closed|invalid)$/.test(s)) return false;
  if (/^(已开通|开通|有效|会员|绿钻|豪华绿钻)$/.test(s)) return true;
  if (/^(未开通|已过期|过期|普通用户|普通账号|非会员)$/.test(s)) return false;
  return null;
}

function parseExpiry(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
    const ms = v < 1e10 ? v * 1000 : v;
    return ms >= 946684800000 ? ms : null;
  }
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) {
      const ms = n < 1e10 ? n * 1000 : n;
      return ms >= 946684800000 ? ms : null;
    }
    const t = Date.parse(v);
    return Number.isFinite(t) && t >= 946684800000 ? t : null;
  }
  return null;
}

const MAX_DEPTH = 6;

/** 从任意 JSON 载荷中提取 QQ 会员字段（白名单 + 宽匹配）。 */
export function parseQqRights(payload: unknown): QqRights {
  let isVip = false;
  let isSvip = false;
  let vipType = 0;
  let expiresAt: number | null = null;

  const walk = (obj: unknown, depth: number): void => {
    if (depth > MAX_DEPTH || !obj || typeof obj !== 'object') return;
    if (Array.isArray(obj)) {
      for (const item of obj.slice(0, 30)) walk(item, depth + 1);
      return;
    }
    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === undefined) continue;
      if (typeof value === 'object') {
        walk(value, depth + 1);
        continue;
      }
      const k = normalizeKey(key);
      if (VIP_FLAG_KEYS.has(k) || /(^|[^a-z])(vip|member|green|associat)/.test(k)) {
        if (parseFlag(value) === true) isVip = true;
      }
      if (SVIP_FLAG_KEYS.has(k) || /(^|[^a-z])(svip|supervip|luxury)/.test(k)) {
        if (parseFlag(value) === true) isSvip = true;
      }
      if (VIP_TYPE_KEYS.has(k) && typeof value === 'number' && value > 0) {
        vipType = Math.max(vipType, Math.floor(value));
      }
      if (SVIP_TYPE_KEYS.has(k) && typeof value === 'number' && value > 0) {
        isSvip = true;
        vipType = Math.max(vipType, Math.floor(value));
      }
      if (EXPIRY_KEYS.has(k)) {
        const t = parseExpiry(value);
        if (t !== null && (expiresAt === null || t > expiresAt)) expiresAt = t;
      }
    }
  };

  walk(payload, 0);
  return { isVip, isSvip, vipType, expiresAt };
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const STALE_POSITIVE_GRACE_MS = 20 * 60 * 1000;

/** QQ 权益服务：接口失败时保留最近一次“有效”结果，避免瞬时抖动误判降权。 */
export class QqRightsService {
  private cache: { at: number; rights: QqRights } | null = null;

  constructor(private http: HttpClient) {}

  async getRights(cookie: string): Promise<QqRights | null> {
    const now = Date.now();
    if (this.cache && now - this.cache.at < CACHE_TTL_MS) return this.cache.rights;
    try {
      const rights = await this.fetchRights(cookie);
      if (rights) {
        this.cache = { at: now, rights };
        return rights;
      }
    } catch {
      /* fall through to stale-positive grace */
    }
    if (this.cache && this.cache.rights.isVip && now - this.cache.at < STALE_POSITIVE_GRACE_MS) {
      return this.cache.rights;
    }
    return null;
  }

  clear(): void {
    this.cache = null;
  }

  private async fetchRights(cookie: string): Promise<QqRights | null> {
    const uin = cookie.match(/(?:^|;\s*)uin=o?(\d+)/)?.[1];
    if (!uin) return null;
    const attempts: Array<() => Promise<unknown>> = [
      () =>
        this.http.requestJson(
          `https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&data=${encodeURIComponent(
            JSON.stringify({
              req_0: {
                module: 'VipLogin.VipLoginInter',
                method: 'vip_login_base',
                param: {},
              },
            }),
          )}`,
          { platform: 'qq', cookie, timeoutMs: 8000 },
        ),
      () =>
        this.http.requestJson(
          `https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&data=${encodeURIComponent(
            JSON.stringify({
              req_0: {
                module: 'QQMusic.MusichallPlatform.PfUserInfoServer',
                method: 'GetUserBaseInfo',
                param: {},
              },
            }),
          )}`,
          { platform: 'qq', cookie, timeoutMs: 8000 },
        ),
      () =>
        this.http.requestJson(`https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg?uin=${uin}&format=json`, {
          platform: 'qq',
          cookie,
          timeoutMs: 8000,
        }),
    ];
    for (const attempt of attempts) {
      try {
        const rights = parseQqRights(await attempt());
        if (rights.isVip || rights.isSvip || rights.vipType > 0) return rights;
      } catch {
        /* try next endpoint */
      }
    }
    return null;
  }
}
