import type { CSSProperties } from 'react';
import { BACKGROUND_PRESETS } from '../lib/backgrounds';
import type { BackgroundSetting } from '../lib/backgrounds';
import { Starfield } from './Starfield';

import type { CoverBgMode } from '../lib/backgrounds';

export type { CoverBgMode };

export function BackgroundLayer({
  setting,
  coverMode,
}: {
  setting: BackgroundSetting;
  coverMode?: CoverBgMode;
}) {
  if (setting.type === 'cover') return null; // 封面背景由 App 换算为 image/preset 后传入
  if (setting.type === 'image') {
    return (
      <div
        className={`bg-layer${coverMode ? ` bg-cover-mode is-${coverMode}` : ''}`}
        style={{ '--cover-url': `url("${setting.url}")` } as CSSProperties}
      >
        {coverMode === 'fill' && <span className="bg-fill-sides" />}
        <img className="bg-media" src={setting.url} alt="自定义背景" draggable={false} />
        {coverMode === 'blend' && <img className="bg-media-ghost" src={setting.url} alt="" draggable={false} />}
        {coverMode === 'color' && <div className="bg-color-base" />}
        {coverMode === 'palette' && <div className="bg-palette-base" />}
        <div className="bg-overlay-dark" />
        {(coverMode === 'color' || coverMode === 'palette' || coverMode === 'blend') && <div className="bg-noise" />}
        {coverMode === 'prism' && (
          <>
            <span className="bg-prism bg-prism-1" />
            <span className="bg-prism bg-prism-2" />
            <span className="bg-prism bg-prism-3" />
          </>
        )}
        <div className="bg-vignette" />
      </div>
    );
  }

  if (setting.type === 'video') {
    return (
      <div className="bg-layer">
        <video className="bg-media" src={setting.url} autoPlay muted loop playsInline />
        <div className="bg-overlay-dark" />
        <div className="bg-vignette" />
      </div>
    );
  }

  const preset = BACKGROUND_PRESETS.find((p) => p.id === setting.id) ?? BACKGROUND_PRESETS[0]!;
  return (
    <div className={`bg-layer ${preset.layerClass}`} aria-hidden="true">
      {preset.id === 'midnight' && <Starfield />}
      {preset.id === 'aurora' && (
        <>
          <span className="aurora aurora-1" />
          <span className="aurora aurora-2" />
          <span className="aurora aurora-3" />
        </>
      )}
      {preset.id === 'synthwave' && (
        <>
          <span className="synth-sun" />
          <span className="synth-grid" />
        </>
      )}
      <div className="bg-vignette" />
    </div>
  );
}
