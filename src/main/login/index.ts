import type { AccountInfo, PlaylistSummary } from '../types';

export interface LoginAdapter {
  platform: string;
  name: string;
  kind: 'qr' | 'oauth' | 'unavailable';
  createQr?: () => Promise<{ unikey: string; payload: string; imageDataUrl?: string }>;
  pollLogin?: (unikey: string) => Promise<{ ok: boolean; message: string }>;
  getAccount?: () => Promise<AccountInfo | null>;
  getMyPlaylists?: () => Promise<PlaylistSummary[]>;
  unavailableReason?: string;
}

export { NeteaseLogin } from './neteaseLogin';
export { QqLogin, hash33 } from './qqLogin';

export const kugouLoginAdapter: LoginAdapter = {
  platform: 'kugou',
  name: '酷狗音乐',
  kind: 'unavailable',
  unavailableReason: '酷狗登录需要 Electron 浏览器窗口（阶段 1 接入）；搜索/歌词/取链已可用',
};

export const qishuiLoginAdapter: LoginAdapter = {
  platform: 'qishui',
  name: '汽水音乐',
  kind: 'unavailable',
  unavailableReason: '汽水音乐登录需要签名引擎（阶段 2 接入）；歌词已支持免登录获取',
};
