import { createContext, useContext, type ReactNode } from 'react';
import type { BackgroundSetting, CoverBgMode } from '../../lib/backgrounds';
import type { CoverSample, LyricPalette } from '../../lib/coverColors';

export interface VisualAtmosphereValue {
  /** 背景媒体采样出的歌词色板（未采样为 null，消费端兜底银蓝）。 */
  palette: LyricPalette | null;
  /** 封面采样（封面填充模式用）。 */
  sample: CoverSample | null;
  coverMode: CoverBgMode;
  effectiveBg: BackgroundSetting;
}

const Ctx = createContext<VisualAtmosphereValue | null>(null);

export function VisualAtmosphereProvider({
  value,
  children,
}: {
  value: VisualAtmosphereValue;
  children: ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useVisualAtmosphere(): VisualAtmosphereValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useVisualAtmosphere 需在 VisualAtmosphereProvider 内使用');
  return v;
}
