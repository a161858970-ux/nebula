import http from 'node:http';
import https from 'node:https';
import type { Platform } from './types';
import { PLATFORM_HEADERS } from './http';

/**
 * 音源 URL 真实探测（借鉴 Mineradio 的“多音质探测 + 失败换源”思路）：
 * 拿到的直链不直接交给 <audio>，而是先按平台注入 Referer/UA/Cookie 抓前几十字节，
 * 校验确实是音频（magic bytes / audio content-type），403、死链、返回 HTML 的一律判失败，
 * 由 SongResolver 继续换源，从源头杜绝“假链接 + 前端空转”。
 */

export interface ProbeOptions {
  platform: Platform;
  cookie?: string;
  timeoutMs?: number;
  bytes?: number;
}

export interface ProbeResult {
  ok: boolean;
  status?: number;
  contentType?: string;
  reason?: string;
}

const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_BYTES = 64;

/** 短 TTL 结果缓存：同一 URL 10 分钟内不重复探测（切歌/重播时避免重复等待）。*/
const cache = new Map<string, { at: number; result: ProbeResult }>();
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 500;

function cacheGet(url: string): ProbeResult | undefined {
  const hit = cache.get(url);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(url);
    return undefined;
  }
  return hit.result;
}

function cacheSet(url: string, result: ProbeResult): void {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(url, { at: Date.now(), result });
}

/** 判断前 N 字节是否像真实音频（MP3/FLAC/M4A/OGG/WAV/AAC）。*/
export function looksLikeAudio(buf: Buffer, contentType?: string): boolean {
  const ct = (contentType ?? '').toLowerCase();
  if (ct.startsWith('audio/')) return true;
  if (ct && (ct.startsWith('text/') || ct.includes('html'))) return false;
  if (buf.length >= 3 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true; // ID3
  if (buf.length >= 4 && buf.toString('latin1', 0, 4) === 'fLaC') return true;
  if (buf.length >= 8 && buf.toString('latin1', 4, 8) === 'ftyp') return true; // mp4/m4a
  if (buf.length >= 4 && buf.toString('latin1', 0, 4) === 'OggS') return true;
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WAVE')
    return true;
  if (buf.length >= 2 && buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return true; // MP3 frame sync
  return false;
}

interface FetchResult {
  status: number;
  contentType: string;
  bytes: Buffer;
  truncated: boolean;
}

function requestBytes(target: URL, opts: ProbeOptions, limit: number): Promise<FetchResult> {
  return new Promise<FetchResult>((resolve, reject) => {
    const headers: Record<string, string> = {
      ...PLATFORM_HEADERS[opts.platform],
      Accept: '*/*',
      Range: `bytes=0-${limit - 1}`,
    };
    if (opts.cookie) headers.Cookie = opts.cookie;

    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let settled = false;
    let current = target;
    let redirects = 0;

    const attempt = (): void => {
      const isHttps = current.protocol === 'https:';
      const transport = isHttps ? https : http;
      const req = transport.request(
        current,
        { method: 'GET', headers, timeout: timeoutMs },
        (res) => {
          const status = res.statusCode ?? 502;
          if (status >= 300 && status < 400 && res.headers.location && redirects < 3) {
            res.resume();
            try {
              current = new URL(res.headers.location, current);
            } catch {
              current = new URL(res.headers.location, current.origin);
            }
            redirects++;
            attempt();
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          let truncated = false;
          res.on('data', (chunk: Buffer) => {
            if (size >= limit) return;
            const need = limit - size;
            chunks.push(chunk.length > need ? chunk.subarray(0, need) : chunk);
            size += Math.min(chunk.length, need);
            if (size >= limit) {
              truncated = true;
              res.destroy();
              if (!settled) {
                settled = true;
                resolve({
                  status,
                  contentType: String(res.headers['content-type'] ?? ''),
                  bytes: Buffer.concat(chunks),
                  truncated,
                });
              }
            }
          });
          res.on('end', () => {
            if (settled) return;
            settled = true;
            resolve({
              status,
              contentType: String(res.headers['content-type'] ?? ''),
              bytes: Buffer.concat(chunks),
              truncated,
            });
          });
          res.on('aborted', () => {
            if (settled) return;
            settled = true;
            resolve({
              status,
              contentType: String(res.headers['content-type'] ?? ''),
              bytes: Buffer.concat(chunks),
              truncated: true,
            });
          });
          res.on('error', (err) => {
            if (settled) return;
            settled = true;
            reject(err);
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error('probe timeout')));
      req.on('error', (err) => {
        if (settled) return;
        settled = true;
        reject(err);
      });
      req.end();
    };

    attempt();
  });
}

/**
 * 探测单个音源 URL。
 * - 200/206 + 音频 magic/content-type => ok
 * - 403/4xx/5xx、HTML、非音频 => 失败并附原因
 */
export async function probeAudioUrl(rawUrl: string, opts: ProbeOptions): Promise<ProbeResult> {
  if (!rawUrl) return { ok: false, reason: 'empty url' };
  const cached = cacheGet(rawUrl);
  if (cached) return cached;

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'invalid url' };
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    return { ok: false, reason: 'protocol not allowed' };
  }

  const limit = Math.max(16, Math.min(4096, opts.bytes ?? DEFAULT_BYTES));
  try {
    const res = await requestBytes(target, opts, limit);
    const looksAudio = looksLikeAudio(res.bytes, res.contentType);
    const result: ProbeResult = {
      ok: (res.status === 200 || res.status === 206) && looksAudio,
      status: res.status,
      contentType: res.contentType || undefined,
      reason: !looksAudio
        ? '响应不是音频内容（可能返回了 HTML 错误页）'
        : `HTTP ${res.status} 非可播状态`,
    };
    if (result.ok) {
      cacheSet(rawUrl, result);
    }
    return result;
  } catch (err) {
    const result: ProbeResult = {
      ok: false,
      reason: err instanceof Error ? err.message : String(err),
    };
    return result;
  }
}

/** 便捷封装：只关心能否播放。*/
export async function canPlayAudio(rawUrl: string, opts: ProbeOptions): Promise<boolean> {
  const r = await probeAudioUrl(rawUrl, opts);
  return r.ok;
}
