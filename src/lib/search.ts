import type { CardSpec } from './layout';
import { CARD_HEIGHT, CARD_WIDTH, wrap } from './layout';

/**
 * 搜索匹配 + 聚簇布局。
 *
 * 匹配规则：对歌曲名（title）或歌手（artist）做不区分大小写的子串匹配；
 * 结果排序：歌名前缀 > 歌名子串 > 歌手匹配；同一首歌只出现一次。
 */

export interface SearchMatch {
  /** 歌曲在 songs/cards 中的下标。 */
  index: number;
  title: string;
  artist: string;
  /** 命中类型：title / artist。 */
  kind: 'title' | 'artist';
  cover?: string;
  hue1?: number;
}

export interface SearchableSong {
  title: string;
  artist: string;
  cover?: string;
  hue1?: number;
}

const norm = (s: string): string => s.trim().toLowerCase();

/** 实时匹配：query 为空返回 []。 */
export function matchSongs(query: string, songs: SearchableSong[]): SearchMatch[] {
  const q = norm(query);
  if (!q) return [];

  const scored: Array<SearchMatch & { score: number }> = [];
  for (let i = 0; i < songs.length; i++) {
    const song = songs[i]!;
    const title = song.title ?? '';
    const artist = song.artist ?? '';
    const tl = norm(title);
    const al = norm(artist);
    if (tl === q || al === q) {
      scored.push({ index: i, title, artist, kind: tl === q ? 'title' : 'artist', score: 0, cover: song.cover, hue1: song.hue1 });
      continue;
    }
    if (tl.startsWith(q)) {
      scored.push({ index: i, title, artist, kind: 'title', score: 1, cover: song.cover, hue1: song.hue1 });
      continue;
    }
    if (tl.includes(q)) {
      scored.push({ index: i, title, artist, kind: 'title', score: 2, cover: song.cover, hue1: song.hue1 });
      continue;
    }
    if (al.startsWith(q) || al.includes(q)) {
      scored.push({ index: i, title, artist, kind: 'artist', score: 3, cover: song.cover, hue1: song.hue1 });
    }
  }

  return scored.sort((a, b) => a.score - b.score || a.index - b.index);
}

/** 聚簇上限：避免超大歌单中“某歌手全部歌曲”聚成巨簇盖住整个视口。 */
export const CLUSTER_CAP = 42;

/**
 * 把命中的卡片重新排布成围绕画布中心的紧凑簇团（网格，轻微抖动），
 * 其余卡片保持原位 —— 视觉上即“命中歌曲聚团、无关歌曲让位包围”。
 * 返回 { cardId -> 新位置 }。
 */
export function buildClusterPositions(
  cards: CardSpec[],
  matchedIndices: number[],
  metrics: { tileWidth: number; tileHeight: number },
): Map<number, { x: number; y: number }> {
  const map = new Map<number, { x: number; y: number }>();
  const ids = matchedIndices.filter((i) => i >= 0 && i < cards.length).slice(0, CLUSTER_CAP);
  if (ids.length === 0) return map;

  const cols = Math.ceil(Math.sqrt(ids.length));
  const rows = Math.ceil(ids.length / cols);
  // 间距放宽 + 上限收紧：中心鱼眼 2x 放大下仍保持可读，避免簇心卡片互相压盖
  const gap = Math.min(420, 260 + ids.length * 3);
  const originX = (metrics.tileWidth - (cols - 1) * gap) / 2;
  const originY = (metrics.tileHeight - (rows - 1) * gap) / 2;

  ids.forEach((id, n) => {
    const col = n % cols;
    const row = Math.floor(n / cols);
    const jx = (n * 7919) % 47 - 23; // 轻量确定性扰动，保持“自然堆放”感
    const jy = (n * 104729) % 41 - 20;
    map.set(id, {
      x: wrap(originX + col * gap + jx, metrics.tileWidth),
      y: wrap(originY + row * gap + jy, metrics.tileHeight),
    });
  });
  return map;
}

/** 求视角目标 pan：目标卡片“中心”居中于视口（含缩放；pos 为卡片左上角世界坐标）。 */
export function panForCentering(
  pos: { x: number; y: number },
  vw: number,
  vh: number,
  zoom = 1,
): { x: number; y: number } {
  return {
    x: pos.x - vw / (2 * zoom) + CARD_WIDTH / (2 * zoom),
    y: pos.y - vh / (2 * zoom) + CARD_HEIGHT / (2 * zoom),
  };
}
