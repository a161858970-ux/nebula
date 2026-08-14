import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Platform } from './types';

interface CookieRecord {
  /** 原始 Cookie 头字符串，例如 `MUSIC_U=xxx; __csrf=yyy`。 */
  cookies: string;
  token?: string;
  nickname?: string;
  updatedAt: number;
}

const COOKIE_ATTRS = new Set([
  'max-age',
  'expires',
  'domain',
  'path',
  'httponly',
  'secure',
  'samesite',
  'priority',
]);

/**
 * 归一化 Cookie 头：去属性（Max-Age/Domain/Path 等）、去空白、去重（后者覆盖前者），
 * 只保留 `name=value` 对。
 */
export function normalizeCookieHeader(input: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of String(input ?? '').split(';')) {
    const seg = part.trim();
    if (!seg) continue;
    const eq = seg.indexOf('=');
    if (eq <= 0) continue;
    const rawName = seg.slice(0, eq).trim();
    const name = rawName.toLowerCase();
    if (!name || COOKIE_ATTRS.has(name)) continue;
    const value = seg.slice(eq + 1).trim();
    if (!value) continue;
    if (seen.has(name)) {
      const i = out.findIndex((s) => s.slice(0, s.indexOf('=')).trim().toLowerCase() === name);
      if (i >= 0) out[i] = `${rawName}=${value}`;
      continue;
    }
    seen.add(name);
    out.push(`${rawName}=${value}`);
  }
  return out.join('; ');
}

export type CookieValidation = { ok: true } | { ok: false; error: string };

/** 平台 Cookie 有效性校验（不探测，仅结构检查）。 */
export function validatePlatformCookie(platform: Platform, normalized: string): CookieValidation {
  if (!normalized) return { ok: false, error: 'cookie 为空' };
  const pairs = new Map(
    normalized.split(';').map((s) => {
      const eq = s.indexOf('=');
      return [s.slice(0, eq).trim().toLowerCase(), s.slice(eq + 1).trim()];
    }),
  );
  if (platform === 'netease') {
    if (!pairs.get('music_u')) {
      return { ok: false, error: 'INVALID_NETEASE_COOKIE: cookie 缺少 MUSIC_U' };
    }
    return { ok: true };
  }
  if (platform === 'qq') {
    const hasUin = !!pairs.get('uin');
    const hasTicket =
      !!pairs.get('music_key') ||
      !!pairs.get('qm_keyst') ||
      !!pairs.get('qqmusic_key') ||
      !!pairs.get('p_skey') ||
      !!pairs.get('skey');
    if (!hasUin) return { ok: false, error: 'INVALID_QQ_COOKIE: cookie 缺少 uin' };
    if (!hasTicket) {
      return {
        ok: false,
        error: 'INVALID_QQ_COOKIE: 缺少播放票据（music_key / qm_keyst / p_skey / skey 至少其一）',
      };
    }
    return { ok: true };
  }
  return { ok: true };
}

/** 由 Electron 主进程注入（app.getPath('userData')），Node 环境默认 ~/.music-nebula。 */
let dataDir = process.env.NEBULA_DATA_DIR || path.join(os.homedir(), '.music-nebula');

export function setCookieDataDir(dir: string): void {
  dataDir = dir;
}

/**
 * 平台 Cookie/Token 隔离与持久化：
 * - 按平台分桶存储，互不串扰；
 * - 写入采用「临时文件 + rename」原子替换，避免半写损坏；
 * - 明文存 JSON（生产可替换为 keytar/DPAPI 加密）。
 */
export class CookieStore {
  private file: string;
  private data: Partial<Record<Platform, CookieRecord>> = {};

  constructor(filePath?: string) {
    this.file = filePath || path.join(dataDir, 'cookies.json');
    this.load();
  }

  set(platform: Platform, cookies: string, token?: string, nickname?: string): void {
    const normalized = normalizeCookieHeader(cookies);
    this.data[platform] = {
      cookies: normalized,
      token,
      nickname,
      updatedAt: Date.now(),
    };
    this.save();
  }

  get(platform: Platform): CookieRecord | undefined {
    return this.data[platform];
  }

  /** 生成可直接写入请求头的 Cookie 字符串。 */
  getHeader(platform: Platform): string | undefined {
    return this.data[platform]?.cookies;
  }

  has(platform: Platform): boolean {
    return !!this.data[platform]?.cookies;
  }

  clear(platform: Platform): void {
    delete this.data[platform];
    this.save();
  }

  get filePath(): string {
    return this.file;
  }

  private load(): void {
    try {
      const raw = fs.readFileSync(this.file, 'utf-8');
      this.data = JSON.parse(raw) as Partial<Record<Platform, CookieRecord>>;
    } catch {
      this.data = {};
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8');
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.warn('[CookieStore] 保存失败:', err instanceof Error ? err.message : err);
    }
  }
}
