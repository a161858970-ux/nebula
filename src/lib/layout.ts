import type { RNG } from './rng';
import { range } from './rng';
import type { Track } from './catalog';

/**
 * 网格单元尺寸（px）。直接决定单屏可见卡片密度（更紧凑，减少留白）：
 * 1920×1080 视口约 6×4 = 24 张，2560×1440 约 8×5 = 40 张。
 */
export const CELL_SIZE = 340;
/** 卡片固定宽度：配合网格间距保证数学上不可能重叠。 */
export const CARD_WIDTH = 172;
/** 卡片近似高度（用于鱼眼距离以卡片中心为基准计算）。 */
export const CARD_HEIGHT = 246;
/**
 * 每格内随机扰动范围。基础状态下相邻卡片最小中心距 = 340 - 160 = 180px，
 * 略大于卡片宽 172px → 静止时基本不重叠；中心卡被鱼眼放大后（2.0x）
 * 会自然压住周围紧凑的卡片，形成层次感。
 */
export const CARD_JITTER = 80;
/** 布局 tile 最小尺寸：小歌单也要能铺开满屏，避免周期回绕导致同一批卡片重复堆在视口中心。 */
export const MIN_TILE_W = 1920;
export const MIN_TILE_H = 1080;
/** 布局种子：固定 seed 保证同一歌单每次刷新位置一致。 */
export const SEED = 20260810;

export interface CardSpec {
  id: number;
  /** 世界坐标（画布内，周期回绕）。 */
  x: number;
  y: number;
  /** 随机 Z 轴旋转（-10° ~ +10°）。 */
  rotateZ: number;
  track: Track;
}

export interface LayoutMetrics {
  tileWidth: number;
  tileHeight: number;
  cols: number;
  rows: number;
  cellSize: number;
}

/**
 * 按曲目数量自适应画布尺寸：网格密度恒定 → 无论曲库 100 首还是 10000 首，
 * 单屏可见卡片数都保持在 15~25 张。
 */
export function computeTileSize(count: number, cellSize: number = CELL_SIZE): LayoutMetrics {
  // 先按固定 cellSize 估算网格；若 tile 小于视口下限，则放大 cellSize 把小歌单铺满全屏
  const cols = Math.max(1, Math.ceil(Math.sqrt(count * (4 / 3))));
  let rows = Math.max(1, Math.ceil(count / cols));
  let effectiveCell = cellSize;
  if (cols * effectiveCell < MIN_TILE_W || rows * effectiveCell < MIN_TILE_H) {
    effectiveCell = Math.max(
      effectiveCell,
      Math.ceil(Math.max(MIN_TILE_W / cols, MIN_TILE_H / rows)),
    );
    rows = Math.max(1, Math.ceil(count / cols));
  }
  return {
    tileWidth: cols * effectiveCell,
    tileHeight: rows * effectiveCell,
    cols,
    rows,
    cellSize: effectiveCell,
  };
}

/**
 * 生成卡片布局：把所有网格单元打乱后依次填充 → 视觉上“随机散布”，
 * 但每格至多一张卡，间距有硬性下限，绝不重叠。
 */
export function generateCards(rng: RNG, songs: Track[]): CardSpec[] {
  const { cols, rows, cellSize } = computeTileSize(songs.length);

  const cells = Array.from({ length: cols * rows }, (_, i) => i);
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = cells[i]!;
    cells[i] = cells[j]!;
    cells[j] = tmp;
  }

  const cards: CardSpec[] = [];
  for (let i = 0; i < songs.length; i++) {
    const cell = cells[i]!;
    const col = cell % cols;
    const row = Math.floor(cell / cols);
    cards.push({
      id: i,
      x: (col + 0.5) * cellSize + range(rng, -CARD_JITTER, CARD_JITTER),
      y: (row + 0.5) * cellSize + range(rng, -CARD_JITTER, CARD_JITTER),
      rotateZ: range(rng, -8, 8),
      track: songs[i]!,
    });
  }
  return cards;
}

/** 把数值回绕进 [0, size)，实现周期画布。 */
export function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}

/**
 * 把世界坐标 p 映射到视口坐标：在周期副本中找落在
 * [-margin, size + margin] 内的那一份；找不到返回 null（离屏）。
 */
export function wrapToViewport(
  p: number,
  pan: number,
  tile: number,
  size: number,
  margin: number,
): number | null {
  const d = p - pan;
  const k0 = Math.round(-d / tile);
  for (let i = k0 - 3; i <= k0 + 3; i++) {
    const s = d + i * tile;
    if (s >= -margin && s <= size + margin) return s;
  }
  return null;
}

export interface ScreenPos {
  x: number;
  y: number;
  /** 卡片中心到屏幕中心的距离（鱼眼 scale/blur 的输入）。 */
  dist: number;
}

/** 计算卡片在当前视口内的屏幕坐标与中心距离（含周期回绕）。 */
export function cardScreenPos(
  card: CardSpec,
  pan: { x: number; y: number },
  tileWidth: number,
  tileHeight: number,
  vw: number,
  vh: number,
  margin: number,
  zoom = 1,
): ScreenPos | null {
  const sx = nearestCopy(card.x, pan.x, tileWidth, vw / zoom, margin);
  const sy = nearestCopy(card.y, pan.y, tileHeight, vh / zoom, margin);
  if (sx === null || sy === null) return null;
  const px = sx * zoom;
  const py = sy * zoom;
  const centerX = px + CARD_WIDTH / 2;
  const centerY = py + CARD_HEIGHT / 2;
  return {
    x: px,
    y: py,
    dist: Math.hypot(centerX - vw / 2, centerY - vh / 2),
  };
}

/**
 * 在周期副本中选「落在可见范围内且最接近视口中心」的那一份。
 * 当画布小于视口（小歌单）时，多份副本同时在范围内，必须选最合适的一份。
 */
function nearestCopy(
  p: number,
  pan: number,
  tile: number,
  size: number,
  margin: number,
): number | null {
  const d = p - pan;
  const k0 = Math.round(-d / tile);
  const center = size / 2;
  let best: number | null = null;
  let bestDist = Infinity;
  for (let i = k0 - 4; i <= k0 + 4; i++) {
    const s = d + i * tile;
    if (s < -margin || s > size + margin) continue;
    const dist = Math.abs(s - center);
    if (dist < bestDist) {
      bestDist = dist;
      best = s;
    }
  }
  return best;
}
