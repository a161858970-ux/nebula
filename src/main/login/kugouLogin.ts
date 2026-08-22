import type { CookieStore } from '../cookieStore';
import type { AccountInfo } from '../types';

/** 解码 KuGoo 复合值：处理 %uXXXX Unicode 编码 + 标准 URI 编码 */
function decodeKuGoo(raw: string): string {
  return decodeURIComponent(
    raw.replace(/%u([0-9a-fA-F]{4})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
  );
}

/** 从 cookie 字符串中提取指定字段的值。 */
function extractCookieValue(cookie: string, name: string): string {
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
function extractKugouUserId(cookie: string): string {
  for (const name of ['KugooID', 'kugooID', 'userid', 'UserId', 'kugouID', 'uid']) {
    const v = extractCookieValue(cookie, name);
    if (v && v !== '0') return v.replace(/\D/g, '');
  }
  const kuGoo = extractCookieValue(cookie, 'KuGoo');
  if (kuGoo) {
    try {
      const decoded = decodeKuGoo(kuGoo);
      const match = decoded.match(/(?:KugooID|userid|uid)=(\d+)/);
      if (match) return match[1];
    } catch { /* */ }
  }
  return '';
}

/**
 * 酷狗登录：Electron BrowserWindow 加载官方网页，轮询 cookie 提取登录态。
 * 成功标准：cookie 中包含 KugooID + t。
 */
export class KugouLogin {
  constructor(private cookies: CookieStore) {}

  /** 从 partition cookie 中提取登录态，返回 AccountInfo。 */
  async getAccount(): Promise<AccountInfo | null> {
    const rec = this.cookies.get('kugou');
    if (!rec?.cookies) {
      console.log('[KugouLogin] getAccount: 无存储 cookie');
      return null;
    }
    const cookie = rec.cookies;
    console.log('[KugouLogin] getAccount: cookie 长度=', cookie.length, '字段=', cookie.split(';').map(s => s.split('=')[0].trim()).join(', '));

    const kugouId = extractKugouUserId(cookie);
    if (!kugouId) {
      console.log('[KugouLogin] getAccount: 未找到 KugooID');
      return null;
    }

    // 1) 优先从 KuGoo 复合值提取昵称
    let nickname = '';
    let avatar = '';
    const kuGoo = extractCookieValue(cookie, 'KuGoo');
    if (kuGoo) {
      try {
        const decoded = decodeKuGoo(kuGoo);
        const parts = Object.fromEntries(decoded.split('&').map(p => p.split('=')));
        if (parts.NickName) nickname = parts.NickName;
        if (parts.Pic) avatar = parts.Pic;
      } catch { /* 解析失败 */ }
    }

    // 2) UserName 兜底（可能是数字 ID）
    if (!nickname) nickname = extractCookieValue(cookie, 'UserName') || rec.nickname || '';

    // 3) 如果昵称仍是纯数字或空，调 API 获取真实昵称
    if (!nickname || /^\d+$/.test(nickname)) {
      const profile = await this.fetchProfileFromApi(cookie).catch(() => null);
      if (profile?.nickname && !/^\d+$/.test(profile.nickname)) {
        nickname = profile.nickname;
      }
      if (profile?.avatar && !avatar) avatar = profile.avatar;
    }

    return {
      loggedIn: true,
      userId: kugouId,
      nickname: nickname || '酷狗用户',
      avatarUrl: avatar,
      vipType: 0,
      isVip: false,
      isSvip: false,
    };
  }

  /** 调用酷狗 H5 网关获取用户昵称（从歌单创建者信息中提取）。 */
  private async fetchProfileFromApi(cookie: string): Promise<{ nickname?: string; avatar?: string } | null> {
    const crypto = await import('node:crypto');
    const userid = extractCookieValue(cookie, 'KugooID');
    const token = extractCookieValue(cookie, 't');
    const mid = extractCookieValue(cookie, 'kg_mid') || '';
    const dfid = extractCookieValue(cookie, 'kg_dfid') || '-';
    if (!userid || !token) return null;

    const params: Record<string, string> = {
      srcappid: '2919',
      clientver: '20000',
      clienttime: String(Date.now()),
      mid: mid || String(Date.now()),
      uuid: String(Date.now()),
      dfid,
      appid: '1014',
      token,
      userid,
    };
    const bodyObj = { userid: Number(userid), token, total_ver: 979, type: 2, page: 1, pagesize: 5 };

    // H5 签名
    const sorted = Object.keys(params).sort().map(k => k + '=' + params[k]);
    sorted.push(JSON.stringify(bodyObj));
    const H5_SALT = 'NVPh5oo715z5DIWAeQlhMDsWXXQV4hwt';
    params.signature = crypto.createHash('md5').update(H5_SALT + sorted.join('') + H5_SALT).digest('hex');

    const qs = Object.entries(params).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
    const url = 'https://gateway.kugou.com/v7/get_all_list?' + qs;

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-router': 'cloudlist.service.kugou.com',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Cookie: cookie,
      },
      body: JSON.stringify(bodyObj),
    });
    const json = await res.json() as { data?: { info?: Array<Record<string, unknown>> } };
    const items = json?.data?.info ?? [];

    // 从歌单创建者信息中提取昵称
    for (const item of items) {
      const name = String(item.nickname || item.username || item.user_name || item.list_create_username || '');
      const pic = String(item.create_user_pic || item.user_pic || item.avatar || '');
      if (name) return { nickname: name, avatar: pic || undefined };
    }
    return null;
  }
}
