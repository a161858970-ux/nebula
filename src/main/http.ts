import type { CookieStore } from './cookieStore';
import type { Platform } from './types';

export interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: unknown;
  /** 表单编码请求体（与 body 互斥，用于 weapi/eapi 等加密接口）。 */
  form?: Record<string, string>;
  headers?: Record<string, string>;
  /** 显式覆盖 Cookie（默认自动附加该平台已保存的凭证）。 */
  cookie?: string;
  timeoutMs?: number;
  platform: Platform;
}

/** 各平台请求头模板：Referer / Origin / UA 用于绕过防盗链。 */
export const PLATFORM_HEADERS: Record<Platform, Record<string, string>> = {
  netease: {
    Referer: 'https://music.163.com/',
    Origin: 'https://music.163.com',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  },
  qq: {
    Referer: 'https://y.qq.com/',
    Origin: 'https://y.qq.com',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  },
  kugou: {
    Referer: 'https://www.kugou.com/',
    Origin: 'https://www.kugou.com',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  },
  spotify: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  },
};

/**
 * 统一网络层：自动附加平台 Referer/UA + CookieStore 凭证。
 * 所有适配器都通过它发起请求，保证 header 伪造与凭证注入单一收口。
 */
export class HttpClient {
  constructor(private cookies: CookieStore) {}

  async requestJson<T>(url: string, opts: RequestOptions): Promise<T> {
    const text = await this.requestText(url, opts);
    return JSON.parse(text) as T;
  }

  async requestText(url: string, opts: RequestOptions): Promise<string> {
    const res = await this.requestRaw(url, opts);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText} — ${url}`);
    }
    return res.text;
  }

  /** 返回原始响应（含响应头，QQ 扫码等场景需要读取 Set-Cookie）。 */
  async requestRaw(
    url: string,
    opts: RequestOptions,
  ): Promise<{ ok: boolean; status: number; statusText: string; headers: Headers; text: string }> {
    const headers: Record<string, string> = {
      ...PLATFORM_HEADERS[opts.platform],
      ...opts.headers,
    };
    const cookie = opts.cookie ?? this.cookies.getHeader(opts.platform);
    if (cookie) headers.Cookie = cookie;
    if (opts.platform === 'spotify') {
      const token = this.cookies.get('spotify')?.cookies;
      if (token) headers.Authorization = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 12000);
    try {
      let body: string | undefined;
      let contentType: string | undefined;
      if (opts.form) {
        body = new URLSearchParams(opts.form).toString();
        contentType = 'application/x-www-form-urlencoded';
      } else if (opts.body !== undefined) {
        body = JSON.stringify(opts.body);
        contentType = 'application/json';
      }
      if (contentType) headers['Content-Type'] = contentType;
      const res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers,
        body,
        signal: controller.signal,
      });
      return {
        ok: res.ok,
        status: res.status,
        statusText: res.statusText,
        headers: res.headers,
        text: await res.text(),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
