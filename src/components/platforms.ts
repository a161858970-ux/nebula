import neteaseLogo from '../../docs/logo/网易云.webp';
import qqLogo from '../../docs/logo/QQ_Music2023.svg.webp';
import kugouLogo from '../../docs/logo/kugou.webp';
import qishuiLogo from '../../docs/logo/qishui.png';
import spotifyLogo from '../../docs/logo/spotify-logo.webp';

export interface PlatformMeta {
  id: string;
  name: string;
  /** 统一圆形裁切后展示的官方 logo 素材。 */
  logo: string;
  /** 品牌主色：用于低透明度底衬与高光，保证五家视觉统一。 */
  brand: string;
}

export const PLATFORM_META: Record<string, PlatformMeta> = {
  netease: { id: 'netease', name: '网易云音乐', logo: neteaseLogo, brand: '#e60026' },
  qq: { id: 'qq', name: 'QQ 音乐', logo: qqLogo, brand: '#31c27c' },
  kugou: { id: 'kugou', name: '酷狗音乐', logo: kugouLogo, brand: '#2a9df4' },
  qishui: { id: 'qishui', name: '汽水音乐', logo: qishuiLogo, brand: '#ff5a79' },
  spotify: { id: 'spotify', name: 'Spotify', logo: spotifyLogo, brand: '#1db954' },
};

/** 左右 Dock 统一的平台顺序（与后端 platform id 一致）。 */
export const DOCK_PLATFORM_ORDER = ['netease', 'qq', 'kugou', 'qishui', 'spotify'] as const;

export function platformMeta(id: string): PlatformMeta {
  return PLATFORM_META[id] ?? { id, name: id, logo: '', brand: '#8b93b8' };
}
