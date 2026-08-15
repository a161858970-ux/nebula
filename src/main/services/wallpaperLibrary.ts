import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import { execFile } from 'node:child_process';

const APP_ID = '431960';
const MAX_PROJECT_JSON = 1024 * 1024;
const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.m4v', '.mov']);
const SAFE_EXT = new Set([...IMAGE_EXT, ...VIDEO_EXT]);
const SCENE_EXT = new Set(['.pkg', '.pak']);
const CACHE_TTL_MS = 30 * 1000;

export interface WallpaperItem {
  id: string;
  title: string;
  projectType: string;
  mediaType: 'video' | 'image' | '';
  playable: boolean;
  enginePlayable: boolean;
  previewOnly: boolean;
  hasPreview: boolean;
  source: string;
}

interface Record_ {
  id: string;
  projectRoot: string;
  media: string;
  preview: string;
  scenePackage: string;
}

function normalizePath(value: string): string {
  const raw = String(value || '').trim().replace(/^"|"$/g, '');
  try {
    return raw ? path.resolve(raw) : '';
  } catch {
    return '';
  }
}

function pathKey(value: string): string {
  return normalizePath(value).replace(/[\\/]+$/, '').toLowerCase();
}

function opaqueId(value: string): string {
  return crypto.createHash('sha256').update(pathKey(value)).digest('hex').slice(0, 16);
}

function sanitizeText(value: unknown, fallback: string): string {
  const text = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  return text || fallback;
}

async function statSafe(target: string) {
  try {
    return await fs.promises.stat(target);
  } catch {
    return null;
  }
}

async function isDirectory(target: string): Promise<boolean> {
  const stat = await statSafe(target);
  return !!(stat && stat.isDirectory());
}

function knownContainers(root: string): string[] {
  return [
    path.join(root, 'steamapps', 'workshop', 'content', APP_ID),
    path.join(root, 'steamapps', 'common', 'wallpaper_engine', 'projects', 'myprojects'),
  ];
}

async function directProjectDirs(container: string): Promise<string[]> {
  let entries: fs.Dirent[] = [];
  try {
    entries = await fs.promises.readdir(container, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const root = path.join(container, entry.name);
    if ((await statSafe(path.join(root, 'project.json')))?.isFile()) out.push(root);
  }
  return out;
}

function execFileText(file: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(
      file,
      args,
      { encoding: 'utf8', windowsHide: true, timeout: 2500, maxBuffer: 256 * 1024 },
      (error, stdout) => resolve(error ? '' : String(stdout || '')),
    );
  });
}

async function registrySteamRoots(): Promise<string[]> {
  if (process.platform !== 'win32') return [];
  const queries = [
    ['HKCU\\Software\\Valve\\Steam', 'SteamPath'],
    ['HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'],
  ];
  const roots = new Set<string>();
  for (const [key, value] of queries) {
    const output = await execFileText('reg.exe', ['query', key, '/v', value]);
    const m = output.match(new RegExp(`${value}\\s+REG_\\w+\\s+(.+)$`, 'mi'));
    if (!m) continue;
    let found = normalizePath(m[1]!.replace(/\//g, path.sep));
    if (/steam\.exe$/i.test(found)) found = path.dirname(found);
    if (found) roots.add(found);
  }
  return [...roots];
}

async function readLibraryFolders(steamRoot: string): Promise<string[]> {
  const roots = new Set<string>([normalizePath(steamRoot)]);
  for (const file of [
    path.join(steamRoot, 'steamapps', 'libraryfolders.vdf'),
    path.join(steamRoot, 'config', 'libraryfolders.vdf'),
  ]) {
    try {
      const text = (await fs.promises.readFile(file, 'utf8')).replace(/^\uFEFF/, '');
      for (const match of text.matchAll(/"path"\s+"([^"]+)"/gi)) {
        const found = normalizePath(match[1]!.replace(/\\\\/g, '\\'));
        if (found) roots.add(found);
      }
    } catch {
      /* ignore */
    }
  }
  return [...roots];
}

async function discoverSteamRoots(): Promise<string[]> {
  const candidates = new Set<string>([
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'Steam') : '',
    process.env['ProgramFiles(x86)'] ? path.join(process.env['ProgramFiles(x86)'], 'Steam') : '',
    'C:\\Program Files (x86)\\Steam',
    'C:\\Program Files\\Steam',
    'D:\\Steam',
    'D:\\SteamLibrary',
    'E:\\Steam',
    'E:\\SteamLibrary',
  ].filter(Boolean).map(normalizePath));
  for (const root of await registrySteamRoots()) candidates.add(root);
  const libraries = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || !(await isDirectory(candidate))) continue;
    for (const library of await readLibraryFolders(candidate)) {
      if (await isDirectory(library)) libraries.add(library);
    }
  }
  return [...libraries];
}

