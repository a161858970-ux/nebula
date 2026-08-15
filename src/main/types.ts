/** Unified data model shared by every platform adapter. */

export type Platform = 'netease' | 'qq' | 'kugou' | 'spotify';

export interface Track {
  /** Unified id (`${platform}:${sourceId}`, stable across platforms). */
  id: string;
  title: string;
  artist: string;
  artists?: string[];
  album: string;
  /** https cover URL (empty when none). */
  cover: string;
  /** Duration in seconds. */
  duration: number;
  platform: Platform;
  /** Platform-native song id (netease song id / QQ songmid / kugou hash). */
  sourceId: string;
  /** Primary platform direct URL (may be empty; filled by SongResolver). */
  originalUrl: string;
  /** Downgraded backup direct URL (kugou etc. fallback platform). */
  fallbackUrl: string;
  quality?: string;
  /** Platform-specific extra fields (e.g. kugou AlbumID). */
  extra?: Record<string, unknown>;
}

export interface LyricLine {
  timeMs: number;
  text: string;
  /** Translation bound to the same timeline. */
  translation?: string;
}

export interface Lyric {
  lines: LyricLine[];
  raw: string;
  translationRaw?: string;
  /** Romanized lyric (netease lyric romalrc). */
  romanRaw?: string;
  /** Source platform, e.g. netease / qq / kugou. */
  source?: string;
  /** Raw LRC text matching the primary source (for frontend). */
  lrc?: string;
  tlyric?: string;
  romalrc?: string;
  /** Raw word-level lyric (netease YRC). */
  yrc?: string;
  /** Netease word-level translation (ytlrc). */
  ytlrc?: string;
  /** QQ raw QRC (word-level); frontend maps it into `yrc` when yrc is absent. */
  qrc?: string;
}

export interface CommentItem {
  id: string;
  nickname: string;
  avatarUrl: string;
  content: string;
  likedCount: number;
}

export interface CommentResult {
  hot: CommentItem[];
  latest: CommentItem[];
}

export interface Playlist {
  id: string;
  platform: Platform;
  name: string;
  cover: string;
  description?: string;
  tracks: Track[];
}

export interface SongUrl {
  url: string;
  quality?: string;
  level?: string;
  /** Whether this is a trial segment (freeTrialInfo). */
  trial?: boolean;
  /** Trial segment end time (ms, freeTrialInfo.endTime). */
  trialEndTime?: number;
  playable?: boolean;
  /** Explicit fetch failure reason (never a silent empty url). */
  error?: string;
}

export interface ResolveResult {
  url: string;
  /** true when the source came from a fallback platform (kugou etc.). */
  fallback: boolean;
  platform: Platform;
  sourceId: string;
  trial?: boolean;
  trialEndTime?: number;
  quality?: string;
  playable?: boolean;
  error?: string;
}

/** Quality option surfaced to the frontend quality picker. */
export interface QualityOption {
  level: string;
  label: string;
  needsVip?: boolean;
  needsSvip?: boolean;
}

/** Unified platform adapter interface. */
export interface PlatformAdapter {
  platform: Platform;
  fetchPlaylist(playlistId: string): Promise<Playlist>;
  fetchSongUrl(songId: string, albumId?: string, quality?: string): Promise<SongUrl | null>;
  fetchLyric(songId: string, timeMs?: number): Promise<Lyric | null>;
  fetchComments?(songId: string): Promise<CommentResult | null>;
  fetchSongDetail?(songId: string): Promise<SongDetail | null>;
  fetchArtistInfo?(artistId: string): Promise<ArtistInfo | null>;
  fetchArtistSongs?(artistId: string): Promise<Track[]>;
  fetchArtistAlbums?(artistId: string): Promise<AlbumSummary[]>;
  /** Only fallback platforms (kugou) implement: keyword search. */
  searchSongs?(keyword: string, pageSize?: number): Promise<Track[]>;
  /** Quality options available for the current account (netease/qq). */
  listQualities?(songId?: string): Promise<QualityOption[]>;
}

/** User playlist summary (shown after login). */
export interface PlaylistSummary {
  id: string;
  name: string;
  cover: string;
  trackCount: number;
}

export interface AccountInfo {
  /** Login probe result: false means cookie invalid / not logged in. */
  loggedIn: boolean;
  userId?: string;
  nickname?: string;
  avatarUrl?: string;
  vipType?: number;
  isVip?: boolean;
  isSvip?: boolean;
}

export interface ArtistRef {
  id: string;
  name: string;
}

export interface SongDetail {
  platform: Platform;
  title: string;
  artists: ArtistRef[];
  album: { id: string; name: string; cover: string; publishDate?: string };
  duration?: number;
  /** 制作团队（作词/作曲/编曲/制作人等，取自 LRC 元数据）。 */
  credits?: Array<{ role: string; name: string }>;
}

export interface ArtistInfo {
  platform: Platform;
  id: string;
  name: string;
  avatar: string;
  description?: string;
}

export interface AlbumSummary {
  platform: Platform;
  id: string;
  name: string;
  cover: string;
  year?: number;
  songCount?: number;
}
