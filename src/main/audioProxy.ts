import http from 'node:http';
import https from 'node:https';
import type { CookieStore } from './cookieStore';
import { PLATFORM_HEADERS } from './http';
import type { Platform } from './types';

/**
 * 本地音频代理（主进程）。
 *
 * 渲染进程 <audio> 不直连平台原始 URL，统一走 `http://127.0.0.1:PORT/api/audio?url=...`：
 * - 按域名注入 Referer/Origin/UA + 平台 Cookie；
 * - 透传 Range，回写 Content-Type/Content-Length/Content-Range/Accept-Ranges；
 * - 上游 keep-alive 连接复用（降低 seek/切歌时的首字节延迟）；
 * - 仅当客户端中途断开且响应未结束时才中止上游，避免误 abort。
 */

const ALLOWED_HOSTS: Array<{ host: string; platform: Platform }> = [
  { host: 'music.163.com', platform: 'netease' },
  { host: '.music.163.com', platform: 'netease' },
  { host: '.music.126.net', platform: 'netease' },
  { host: '.qq.com', platform: 'qq' },
  { host: '.gtimg.cn', platform: 'qq' },
  { host: '.gtimg.com', platform: 'qq' },
  { host: '.qpic.cn', platform: 'qq' },
  { host: '.kugou.com', platform: 'kugou' },
  { host: '.kugou.com.cn', platform: 'kugou' },
  { host: '.kugou.net', platform: 'kugou' },
];

const MAX_REDIRECTS = 3;
const UPSTREAM_TIMEOUT_MS = 30000;

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 16 });
const httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 16, timeout: UPSTREAM_TIMEOUT_MS });

function matchPlatform(hostname: string): Platform | null {
  const h = hostname.toLowerCase();
  for (const rule of ALLOWED_HOSTS) {
    if (rule.host.startsWith('.')) {
      if (h === rule.host.slice(1) || h.endsWith(rule.host)) return rule.platform;
    } else if (h === rule.host) {
      return rule.platform;
    }
  }
  return null;
}

export class AudioProxy {
  private server: http.Server | null = null;
  private port = 0;

  constructor(private cookies: CookieStore) {}

  start(): void {
    if (this.server) return;
    this.server = http.createServer((req, res) => {
      void this.handle(req, res);
    });
    this.server.listen(0, '127.0.0.1', () => {
      const addr = this.server?.address();
      if (addr && typeof addr === 'object') this.port = addr.port;
    });
  }

  /** 平台原始 URL → 代理地址（已是代理地址则原样返回）。 */
  urlFor(rawUrl: string): string {
    if (!rawUrl) return rawUrl;
    if (/^http:\/\/127\.0\.0\.1:\d+\/api\/audio/.test(rawUrl)) return rawUrl;
    if (!this.port) return rawUrl;
    return `http://127.0.0.1:${this.port}/api/audio?url=${encodeURIComponent(rawUrl)}`;
  }

  dispose(): void {
    this.server?.close();
    this.server = null;
    this.port = 0;
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Range, Content-Type');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`);
    if (url.pathname !== '/api/audio') {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    const target = url.searchParams.get('url');
    if (!target) {
      res.statusCode = 400;
      res.end('missing url');
      return;
    }

    let upstream: URL;
    try {
      upstream = new URL(target);
    } catch {
      res.statusCode = 400;
      res.end('bad url');
      return;
    }
    if (upstream.protocol !== 'https:' && upstream.protocol !== 'http:') {
      res.statusCode = 400;
      res.end('protocol not allowed');
      return;
    }
    const platform = matchPlatform(upstream.hostname);
    if (!platform) {
      res.statusCode = 403;
      res.end('host not allowed');
      return;
    }

    const headers: Record<string, string> = {
      ...PLATFORM_HEADERS[platform],
      Accept: '*/*',
    };
    const cookie = this.cookies.getHeader(platform);
    if (cookie) headers.Cookie = cookie;
    const range = req.headers.range;
    if (range) headers.Range = range;

    // 客户端中途断开且响应未结束时才中止上游
    const onClientClose = () => {
      if (!res.writableEnded) upstreamReq?.destroy();
    };
    res.on('close', onClientClose);

    let upstreamReq: http.ClientRequest | null = null;
    let current = upstream;
    for (let redirects = 0; ; redirects++) {
      const isHttps = current.protocol === 'https:';
      const transport = isHttps ? https : http;
      try {
        const done = await new Promise<boolean>((resolve) => {
          const r = transport.request(
            current,
            {
              method: req.method === 'HEAD' ? 'HEAD' : 'GET',
              headers,
              agent: isHttps ? httpsAgent : httpAgent,
              timeout: UPSTREAM_TIMEOUT_MS,
            },
            (upRes) => {
              const status = upRes.statusCode ?? 502;
              if (status >= 300 && status < 400 && upRes.headers.location && redirects < MAX_REDIRECTS) {
                upRes.resume();
                try {
                  current = new URL(upRes.headers.location, current);
                } catch {
                  current = new URL(upRes.headers.location, current.origin);
                }
                resolve(false);
                return;
              }
              res.statusCode = status;
              const copy = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag', 'cache-control'];
              for (const name of copy) {
                const v = upRes.headers[name];
                if (v !== undefined) res.setHeader(name, Array.isArray(v) ? v.join(', ') : v);
              }
              if (req.method === 'HEAD') {
                res.end();
                resolve(true);
                return;
              }
              upRes.pipe(res);
              upRes.on('end', () => resolve(true));
              upRes.on('error', () => resolve(true));
            },
          );
          r.on('timeout', () => r.destroy(new Error('upstream timeout')));
          r.on('error', (err) => {
            if (!res.writableEnded) {
              res.statusCode = 502;
              res.end(`proxy error: ${err.message}`);
            }
            resolve(true);
          });
          r.end();
          upstreamReq = r;
        });
        if (done) return;
        if (redirects >= MAX_REDIRECTS) {
          res.statusCode = 502;
          res.end('too many redirects');
          return;
        }
      } catch (err) {
        if (!res.writableEnded) {
          res.statusCode = 502;
          res.end(`proxy error: ${err instanceof Error ? err.message : String(err)}`);
        }
        return;
      }
    }
  }
}