function extAllowed(file: string, set: Set<string>): boolean {
  return set.has(path.extname(file).toLowerCase());
}

async function resolveProjectFile(root: string, value: string, allowed: Set<string>): Promise<string> {
  const raw = String(value || '').trim().replace(/\//g, path.sep);
  if (!raw || path.isAbsolute(raw) || /^[a-z]:/i.test(raw) || raw.includes(':')) return '';
  const target = path.resolve(root, raw);
  if (path.relative(root, target).startsWith('..' + path.sep) || path.relative(root, target) === '..') return '';
  if (!extAllowed(target, allowed)) return '';
  try {
    const stat = await fs.promises.stat(target);
    return stat.isFile() ? target : '';
  } catch {
    return '';
  }
}

async function firstProjectFile(root: string, values: string[], allowed: Set<string>): Promise<string> {
  for (const value of values) {
    const target = await resolveProjectFile(root, value, allowed);
    if (target) return target;
  }
  return '';
}

async function readProjectManifest(root: string): Promise<Record<string, any> | null> {
  const file = path.join(root, 'project.json');
  const stat = await statSafe(file);
  if (!stat || !stat.isFile() || stat.size <= 0 || stat.size > MAX_PROJECT_JSON) return null;
  try {
    const value = JSON.parse((await fs.promises.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

async function indexProject(root: string, source: string): Promise<{ item: WallpaperItem; record: Record_ } | null> {
  const project = await readProjectManifest(root);
  if (!project) return null;
  const projectType = String(project.type || '').trim().toLowerCase();
  const directExt = path.extname(String(project.file || '')).toLowerCase();
  const inferredMedia = VIDEO_EXT.has(directExt) ? 'video' : IMAGE_EXT.has(directExt) ? 'image' : '';
  const allowDirect = projectType === 'video' || projectType === 'image' || (!projectType && !!inferredMedia);
  const media = allowDirect ? await firstProjectFile(root, [String(project.file || '')], SAFE_EXT) : '';
  const scenePackage = projectType === 'scene' ? await firstProjectFile(root, ['scene.pkg', 'scene.pak', String(project.file || '')], SCENE_EXT) : '';
  const preview = await firstProjectFile(
    root,
    [project.preview, project.cover, 'preview.jpg', 'preview.jpeg', 'preview.png', 'preview.webp', 'cover.jpg', 'cover.png'],
    IMAGE_EXT,
  );
  if (!media && !preview && !scenePackage) return null;
  const mediaExt = path.extname(media).toLowerCase();
  const mediaType: 'video' | 'image' | '' = VIDEO_EXT.has(mediaExt) ? 'video' : IMAGE_EXT.has(mediaExt) ? 'image' : '';
  const id = opaqueId(root);
  return {
    item: {
      id,
      title: sanitizeText(project.title, path.basename(root)),
      projectType: projectType || mediaType || 'unknown',
      mediaType,
      playable: !!media,
      enginePlayable: !!scenePackage,
      previewOnly: !media && !scenePackage,
      hasPreview: !!preview,
      source,
    },
    record: { id, projectRoot: root, media, preview, scenePackage },
  };
}

export class WallpaperLibrary {
  private index = new Map<string, Record_>();
  private snapshot: { at: number; items: WallpaperItem[] } | null = null;
  readonly token = crypto.randomBytes(16).toString('hex');

  async list(): Promise<WallpaperItem[]> {
    if (this.snapshot && Date.now() - this.snapshot.at < CACHE_TTL_MS) return this.snapshot.items;
    const items: WallpaperItem[] = [];
    const index = new Map<string, Record_>();
    const seen = new Set<string>();
    for (const root of await discoverSteamRoots()) {
      for (const container of knownContainers(root)) {
        if (!(await isDirectory(container)) || seen.has(pathKey(container))) continue;
        seen.add(pathKey(container));
        for (const projectRoot of await directProjectDirs(container)) {
          const indexed = await indexProject(projectRoot, /workshop[\\/]content/i.test(container) ? 'workshop' : 'local');
          if (!indexed || index.has(indexed.item.id)) continue;
          items.push(indexed.item);
          index.set(indexed.item.id, indexed.record);
        }
      }
    }
    items.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
    this.index = index;
    this.snapshot = { at: Date.now(), items };
    return items;
  }

  private record(id: string): Record_ | undefined {
    return this.index.get(id.toLowerCase());
  }

  resolveMedia(id: string, kind: 'media' | 'preview'): string {
    const record = this.record(id);
    if (!record) return '';
    const target = kind === 'media' ? record.media : record.preview;
    if (!target) return '';
    const root = normalizePath(record.projectRoot);
    const resolved = normalizePath(target);
    const rel = path.relative(root, resolved);
    if (rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel)) return '';
    if (!extAllowed(resolved, SAFE_EXT)) return '';
    try {
      return fs.statSync(resolved).isFile() ? resolved : '';
    } catch {
      return '';
    }
  }

  setBackground(id: string): { url: string; type: 'video' | 'image' } | { unsupported: true; reason: string } {
    const record = this.record(id);
    if (!record) return { unsupported: true, reason: '壁纸不存在' };
    if (record.media) {
      const type = extAllowed(record.media, VIDEO_EXT) ? 'video' : 'image';
      return { url: `wallpaper://media/${id}?token=${this.token}`, type };
    }
    if (record.scenePackage) return { unsupported: true, reason: '场景壁纸需 Wallpaper Engine 运行' };
    return { unsupported: true, reason: '网页/交互壁纸暂不支持' };
  }

  /** wallpaper:// 协议处理：preview/media + Range。 */
  async handle(request: Request): Promise<Response> {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return new Response('Not found', { status: 404 });
    }
    if (url.searchParams.get('token') !== this.token) return new Response('Not found', { status: 404 });
    const kind = url.hostname === 'media' ? 'media' : url.hostname === 'preview' ? 'preview' : '';
    const id = decodeURIComponent(url.pathname.replace(/^\/+/, '')).toLowerCase();
    if (!kind || !/^[a-f0-9]{16}$/.test(id)) return new Response('Not found', { status: 404 });
    const file = this.resolveMedia(id, kind);
    if (!file) return new Response('Not found', { status: 404 });
    let stat;
    try {
      stat = await fs.promises.stat(file);
    } catch {
      return new Response('Not found', { status: 404 });
    }
    const size = stat.size;
    const mime = VIDEO_EXT.has(path.extname(file).toLowerCase())
      ? 'video/mp4'
      : 'image/jpeg';
    const rangeHeader = request.headers.get('range') ?? '';
    const m = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
    let start = 0;
    let end = Math.max(0, size - 1);
    let partial = false;
    if (m) {
      partial = true;
      if (m[1]) start = Math.max(0, Number(m[1]));
      if (m[2]) end = Math.min(size - 1, Number(m[2]));
      if (start > end || start >= size) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
      }
    }
    const headers: Record<string, string> = {
      'Content-Type': mime,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=300',
      'Cross-Origin-Resource-Policy': 'cross-origin',
      'X-Content-Type-Options': 'nosniff',
    };
    if (partial) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    if (request.method === 'HEAD') return new Response(null, { status: partial ? 206 : 200, headers });
    const stream = fs.createReadStream(file, { start, end });
    return new Response(Readable.toWeb(stream) as ReadableStream, { status: partial ? 206 : 200, headers });
  }
}
