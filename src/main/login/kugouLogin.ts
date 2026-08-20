import type { CookieStore } from '../cookieStore';
import type { AccountInfo } from '../types';

/**
 * 酷狗登录：Electron BrowserWindow 加载官方网页，轮询 cookie 提取登录态。
 * 成功标准：cookie 中包含 userid + token。
 */
/** 解码 KuGoo 复合值：处理 %uXXXX Unicode 编码 + 标准 URI 编码 */
function decodeKuGoo(raw: string): string {
  return decodeURIComponent(
    raw.replace(/%u([0-9a-fA-F]{4})/g, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
  );
}

export class KugouLogin {
  constructor(private cookies: CookieStore) {}

  /** 从 partition cookie 中提取登录态，返回 AccountInfo。 */
  async getAccount(): Promise<AccountInfo | null> {
    const rec = this.cookies.get('kugou');
    if (!rec?.cookies) return null;
    const cookie = rec.cookies;

    // 酷狗 cookie 字段与预期不同，按实际字段名提取：
    // - KugooID: 用户 ID
    // - t: token/时间戳
    // - UserName: 用户名
    // - KuGoo: URL 编码复合值（含 KugooID/NickName/Pic）
    // - mid: 机器 ID
    const kugouId = this.extractValue(cookie, 'KugooID');
    // const token = rec.token || this.extractValue(cookie, 't');  // reserved for API auth
    if (!kugouId) return null;

    // 从 KuGoo 复合值或 UserName 提取昵称
    let nickname = this.extractValue(cookie, 'UserName') || rec.nickname || '';
    let avatar = '';
    const kuGoo = this.extractValue(cookie, 'KuGoo');
    if (kuGoo) {
      try {
        const decoded = decodeKuGoo(kuGoo);
        const parts = Object.fromEntries(decoded.split('&').map(p => p.split('=')));
        if (parts.NickName) nickname = parts.NickName;
        if (parts.Pic) avatar = parts.Pic;
      } catch { /* 解析失败用默认值 */ }
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

  /** 从 cookie 字符串中提取指定字段的值。 */
  private extractValue(cookie: string, name: string): string {
    for (const seg of cookie.split(';')) {
      const eq = seg.indexOf('=');
      if (eq <= 0) continue;
      const k = seg.slice(0, eq).trim();
      const v = seg.slice(eq + 1).trim();
      if (k === name) return v;
    }
    return '';
  }
}
