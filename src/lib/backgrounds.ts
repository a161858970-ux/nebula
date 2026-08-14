export interface BackgroundPreset {
  id: string;
  name: string;
  dynamic: boolean;
  layerClass: string;
}

export const BACKGROUND_PRESETS: BackgroundPreset[] = [
  { id: 'midnight', name: '午夜星空', dynamic: false, layerClass: 'bg-midnight' },
  { id: 'nebula', name: '星云', dynamic: false, layerClass: 'bg-nebula' },
  { id: 'sunset', name: '暮色', dynamic: false, layerClass: 'bg-sunset' },
  { id: 'aurora', name: '极光', dynamic: true, layerClass: 'bg-aurora' },
  { id: 'synthwave', name: '赛博', dynamic: true, layerClass: 'bg-synthwave' },
];

export type BackgroundSetting =
  | { type: 'preset'; id: string }
  | { type: 'image'; url: string }
  | { type: 'video'; url: string }
  | { type: 'cover' };

const STORAGE_KEY = 'music-nebula.bg';

export function loadBackground(): BackgroundSetting {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as BackgroundSetting;
      if (s.type === 'preset' && BACKGROUND_PRESETS.some((p) => p.id === s.id)) return s;
      if (
        (s.type === 'image' || s.type === 'video') &&
        typeof s.url === 'string' &&
        s.url.startsWith('data:')
      ) {
        return s;
      }
      if (s.type === 'cover') return s;
    }
  } catch {
    /* localStorage 不可用时忽略 */
  }
  return { type: 'preset', id: 'midnight' };
}

export function saveBackground(setting: BackgroundSetting): void {
  try {
    // 大图 / 视频使用 objectURL，仅当前会话有效，不持久化
    if (setting.type === 'image' && !setting.url.startsWith('data:')) return;
    if (setting.type === 'video') return;
    if (setting.type === 'cover') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(setting));
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(setting));
  } catch {
    /* ignore */
  }
}
