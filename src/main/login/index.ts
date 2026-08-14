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
  unavailableReason: '酷狗网页登录接口未公开且频繁变动，暂不支持账号登录；可用网易云/QQ/Spotify 登录',
};

export const qishuiLoginAdapter: LoginAdapter = {
  platform: 'qishui',
  name: '汽水音乐',
  kind: 'unavailable',
  unavailableReason: '汽水音乐为字节系封闭平台，暂无公开登录/歌单 API，暂不支持',
};
