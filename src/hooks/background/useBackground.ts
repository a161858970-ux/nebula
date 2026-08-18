import { useCallback, useEffect, useState } from 'react';
import { loadBackground, saveBackground, type BackgroundSetting } from '../../lib/backgrounds';
import type { CoverBgMode } from '../../lib/backgrounds';
import { DEFAULT_AMBIENT, PRESET_AMBIENT, applyAmbient, sampleMedia } from '../../lib/bgSampler';
import {
  SILVER_BLUE,
  paletteFromSample,
  sampleCover,
  sampleMediaElement,
  type CoverSample,
  type LyricPalette,
} from '../../lib/coverColors';
import { hasDesktopAPI } from '../../lib/playlist/ipcClient';
import type { DesktopWallpaperSetResult } from '../../lib/playlist/ipcClient';
import type { VisualAtmosphere } from '../../lib/atmosphere';

interface UseBackgroundOptions {
  /** 主窗口才订阅壁纸应用事件（wallpaper view 关闭）。 */
  enabled: boolean;
  /** 壁纸应用后回调（App 组合层关闭壁纸窗口）。 */
  onApplied: () => void;
  /** 封面变化 key（由 App 传入播放器当前封面，仅用于重采样触发）。 */
  coverKey: string;
}

/**
 * 背景/氛围领域（docs/ARCHITECTURE.md §2）：
 * 拥有 bgSetting / bgCoverMode，产出 VisualAtmosphere；
 * 只写自己的环境光 CSS 变量，**不直接修改歌词/玻璃**（歌词配色经中间层由消费端推导）。
 */
export function useBackground({ enabled, onApplied, coverKey }: UseBackgroundOptions) {
  const [bgSetting, setBgSetting] = useState<BackgroundSetting>(() => loadBackground());
  const [bgCoverMode, setBgCoverMode] = useState<CoverBgMode>(() => {
    const m = typeof localStorage !== 'undefined' ? localStorage.getItem('music-nebula.bg-cover-mode') : null;
    if (m === 'fill' || m === 'frosted' || m === 'color' || m === 'palette' || m === 'blend' || m === 'prism') {
      return m;
    }
    if (m === 'cinematic') return 'blend';
    return 'blend';
  });
  const [atmosphere, setAtmosphere] = useState<VisualAtmosphere>({ palette: null, sample: null });

  const handleSelectBg = useCallback((s: BackgroundSetting) => {
    setBgSetting(s);
    saveBackground(s);
  }, []);

  const handleCoverMode = useCallback((m: CoverBgMode) => {
    setBgCoverMode(m);
    try {
      localStorage.setItem('music-nebula.bg-cover-mode', m);
    } catch {
      /* ignore */
    }
  }, []);

  const applyWallpaperResult = useCallback((result: DesktopWallpaperSetResult) => {
    if ('url' in result && 'type' in result) {
      setBgSetting({ type: result.type, url: result.url });
    }
  }, []);

  const handleBgFile = useCallback((file: File) => {
    if (file.type.startsWith('video/')) {
      setBgSetting({ type: 'video', url: URL.createObjectURL(file) });
      return;
    }
    if (file.size <= 2.5 * 1024 * 1024) {
      const reader = new FileReader();
      reader.onload = () => {
        const url = String(reader.result);
        setBgSetting({ type: 'image', url });
        saveBackground({ type: 'image', url });
      };
      reader.readAsDataURL(file);
    } else {
      setBgSetting({ type: 'image', url: URL.createObjectURL(file) });
    }
  }, []);

  // 壁纸子窗口应用结果订阅
  useEffect(() => {
    if (!enabled || !hasDesktopAPI()) return;
    const off = window.nebulaAPI!.onWallpaperApplied((data) => {
      if ('url' in data) {
        setBgSetting({ type: data.type, url: data.url });
        onApplied();
      }
    });
    return off;
  }, [enabled, onApplied]);

  // 环境光：背景自有输出（--glow-rgb 等 CSS 变量）
  useEffect(() => {
    if (bgSetting.type === 'preset') {
      applyAmbient(PRESET_AMBIENT[bgSetting.id] ?? DEFAULT_AMBIENT);
      return;
    }
    const media = document.querySelector<HTMLImageElement | HTMLVideoElement>('.bg-media');
    if (!media) {
      applyAmbient(DEFAULT_AMBIENT);
      return;
    }
    const trySample = () => {
      const s = sampleMedia(media);
      if (s) applyAmbient(s);
    };
    const onLoad = () => trySample();
    media.addEventListener('load', onLoad);
    if ((media as HTMLImageElement).complete || (media as HTMLVideoElement).readyState >= 1) trySample();
    let iv = 0;
    if (media.tagName === 'VIDEO') iv = window.setInterval(trySample, 3000);
    return () => {
      media.removeEventListener('load', onLoad);
      if (iv) window.clearInterval(iv);
    };
  }, [bgSetting, coverKey]);

  // 歌词色板采样：只产出 atmosphere 数据，不写任何歌词 CSS 变量
  useEffect(() => {
    let cancelled = false;
    const done = (palette: LyricPalette, sample: CoverSample | null) => {
      if (!cancelled) setAtmosphere({ palette, sample });
    };
    const media = document.querySelector<HTMLImageElement | HTMLVideoElement>('.bg-media');
    const trySample = (): void => {
      if (cancelled) return;
      if (
        media &&
        (media instanceof HTMLImageElement
          ? media.complete && media.naturalWidth > 0
          : media.readyState >= 1)
      ) {
        sampleMediaElement(media)
          .then((s) => done(s ? paletteFromSample(s) : SILVER_BLUE, s))
          .catch(() => done(SILVER_BLUE, null));
      } else {
        done(SILVER_BLUE, null);
      }
    };
    if (!media) {
      const src = coverKey;
      if (!src) {
        done(SILVER_BLUE, null);
      } else {
        sampleCover(src)
          .then((s) => done(s ? paletteFromSample(s) : SILVER_BLUE, s))
          .catch(() => done(SILVER_BLUE, null));
      }
    } else {
      trySample();
      media.addEventListener('load', trySample);
      media.addEventListener('loadeddata', trySample);
      return () => {
        cancelled = true;
        media.removeEventListener('load', trySample);
        media.removeEventListener('loadeddata', trySample);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [bgSetting, coverKey]);

  return { bgSetting, bgCoverMode, atmosphere, handleSelectBg, handleCoverMode, applyWallpaperResult, handleBgFile };
}
