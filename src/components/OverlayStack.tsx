import { memo } from 'react';
import type { Track } from '../lib/catalog';
import type { LyricLineUI } from '../lib/lyrics';
import type { DesktopTrack, DesktopWallpaperItem, DesktopWallpaperSetResult } from '../lib/playlist/ipcClient';
import type { ContextMenuState, InfoModalState } from '../hooks/overlays/useOverlays';
import { NowPlayingPanel } from './NowPlayingPanel';
import { WallpaperPicker } from './WallpaperPicker';
import { InfoModals } from './InfoModals';

interface OverlayStackProps {
  nowPlayingOpen: boolean;
  song: Track | null;
  playing: boolean;
  loading: boolean;
  currentTime: number;
  duration: number;
  liked: boolean;
  lines: LyricLineUI[];
  translateOn: boolean;
  wallpaperOpen: boolean;
  infoModal: InfoModalState | null;
  modeToast: string;
  contextMenu: ContextMenuState | null;
  onCloseNowPlaying: () => void;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleLike: () => void;
  onToggleTranslate: () => void;
  onSeek: (t: number) => void;
  onCloseWallpaper: () => void;
  onApplyWallpaper: (item: DesktopWallpaperItem, result: DesktopWallpaperSetResult) => void;
  onCloseInfo: () => void;
  onOpenArtist: (platform: string, artistId: string, name: string) => void;
  onPlayArtistTrack: (t: DesktopTrack) => void;
  onCloseContextMenu: () => void;
  onInsertNext: (track: Track) => void;
}

/**
 * Z4 浮层区块（docs/ARCHITECTURE.md §5）：二级播放窗 / 壁纸窗口 / 信息弹层 / 模式 toast / 右键菜单。
 * 同层区块互不依赖，纯收 props（memo 化，App 提供稳定回调）。
 */
export const OverlayStack = memo(function OverlayStack({
  nowPlayingOpen,
  song,
  playing,
  loading,
  currentTime,
  duration,
  liked,
  lines,
  translateOn,
  wallpaperOpen,
  infoModal,
  modeToast,
  contextMenu,
  onCloseNowPlaying,
  onTogglePlay,
  onPrev,
  onNext,
  onToggleLike,
  onToggleTranslate,
  onSeek,
  onCloseWallpaper,
  onApplyWallpaper,
  onCloseInfo,
  onOpenArtist,
  onPlayArtistTrack,
  onCloseContextMenu,
  onInsertNext,
}: OverlayStackProps) {
  return (
    <>
      {nowPlayingOpen && song && (
        <NowPlayingPanel
          song={song}
          playing={playing}
          loading={loading}
          currentTime={currentTime}
          duration={duration}
          liked={liked}
          lines={lines}
          translateOn={translateOn}
          onClose={onCloseNowPlaying}
          onTogglePlay={onTogglePlay}
          onPrev={onPrev}
          onNext={onNext}
          onToggleLike={onToggleLike}
          onToggleTranslate={onToggleTranslate}
          onSeek={onSeek}
        />
      )}
      {wallpaperOpen && <WallpaperPicker onClose={onCloseWallpaper} onApply={onApplyWallpaper} />}
      <InfoModals
        modal={infoModal}
        onClose={onCloseInfo}
        onOpenArtist={onOpenArtist}
        onPlayArtistTrack={onPlayArtistTrack}
      />
      {modeToast && <div className="mode-toast">{modeToast}</div>}
      {contextMenu && (
        <>
          <div className="ctx-backdrop" onPointerDown={onCloseContextMenu} onContextMenu={(e) => e.preventDefault()} />
          <div className="ctx-menu glass" style={{ left: contextMenu.x, top: contextMenu.y }}>
            <button
              onClick={() => {
                onInsertNext(contextMenu.track);
                onCloseContextMenu();
              }}
            >
              下一首播放
            </button>
            <button onClick={onCloseContextMenu}>取消</button>
          </div>
        </>
      )}
    </>
  );
});
