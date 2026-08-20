import type { CookieStore } from '../cookieStore';
import type { HttpClient } from '../http';
import type { Lyric, Playlist, PlatformAdapter, SongUrl, Track } from '../types';

const API = 'https://api.spotify.com/v1';

function mapSpotifyTrack(raw: Record<string, any> | undefined | null): Track | null {
  try {
    if (!raw || !raw.id || !raw.name) return null;
    const artists: Array<{ name?: string }> = raw.artists ?? [];
    return {
      id: `spotify:${raw.id}`,
      title: raw.name,
      artist: artists[0]?.name ?? '未知歌手',
      artists: artists.map((a) => a.name ?? '').filter(Boolean),
      album: raw.album?.name ?? '',
      cover: raw.album?.images?.[0]?.url ?? '',
      duration: Math.round((raw.duration_ms ?? 0) / 1000),
      platform: 'spotify',
      sourceId: String(raw.id),
      originalUrl: '',
      fallbackUrl: '',
      quality: 'ogg',
    };
  } catch {
    return null;
  }
}

/**
 * Spotify 适配器：歌单/我的歌单/搜索走官方 Web API（需 OAuth Token）。
 * 注意：Spotify 不提供 MP3 直链，播放由 SongResolver 兜底到网易云/酷狗完成。
 */
export class SpotifyAdapter implements PlatformAdapter {
  readonly platform = 'spotify' as const;

  constructor(
    private http: HttpClient,
    private cookies: CookieStore,
  ) {}

  async fetchPlaylist(playlistId: string): Promise<Playlist> {
    const data = await this.authedRequest<{
      id?: string;
      name?: string;
      images?: Array<{ url?: string }>;
      description?: string;
      tracks?: { items?: Array<{ track?: Record<string, any> }>; total?: number };
    }>(`${API}/playlists/${encodeURIComponent(playlistId)}`);
    if (!data?.id) throw new Error('Spotify 歌单不存在或需要授权');
    const items = data.tracks?.items ?? [];
    const tracks = items
      .map((it) => mapSpotifyTrack(it.track))
      .filter((t): t is Track => !!t);
    return {
      id: String(data.id),
      platform: 'spotify',
      name: data.name ?? '未命名歌单',
      cover: data.images?.[0]?.url ?? '',
      description: data.description,
      tracks,
    };
  }

  /** 无直链：返回 null，由 SongResolver 走跨平台兜底。 */
  async fetchSongUrl(_songId?: string, _albumId?: string, _quality?: string, _extra?: Record<string, unknown>): Promise<SongUrl | null> {
    return null;
  }

  async fetchLyric(): Promise<Lyric | null> {
    return null;
  }

  async searchSongs(keyword: string, pageSize = 10): Promise<Track[]> {
    try {
      const data = await this.authedRequest<{ tracks?: { items?: Array<Record<string, any>> } }>(
        `${API}/search?q=${encodeURIComponent(keyword)}&type=track&limit=${pageSize}`,
      );
      return (data?.tracks?.items ?? []).map(mapSpotifyTrack).filter((t): t is Track => !!t);
    } catch {
      return [];
    }
  }

  async getMyPlaylists() {
    try {
      const data = await this.authedRequest<{
        items?: Array<{ id?: string; name?: string; images?: Array<{ url?: string }>; tracks?: { total?: number } }>;
      }>(`${API}/me/playlists?limit=50`);
      return (data?.items ?? [])
        .map((p) => ({
          id: String(p.id ?? ''),
          name: p.name ?? '未命名歌单',
          cover: p.images?.[0]?.url ?? '',
          trackCount: p.tracks?.total ?? 0,
        }))
        .filter((p) => p.id);
    } catch {
      return [];
    }
  }

  /** 自动附带 Bearer；401 时用 refresh_token 换新后重试一次。 */
  private async authedRequest<T>(url: string): Promise<T> {
    try {
      return await this.http.requestJson<T>(url, { platform: 'spotify' });
    } catch (err) {
      const status = err instanceof Error && /HTTP 401/.test(err.message) ? 401 : 0;
      if (status !== 401 || !(await this.refreshToken())) throw err;
      return await this.http.requestJson<T>(url, { platform: 'spotify' });
    }
  }

  private async refreshToken(): Promise<boolean> {
    const rec = this.cookies.get('spotify');
    const refresh = rec?.token;
    const clientId = process.env.SPOTIFY_CLIENT_ID;
    if (!refresh || !clientId) return false;
    try {
      const res = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refresh,
          client_id: clientId,
        }).toString(),
      });
      const tok = (await res.json()) as { access_token?: string; refresh_token?: string };
      if (!tok.access_token) return false;
      this.cookies.set('spotify', tok.access_token, tok.refresh_token ?? refresh, 'Spotify');
      return true;
    } catch {
      return false;
    }
  }
}
