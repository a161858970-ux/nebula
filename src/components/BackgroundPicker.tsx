import { useRef } from 'react';
import { BACKGROUND_PRESETS } from '../lib/backgrounds';
import type { BackgroundSetting } from '../lib/backgrounds';
import type { CoverBgMode } from './BackgroundLayer';

interface BackgroundPickerProps {
  setting: BackgroundSetting;
  coverMode: CoverBgMode;
  onSelect: (s: BackgroundSetting) => void;
  onFile: (f: File) => void;
  onCoverMode: (m: CoverBgMode) => void;
  onOpenWallpapers: () => void;
}

const COVER_MODES: Array<{ id: CoverBgMode; name: string }> = [
  { id: 'fill', name: '原图直铺' },
  { id: 'frosted', name: '磨砂暗化' },
  { id: 'blend', name: '混合层' },
  { id: 'color', name: '纯色纹理' },
  { id: 'palette', name: '仅取色' },
];

export function BackgroundPicker({
  setting,
  coverMode,
  onSelect,
  onFile,
  onCoverMode,
  onOpenWallpapers,
}: BackgroundPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const coverActive = setting.type === 'cover';

  return (
    <div className="bg-picker">
      {BACKGROUND_PRESETS.map((p) => (
        <button
          key={p.id}
          className={`bg-thumb ${p.layerClass}${
            setting.type === 'preset' && setting.id === p.id ? ' active' : ''
          }`}
          onClick={() => onSelect({ type: 'preset', id: p.id })}
          title={`${p.name}${p.dynamic ? '（动态）' : ''}`}
        >
          <span className="bg-thumb-label">{p.name}</span>
          {p.dynamic && <span className="bg-thumb-dyn">动态</span>}
        </button>
      ))}
      <button className="bg-upload" onClick={() => inputRef.current?.click()}>
        上传图片 / 视频背景
      </button>
      <button className="bg-upload" onClick={onOpenWallpapers}>
        导入 Wallpaper 壁纸
      </button>
      <button
        className={`bg-cover${coverActive ? ' active' : ''}`}
        onClick={() => onSelect({ type: 'cover' })}
        title="自动加载当前播放歌曲专辑封面作为背景"
      >
        封面背景（自动跟随歌曲）
      </button>
      {coverActive && (
        <div className="bg-cover-modes">
          {COVER_MODES.map((m) => (
            <button
              key={m.id}
              className={`bg-mode-btn${coverMode === m.id ? ' active' : ''}`}
              onClick={() => onCoverMode(m.id)}
            >
              {m.name}
            </button>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*,video/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
      <p className="bg-hint">视频与大于 2.5MB 的图片仅在本次会话生效</p>
    </div>
  );
}
