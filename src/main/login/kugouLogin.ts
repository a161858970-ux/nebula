import type { CookieStore } from '../cookieStore';
import type { AccountInfo } from '../types';

/**
 * 酷狗登录：Electron BrowserWindow 加载官方网页，轮询 cookie 提取登录态。
 * 成功标准：cookie 中包含 userid + token。
 */
export class KugouLogin {
  constructor(private cookies: CookieStore) {}

  /** 从 partition cookie 中提取登录态，返回 AccountInfo。 */
  async getAccount(): Promise<AccountInfo | null> {
    const rec = this.cookies.get('kugou');
    if (!rec?.cookies) return null;
    const userid = this.extractValue(rec.cookies, 'userid');
    const token = rec.token || this.extractValue(rec.cookies, 'token');
    if (!userid || !token) return null;
    const nickname = this.extractValue(rec.cookies, 'NickName') || rec.nickname || '';
    const avatar = this.extractValue(rec.cookies, 'Pic') || '';
    return {
      loggedIn: true,
      userId: userid,
      nickname: decodeURIComponent(nickname),
      avatarUrl: avatar ? decodeURIComponent(avatar) : '',
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
