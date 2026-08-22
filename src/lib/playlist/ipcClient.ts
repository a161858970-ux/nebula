import type { Track } from '../catalog';

/** 与 src/main/types.ts 对齐的桌面端数据结构（渲染进程侧只读映射）。 */
export interface DesktopTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  cover: string;
  duration: number;
  platform: string;
  sourceId: string;
  originalUrl: string;
  fallbackUrl: string;
  quality?: string;
}

export interface DesktopResolveResult {
  url: string;
  fallback: boolean;
  platform: string;
  sourceId: string;
  trial?: boolean;
  trialEndTime?: number;
  quality?: string;
  playable?: boolean;
  error?: string;
}

export interface DesktopQualityOption {
  level: string;
  label: string;
  needsVip?: boolean;
  needsSvip?: boolean;
}

export interface DesktopPlaylistResult {
  platformName: string;
  name: string;
  cover: string;
  tracks: DesktopTrack[];
}

export interface DesktopPlaylistSummary {
  id: string;
  name: string;
  cover: string;
  trackCount: number;
}

export interface DesktopLoginPlatform {
  platform: string;
  name: string;
  kind: 'qr' | 'oauth' | 'window' | 'unavailable';
  unavailableReason: string | null;
}

export interface DesktopAccountInfo {
  loggedIn: boolean;
  userId?: string;
  nickname?: string;
  avatarUrl?: string;
  vipType?: number;
  isVip?: boolean;
  isSvip?: boolean;
}

export interface DesktopWallpaperItem {
  id: string;
  title: string;
  projectType: string;
  mediaType: 'video' | 'image' | '';
  playable: boolean;
  enginePlayable: boolean;
  previewOnly: boolean;
  hasPreview: boolean;
  source: string;
  previewUrl: string;
  mediaUrl: string;
}

export type DesktopWallpaperSetResult =
  | { url: string; type: 'video' | 'image' }
  | { unsupported: true; reason: string };

export interface DesktopArtistRef {
  id: string;
  name: string;
}

export interface DesktopSongDetail {
  platform: string;
  title: string;
  artists: DesktopArtistRef[];
  album: { id: string; name: string; cover: string; publishDate?: string };
  duration?: number;
  credits?: Array<{ role: string; name: string }>;
}

export interface DesktopArtistInfo {
  platform: string;
  id: string;
  name: string;
  avatar: string;
  description?: string;
}

export interface DesktopAlbumSummary {
  platform: string;
  id: string;
  name: string;
  cover: string;
  year?: number;
  songCount?: number;
}

/** 全网歌手搜索命中（含平台定位，可直接打开歌手页）。 */
export interface DesktopArtistHit {
  platform: string;
  id: string;
  name: string;
  avatar?: string;
}

type IpcResult<T> = Promise<{ ok: true; data: T } | { ok: false; error: string }>;

export interface DesktopApi {
  importPlaylist: (url: string) => IpcResult<DesktopPlaylistResult>;
  resolveSong: (track: DesktopTrack, quality?: string) => IpcResult<DesktopResolveResult | null>;
  songQualities: (track: DesktopTrack) => IpcResult<DesktopQualityOption[]>;
  fallbackSong: (track: DesktopTrack) => IpcResult<DesktopTrack | null>;
  fetchLyric: (track: DesktopTrack) => IpcResult<unknown>;
  fetchComments: (track: DesktopTrack) => IpcResult<unknown>;
  songDetail: (track: DesktopTrack) => IpcResult<DesktopSongDetail | null>;
  artistInfo: (platform: string, artistId: string) => IpcResult<DesktopArtistInfo | null>;
  artistSongs: (platform: string, artistId: string) => IpcResult<DesktopTrack[]>;
  artistAlbums: (platform: string, artistId: string) => IpcResult<DesktopAlbumSummary[]>;
  searchSongs: (keyword: string, pageSize?: number) => IpcResult<DesktopTrack[]>;
  searchArtists: (keyword: string, pageSize?: number) => IpcResult<DesktopArtistHit[]>;
  loginQr: () => IpcResult<{ unikey: string; payload: string }>;
  loginPoll: (unikey: string) => IpcResult<{ ok: boolean; message: string }>;
  loginPlatforms: () => IpcResult<DesktopLoginPlatform[]>;
  loginQrFor: (platform: string) => IpcResult<{ unikey: string; payload: string; imageDataUrl?: string }>;
  loginPollFor: (platform: string, unikey: string) => IpcResult<{ ok: boolean; message: string }>;
  loginAccount: (platform: string) => IpcResult<DesktopAccountInfo | null>;
  loginPlaylists: (platform: string) => IpcResult<DesktopPlaylistSummary[]>;
  importPlaylistId: (platform: string, id: string) => IpcResult<DesktopPlaylistResult>;
  spotifyLoginStart: () => IpcResult<boolean>;
  spotifyLoginStatus: () => IpcResult<boolean>;
  qqLoginWindow: () => IpcResult<{ ok: boolean; message?: string; error?: string }>;
  kugouLoginWindow: () => IpcResult<{ ok: boolean; message?: string; error?: string }>;
  openLocalDirectory: () => IpcResult<{ tracks: DesktopTrack[]; canceled?: boolean }>;
  openExternal: (url: string) => IpcResult<boolean>;
  wallpaperList: () => IpcResult<DesktopWallpaperItem[]>;
  wallpaperInfo: () => IpcResult<{ weInstalled: boolean; weLaunchUrl: string }>;
  wallpaperSet: (id: string) => IpcResult<DesktopWallpaperSetResult>;
  wallpaperOpen: () => IpcResult<boolean>;
  wallpaperApplied: (data: DesktopWallpaperSetResult) => void;
  onWallpaperApplied: (cb: (data: DesktopWallpaperSetResult) => void) => () => void;
  setCookie: (platform: string, cookie: string, token?: string, nickname?: string) => IpcResult<boolean>;
  getCookie: (platform: string) => IpcResult<unknown>;
  clearCookie: (platform: string) => IpcResult<boolean>;
}

declare global {
  interface Window {
    nebulaAPI?: DesktopApi;
  }
}

export function hasDesktopAPI(): boolean {
  return typeof window !== 'undefined' && !!window.nebulaAPI?.importPlaylist;
}

function hueFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** 后端标准 Track → 前端 Track（保留平台 sourceId 供后续取流/歌词/评论）。 */
export function toFrontendTrack(
  t: DesktopTrack,
  index: number,
  extra?: { trial?: boolean; trialEndTime?: number; quality?: string },
): Track {
  const hue = hueFromId(t.id);
  return {
    id: index,
    title: t.title,
    artist: t.artist,
    style: t.platform,
    hue1: hue,
    hue2: (hue + 80) % 360,
    audio: t.originalUrl || t.fallbackUrl || '',
    source: t.platform,
    sourceId: t.sourceId,
    album: t.album,
    cover: t.cover,
    duration: t.duration,
    trial: extra?.trial,
    trialEndTime: extra?.trialEndTime,
    quality: extra?.quality ?? t.quality,
  };
}

/** 前端 Track → 后端标准 Track（IPC 用）。 */
export function toBackendTrack(t: Track): DesktopTrack {
  return {
    id: `${t.source}:${t.sourceId ?? t.id}`,
    title: t.title,
    artist: t.artist,
    album: t.album ?? '',
    cover: t.cover ?? '',
    duration: t.duration ?? 0,
    platform: t.source,
    sourceId: t.sourceId ?? String(t.id),
    originalUrl: t.audio,
    fallbackUrl: '',
  };
}
