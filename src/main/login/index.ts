import type { AccountInfo, PlaylistSummary } from '../types';

export interface LoginAdapter {
  platform: string;
  name: string;
  kind: 'qr' | 'oauth' | 'window' | 'unavailable';
  createQr?: () => Promise<{ unikey: string; payload: string; imageDataUrl?: string }>;
  pollLogin?: (unikey: string) => Promise<{ ok: boolean; message: string }>;
  getAccount?: () => Promise<AccountInfo | null>;
  getMyPlaylists?: () => Promise<PlaylistSummary[]>;
  unavailableReason?: string;
}

export { NeteaseLogin } from './neteaseLogin';
export { KugouLogin } from './kugouLogin';
export { QishuiLogin } from './qishuiLogin';
export { QqLogin, hash33 } from './qqLogin';

export function createKugouLoginAdapter(kugouLogin: {
  getAccount: () => Promise<AccountInfo | null>;
  getMyPlaylists?: () => Promise<PlaylistSummary[]>;
}): LoginAdapter {
  return {
    platform: 'kugou',
    name: '酷狗音乐',
    kind: 'window',
    getAccount: () => kugouLogin.getAccount(),
    getMyPlaylists: kugouLogin.getMyPlaylists,
    unavailableReason: undefined,
  };
}

export function createQishuiLoginAdapter(qishuiLogin: {
  getAccount: () => Promise<AccountInfo | null>;
  getMyPlaylists?: () => Promise<PlaylistSummary[]>;
}): LoginAdapter {
  return {
    platform: 'qishui',
    name: '汽水音乐',
    kind: 'window',
    getAccount: () => qishuiLogin.getAccount(),
    getMyPlaylists: qishuiLogin.getMyPlaylists,
    unavailableReason: undefined,
  };
}
