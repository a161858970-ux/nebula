import { memo } from 'react';
import type { MouseEvent as ReactMouseEvent, RefObject } from 'react';
import { MusicCard } from './MusicCard';
import { CULL_BUFFER } from '../lib/stage';
import type { CardSpec, LayoutMetrics } from '../lib/layout';
import type { Track } from '../lib/catalog';

interface StageCanvasProps {
  stageRef: RefObject<HTMLDivElement>;
  importing: boolean;
  uiHideCards: boolean;
  visibleIds: number[];
  effectiveCards: CardSpec[];
  metrics: LayoutMetrics;
  pan: { x: number; y: number };
  zoom: number;
  hoveredId: number | null;
  currentSongId: number | null;
  failedIds: ReadonlySet<number>;
  onPlay: (songId: number) => void;
  onContextMenu: (e: ReactMouseEvent, track: Track) => void;
  onHoverChange: (id: number, hovered: boolean) => void;
  registerEl: (id: number, el: HTMLElement | null) => void;
}

/**
 * Z2 星云舞台区块（docs/ARCHITECTURE.md §5）：stage-3d + 卡片虚拟化渲染。
 * 收 useStage 数据（纯 props，memo 化）；同层区块互不依赖，组合由 App 完成。
 */
export const StageCanvas = memo(function StageCanvas({
  stageRef,
  importing,
  uiHideCards,
  visibleIds,
  effectiveCards,
  metrics,
  pan,
  zoom,
  hoveredId,
  currentSongId,
  failedIds,
  onPlay,
  onContextMenu,
  onHoverChange,
  registerEl,
}: StageCanvasProps) {
  return (
    <div
      ref={stageRef}
      className={`stage-3d${importing ? ' is-importing' : ''}${uiHideCards ? ' is-cards-hidden' : ''}`}
    >
      {visibleIds.map((id) => {
        const card = effectiveCards[id]!;
        if (!card) return null;
        return (
          <MusicCard
            key={card.id}
            card={card}
            metrics={metrics}
            buffer={CULL_BUFFER}
            pan={pan}
            zoom={zoom}
            hovered={card.id === hoveredId}
            isCurrent={card.track.id === currentSongId}
            isFailed={failedIds.has(card.track.id)}
            onPlay={onPlay}
            onContextMenu={onContextMenu}
            onHoverChange={onHoverChange}
            registerEl={registerEl}
          />
        );
      })}
    </div>
  );
});
