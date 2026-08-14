import type { CardSpec, LayoutMetrics } from './layout';
import { wrapToViewport } from './layout';

/** 空间索引：cellKey → 卡片 id 列表（每格最多一张，数组仅为结构统一）。 */
export type SpatialIndex = Map<number, number[]>;

export function buildSpatialIndex(cards: CardSpec[], metrics: LayoutMetrics): SpatialIndex {
  const index: SpatialIndex = new Map();
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i]!;
    const col = Math.min(metrics.cols - 1, Math.floor(c.x / metrics.cellSize));
    const row = Math.min(metrics.rows - 1, Math.floor(c.y / metrics.cellSize));
    const key = row * metrics.cols + col;
    const arr = index.get(key);
    if (arr) arr.push(i);
    else index.set(key, [i]);
  }
  return index;
}

export interface PanLike {
  x: number;
  y: number;
  vw: number;
  vh: number;
  zoom?: number;
}

/**
 * 查询当前视口（含缓冲区）内应挂载的卡片 id。
 * 只扫视口覆盖到的网格单元，复杂度与总曲库量无关。
 */
export function queryVisibleIds(
  cards: CardSpec[],
  index: SpatialIndex,
  pan: PanLike,
  buffer: number,
  metrics: LayoutMetrics,
): number[] {
  const { cols, rows, cellSize } = metrics;
  const z = pan.zoom ?? 1;
  const vw = pan.vw / z;
  const vh = pan.vh / z;
  const c0 = Math.floor((pan.x - buffer) / cellSize);
  const c1 = Math.floor((pan.x + vw + buffer) / cellSize);
  const r0 = Math.floor((pan.y - buffer) / cellSize);
  const r1 = Math.floor((pan.y + vh + buffer) / cellSize);
  const candidates: number[] = [];
  const seen = new Set<number>();

  for (let c = c0; c <= c1; c++) {
    const cc = ((c % cols) + cols) % cols;
    for (let r = r0; r <= r1; r++) {
      const rr = ((r % rows) + rows) % rows;
      const arr = index.get(rr * cols + cc);
      if (arr) {
        for (const id of arr) {
          if (!seen.has(id)) {
            seen.add(id);
            candidates.push(id);
          }
        }
      }
    }
  }

  // 单元级查询是超集（单元碰缓冲即入选），这里按卡片实际屏幕位置精确过滤
  return candidates.filter((id) => {
    const c = cards[id];
    if (!c) return false;
    return (
      wrapToViewport(c.x, pan.x, metrics.tileWidth, vw, buffer) !== null &&
      wrapToViewport(c.y, pan.y, metrics.tileHeight, vh, buffer) !== null
    );
  });
}
