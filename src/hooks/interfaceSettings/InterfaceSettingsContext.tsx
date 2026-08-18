import { createContext, useContext, type ReactNode } from 'react';
import type { LyricVisualSettings } from '../../lib/lyricSettings';

export interface InterfaceSettingsValue {
  lyricSettings: LyricVisualSettings;
  uiHideCards: boolean;
  uiHideLyrics: boolean;
  lyricTranslationEnabled: boolean;
  toggleHideCards: () => void;
  toggleHideLyrics: () => void;
  toggleTranslation: () => void;
}

const Ctx = createContext<InterfaceSettingsValue | null>(null);

export function InterfaceSettingsProvider({
  value,
  children,
}: {
  value: InterfaceSettingsValue;
  children: ReactNode;
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useInterfaceSettingsContext(): InterfaceSettingsValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useInterfaceSettingsContext 需在 InterfaceSettingsProvider 内使用');
  return v;
}
