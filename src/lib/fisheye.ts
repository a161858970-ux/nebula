/**
 * 鱼眼景深：以屏幕中心为焦点。
 * 强对比曲线：中心 2.0x（聚焦感），边缘 0.5x（快速缩小），形成近大远小透视。
 */

export const FISHEYE_CENTER_SCALE = 2.0;
export const FISHEYE_EDGE_SCALE = 0.5;
/** 曲线指数：>1 时中心附近衰减较缓、离开中心后快速缩小。 */
export const FISHEYE_POWER = 1.35;

export function fisheyeScale(dist: number, maxDist: number): number {
  const t = Math.min(1, Math.max(0, dist / Math.max(1, maxDist)));
  return FISHEYE_EDGE_SCALE + (FISHEYE_CENTER_SCALE - FISHEYE_EDGE_SCALE) * Math.pow(1 - t, FISHEYE_POWER);
}

export function fisheyeBlur(dist: number): number {
  return Math.min(4, dist / 260);
}

export function fisheyeBrightness(dist: number): number {
  return Math.max(0.72, 1.12 - dist / 1800);
}

/** 层级：越靠近屏幕中心 z-index 越高，保证中心放大卡遮挡周围卡片。 */
export function fisheyeZIndex(dist: number, maxDist: number): number {
  const t = Math.min(1, Math.max(0, dist / Math.max(1, maxDist)));
  return Math.round((1 - t) * 5000) + 1;
}
