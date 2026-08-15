import type { AdapterMap, UrlTarget } from './adapters/index';
import { resolveAdapterByUrl } from './adapters/index';
import type { CookieStore } from './cookieStore';
import type { NeteaseLogin } from './login/neteaseLogin';
import type { SongResolver } from './services/songResolver';
import type { LyricService } from './services/lyricService';
import type { Platform, Track } from './types';
import type { LoginAdapter } from './login/index';
import type { AudioProxy } from './audioProxy';
import type { WallpaperLibrary } from './services/wallpaperLibrary';
import { normalizeCookieHeader, validatePlatformCookie } from './cookieStore';

/** 仅依赖 ipcMain.handle 形状，避免在纯 Node 冒烟测试中引入 electron。 */
export interface IpcLike {
  handle(channel: string, fn: (event: unknown, payload: any) => Promise<unknown>): void;
}

export interface IpcDeps {
  adapters: AdapterMap;
  resolver: SongResolver;
  lyricService: LyricService;
  cookies: CookieStore;
  login: NeteaseLogin;
  loginAdapters: Record<string, LoginAdapter>;
  audioProxy: AudioProxy;
  spotifyOAuth?: { start: () => Promise<boolean>; status: () => boolean };
  qqLoginWindow?: () => Promise<{ ok: boolean; message?: string; error?: string }>;
  /** Optional hook invoked after a platform cookie is cleared (e.g. purge Electron partition sessions). */
  onCookieClear?: (platform: Platform) => Promise<void> | void;
  wallpaperLibrary?: WallpaperLibrary;
}

