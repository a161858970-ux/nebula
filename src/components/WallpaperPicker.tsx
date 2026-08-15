import { useEffect, useState } from 'react';
import type { DesktopWallpaperItem, DesktopWallpaperSetResult } from '../lib/playlist/ipcClient';
import { hasDesktopAPI } from '../lib/playlist/ipcClient';

interface WallpaperPickerProps {
  onClose: () => void;
  onApply: (item: DesktopWallpaperItem, result: DesktopWallpaperSetResult) => void;
}

function kindLabel(item: DesktopWallpaperItem): string {
  if (item.playable && item.mediaType === 'video') return '视频壁纸';
  if (item.playable && item.mediaType === 'image') return '静态壁纸';
  if (item.enginePlayable) return '场景壁纸 · 需 Wallpaper Engine';
  return '网页/交互壁纸 · 暂不支持';
}

/** 本机 Wallpaper Engine 壁纸库（Steam 创意工坊 + 本地项目）。 */
export function WallpaperPicker({ onClose, onApply }: WallpaperPickerProps) {
  const [items, setItems] = useState<DesktopWallpaperItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [weInstalled, setWeInstalled] = useState(false);
  const [weLaunchUrl, setWeLaunchUrl] = useState('');
  const [hint, setHint] = useState('');

  useEffect(() => {
    if (!hasDesktopAPI()) {
      setError('壁纸库仅桌面版可用');
      setLoading(false);
      return;
    }
    let cancelled = false;
    window.nebulaAPI!
      .wallpaperList()
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setItems(res.data);
        else setError(res.error);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    window.nebulaAPI!
      .wallpaperInfo()
      .then((res) => {
        if (!cancelled && res.ok) {
          setWeInstalled(res.data.weInstalled);
          setWeLaunchUrl(res.data.weLaunchUrl);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const apply = async (item: DesktopWallpaperItem): Promise<void> => {
    setHint('');
    if (!hasDesktopAPI()) return;
    const res = await window.nebulaAPI!.wallpaperSet(item.id);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    if ('unsupported' in res.data) {
      // 场景壁纸：启动 Wallpaper Engine（完整注入为独立子系统）
      if (item.enginePlayable && weInstalled && weLaunchUrl) {
        void window.nebulaAPI!.openExternal(weLaunchUrl);
        setHint('已启动 Wallpaper Engine，请在 WE 中选择该壁纸应用');
      } else {
        setHint(res.data.reason);
      }
      return;
    }
    onApply(item, res.data);
  };

  return (
    <div
      className="wallpaper-overlay"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="wallpaper-panel glass" onPointerDown={(e) => e.stopPropagation()}>
        <button className="np-close" aria-label="关闭" onClick={onClose}>
          ×
        </button>
        <div className="wallpaper-head">Wallpaper Engine 壁纸库</div>
        {hint && <div className="wallpaper-hint is-hint">{hint}</div>}
        {loading && <div className="wallpaper-hint">正在扫描本机壁纸…</div>}
        {error && <div className="wallpaper-hint is-error">{error}</div>}
        {!loading && !error && items.length === 0 && (
          <div className="wallpaper-hint">未发现壁纸（检查 Steam 创意工坊 431960 或本地项目目录）</div>
        )}
        <div className="wp-grid">
          {items.map((item) => (
            <button
              key={item.id}
              className="wp-card"
              onClick={() => void apply(item)}
              title={item.playable ? '点击设为背景' : kindLabel(item)}
            >
              <div className="wp-preview">
                {item.playable && item.mediaType === 'video' && item.mediaUrl ? (
                  <video src={item.mediaUrl} autoPlay muted loop playsInline />
                ) : item.previewUrl ? (
                  <img src={item.previewUrl} alt="" loading="lazy" />
                ) : (
                  <span className="wp-ph" />
                )}
                {!item.playable && <span className="wp-badge">不可播放</span>}
              </div>
              <div className="wp-meta">
                <span className="wp-name">{item.title}</span>
                <span className="wp-kind">{kindLabel(item)}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
