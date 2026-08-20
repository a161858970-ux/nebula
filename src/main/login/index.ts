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
export { QqLogin, hash33 } from './qqLogin';

export function createKugouLoginAdapter(kugouLogin: {
  getAccount: () => Promise<AccountInfo | null>;
}): LoginAdapter {
  return {
    platform: 'kugou',
    name: '酷狗音乐',
    kind: 'window',
    getAccount: () => kugouLogin.getAccount(),
    unavailableReason: undefined,
  };
}

export const qishuiLoginAdapter: LoginAdapter = {
  platform: 'qishui',
  name: '汽水音乐',
  kind: 'unavailable',
  unavailableReason: '汽水音乐登录需要签名引擎（阶段 2 接入）；歌词已支持免登录获取',
};
