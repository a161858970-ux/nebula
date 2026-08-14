import fs from 'node:fs';
import path from 'node:path';
import type { Lyric } from '../types';

/**
 * 歌词磁盘缓存（与 CookieStore 同款原子写入）。
 * 按 `platform:sourceId` 缓存统一 Lyric（含 yrc/qrc 逐字原文）。
 */
export class LyricCache {
  private data: Record<string, { at: number; lyric: Lyric }> = {};
  private cacheFile: string;

  constructor(dir: string) {
    this.cacheFile = path.join(dir, 'lyric-cache.json');
    this.load();
  }

  get(platform: string, sourceId: string): Lyric | null {
    const key = `${platform}:${sourceId}`;
    const rec = this.data[key];
    if (!rec) return null;
    // 30 天缓存有效期
    if (Date.now() - rec.at > 30 * 24 * 3600 * 1000) {
      delete this.data[key];
      this.saveCache();
      return null;
    }
    return rec.lyric;
  }

  set(platform: string, sourceId: string, lyric: Lyric): void {
    this.data[`${platform}:${sourceId}`] = { at: Date.now(), lyric };
    this.saveCache();
  }

  private load(): void {
    try {
      this.data = JSON.parse(fs.readFileSync(this.cacheFile, 'utf-8')) as typeof this.data;
    } catch {
      this.data = {};
    }
  }

  private saveCache(): void {
    this.save(this.cacheFile, JSON.stringify(this.data));
  }

  private save(file: string, json: string): void {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, json, 'utf-8');
      fs.renameSync(tmp, file);
    } catch (err) {
      console.warn('[LyricCache] 保存失败:', err instanceof Error ? err.message : err);
    }
  }
}