export function registerIpcHandlers(ipcMain: IpcLike, deps: IpcDeps): void {
  const safe = (channel: string, fn: (payload: any) => Promise<unknown>) => {
    ipcMain.handle(channel, async (_event, payload) => {
      try {
        return { ok: true, data: await fn(payload) };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    });
  };

  safe('nebula:import-playlist', async ({ url }: { url?: string }) => {
    if (!url) throw new Error('缺少歌单链接');
    const target: UrlTarget | null = resolveAdapterByUrl(url);
    if (!target) throw new Error('无法识别的歌单链接（支持网易云 / QQ音乐 / 酷狗）');
    const playlist = await deps.adapters[target.platform].fetchPlaylist(target.id);
    return {
      platformName: target.platform,
      name: playlist.name,
      cover: playlist.cover,
      tracks: playlist.tracks,
    };
  });

  safe('nebula:import-playlist-id', async ({ platform, id }: { platform: Platform; id: string }) => {
    const playlist = await deps.adapters[platform].fetchPlaylist(id);
    return {
      platformName: platform,
      name: playlist.name,
      cover: playlist.cover,
      tracks: playlist.tracks,
    };
  });

  safe('nebula:resolve-song', async ({ track, quality }: { track: Track; quality?: string }) => {
    const result = await deps.resolver.resolve(track, quality);
    if (!result) return null;
    return { ...result, url: deps.audioProxy.urlFor(result.url) };
  });
  safe('nebula:song-qualities', async ({ track }: { track: Track }) => {
    const fn = deps.adapters[track.platform]?.listQualities;
    if (!fn) return [];
    return fn(track.sourceId);
  });
  safe('nebula:fallback-song', async ({ track }: { track: Track }) => {
    const result = await deps.resolver.enrichFallback(track);
    return {
      ...result,
      originalUrl: deps.audioProxy.urlFor(result.originalUrl),
      fallbackUrl: deps.audioProxy.urlFor(result.fallbackUrl),
    };
  });
  safe('nebula:lyric', async ({ track }: { track: Track }) => deps.lyricService.fetchLyric(track));
  safe('nebula:comments', async ({ track }: { track: Track }) => deps.lyricService.fetchComments(track));
  safe('nebula:song-detail', async ({ track }: { track: Track }) => deps.lyricService.fetchSongDetail(track));
  safe('nebula:artist-info', async ({ platform, artistId }: { platform: Platform; artistId: string }) =>
    deps.lyricService.fetchArtistInfo(platform, String(artistId)),
  );
  safe('nebula:artist-songs', async ({ platform, artistId }: { platform: Platform; artistId: string }) =>
    deps.lyricService.fetchArtistSongs(platform, String(artistId)),
  );
  safe('nebula:artist-albums', async ({ platform, artistId }: { platform: Platform; artistId: string }) =>
    deps.lyricService.fetchArtistAlbums(platform, String(artistId)),
  );

  safe('nebula:wallpaper:list', async () => {
    const lib = deps.wallpaperLibrary;
    if (!lib) throw new Error('wallpaper 库不可用');
    const items = await lib.list();
    return items.map((it) => ({
      ...it,
      previewUrl: it.hasPreview ? `wallpaper://preview/${it.id}?token=${lib.token}` : '',
      mediaUrl: it.playable ? `wallpaper://media/${it.id}?token=${lib.token}` : '',
    }));
  });
  safe('nebula:wallpaper:info', async () => ({
    weInstalled: deps.wallpaperLibrary?.wallpapersEngineInstalled() ?? false,
    weLaunchUrl: deps.wallpaperLibrary?.wallpapersEngineLaunchUrl() ?? '',
  }));
  safe('nebula:wallpaper:set', async ({ id }: { id: string }) => {
    const lib = deps.wallpaperLibrary;
    if (!lib) throw new Error('wallpaper 库不可用');
    return lib.setBackground(String(id));
  });

  safe('nebula:cookie:set', async ({ platform, cookie, token, nickname }: { platform: Platform; cookie: string; token?: string; nickname?: string }) => {
    const normalized = normalizeCookieHeader(cookie);
    const validation = validatePlatformCookie(platform, normalized);
    if (!validation.ok) {
      throw new Error(validation.error);
    }
    deps.cookies.set(platform, normalized, token, nickname);
    return true;
  });
  safe('nebula:cookie:get', async ({ platform }: { platform: Platform }) => deps.cookies.get(platform) ?? null);
  safe('nebula:cookie:clear', async ({ platform }: { platform: Platform }) => {
    deps.cookies.clear(platform);
    if (deps.onCookieClear) await deps.onCookieClear(platform);
    return true;
  });

  safe('nebula:login:qr', async () => deps.login.createQr());
  safe('nebula:login:poll', async ({ unikey }: { unikey: string }) => deps.login.pollLogin(unikey));
  safe('nebula:login:platforms', async () =>
    Object.values(deps.loginAdapters).map((a) => ({
      platform: a.platform,
      name: a.name,
      kind: a.kind,
      unavailableReason: a.unavailableReason ?? null,
    })),
  );
  safe('nebula:login:qr-platform', async ({ platform }: { platform: string }) => {
    const a = deps.loginAdapters[platform];
    if (!a?.createQr) throw new Error(`平台 ${platform} 不支持扫码登录`);
    return a.createQr();
  });
  safe('nebula:login:poll-platform', async ({ platform, unikey }: { platform: string; unikey: string }) => {
    const a = deps.loginAdapters[platform];
    if (!a?.pollLogin) throw new Error(`平台 ${platform} 不支持扫码登录`);
    return a.pollLogin(unikey);
  });
  safe('nebula:login:account', async ({ platform }: { platform: string }) => {
    const a = deps.loginAdapters[platform];
    if (!a?.getAccount) return null;
    return a.getAccount();
  });
  safe('nebula:login:playlists', async ({ platform }: { platform: string }) => {
    const a = deps.loginAdapters[platform];
    if (!a?.getMyPlaylists) return [];
    return a.getMyPlaylists();
  });
  safe('nebula:login:spotify:start', async () => {
    if (!deps.spotifyOAuth) throw new Error('Spotify OAuth 未配置');
    return deps.spotifyOAuth.start();
  });
  safe('nebula:login:spotify:status', async () => {
    if (!deps.spotifyOAuth) return false;
    return deps.spotifyOAuth.status();
  });
  safe('nebula:login:qq:window', async () => {
    if (!deps.qqLoginWindow) throw new Error('QQ 登录窗口不可用');
    return deps.qqLoginWindow();
  });
}
