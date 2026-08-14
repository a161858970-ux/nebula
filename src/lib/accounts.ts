import type { DesktopPlaylistSummary } from './playlist/ipcClient';

/** 全局多平台账号状态（可多平台同时登录）。 */
export interface AccountState {
  platform: string;
  loggedIn: boolean;
  nickname?: string;
  avatarUrl?: string;
  isVip?: boolean;
  isSvip?: boolean;
  playlists: DesktopPlaylistSummary[];
  loading: boolean;
}

export function emptyAccount(platform: string): AccountState {
  return { platform, loggedIn: false, playlists: [], loading: false };
}
