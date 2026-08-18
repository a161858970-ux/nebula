import { useCallback, useState } from 'react';

function loadUiBool(key: string): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/**
 * 界面设置领域（docs/ARCHITECTURE.md §2）：
 * 沉浸开关（隐藏卡片 / 隐藏歌词层）+ 持久化。
 */
export function useInterfaceSettings() {
  const [uiHideCards, setUiHideCards] = useState<boolean>(() => loadUiBool('music-nebula.ui-hide-cards'));
  const [uiHideLyrics, setUiHideLyrics] = useState<boolean>(() => loadUiBool('music-nebula.ui-hide-lyrics'));

  const toggleHideCards = useCallback(() => {
    setUiHideCards((v) => {
      const next = !v;
      try {
        localStorage.setItem('music-nebula.ui-hide-cards', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const toggleHideLyrics = useCallback(() => {
    setUiHideLyrics((v) => {
      const next = !v;
      try {
        localStorage.setItem('music-nebula.ui-hide-lyrics', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return { uiHideCards, uiHideLyrics, toggleHideCards, toggleHideLyrics };
}
