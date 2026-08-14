import { BACKGROUND_PRESETS } from '../lib/backgrounds';
import type { BackgroundSetting } from '../lib/backgrounds';
import { Starfield } from './Starfield';

export type CoverBgMode = 'frosted' | 'cinematic' | 'prism';

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
      <div className={`bg-layer${coverMode ? ` bg-cover-mode is-${coverMode}` : ''}`}>
        <img className="bg-media" src={setting.url} alt="自定义背景" draggable={false} />
        <div className="bg-overlay-dark" />
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
