/**
 * 背景像素采样与全局光照/歌词配色联动。
 *
 * 采样当前背景（封面图 / 自定义图 / 视频首帧）到小尺寸画布，统计：
 * - 平均明度 luma（0~1）
 * - 平均饱和度 sat
 * - 主色相 hue
 *
 * 输出到 CSS 变量（documentElement）：
 * - `--ambient-luma / --ambient-sat / --ambient-hue`
 * - `--glow-rgb`：玻璃高光主色（随背景色相微微染色，暗底偏白）
 * - `--lyric-rgb` / `--lyric-dim-rgb`：Z1 流动歌词主色（按明度分支：暗底浅字、亮底深字）
 */

export interface AmbientStats {
  luma: number;
  sat: number;
  hue: number;
}

/** 内置背景预设的静态环境色（无法直接采样 CSS 渐变，用调色板近似）。 */
export const PRESET_AMBIENT: Record<string, AmbientStats> = {
  midnight: { luma: 0.16, sat: 0.42, hue: 235 },
  nebula: { luma: 0.22, sat: 0.55, hue: 262 },
  sunset: { luma: 0.34, sat: 0.62, hue: 28 },
  aurora: { luma: 0.3, sat: 0.5, hue: 180 },
  synthwave: { luma: 0.28, sat: 0.62, hue: 318 },
};

export const DEFAULT_AMBIENT: AmbientStats = { luma: 0.2, sat: 0.45, hue: 230 };

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = ((h % 360) + 360) % 360 / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return [Math.round(f(hh + 1 / 3) * 255), Math.round(f(hh) * 255), Math.round(f(hh - 1 / 3) * 255)];
}

function rgbString(rgb: [number, number, number]): string {
  return `${rgb[0]}, ${rgb[1]}, ${rgb[2]}`;
}

/** 把采样结果写进 CSS 变量并返回是否选择了深色文字。 */
export function applyAmbient(stats: AmbientStats): void {
  const root = document.documentElement;
  root.style.setProperty('--ambient-luma', stats.luma.toFixed(3));
  root.style.setProperty('--ambient-sat', stats.sat.toFixed(3));
  root.style.setProperty('--ambient-hue', String(Math.round(stats.hue)));

  // 玻璃高光：色相跟随背景但压亮、降饱和，暗底趋白
  const glowL = 0.78 + stats.luma * 0.12;
  const glowS = Math.min(0.55, stats.sat * 0.7);
  const glowRgb: [number, number, number] =
    stats.sat > 0.22 ? hslToRgb(stats.hue, glowS, glowL) : [255, 255, 255];
  root.style.setProperty('--glow-rgb', rgbString(glowRgb));

  // 歌词配色分支：暗背景 → 浅色字；中亮/亮背景 → 深色字（阈值取 0.45 提高浅底可读性）
  if (stats.luma < 0.45) {
    const tint: [number, number, number] =
      stats.sat > 0.25 ? hslToRgb(stats.hue, 0.35, 0.86) : [245, 246, 250];
    root.style.setProperty('--lyric-rgb', rgbString(tint));
    root.style.setProperty('--lyric-dim-rgb', rgbString(hslToRgb(stats.hue, 0.3, 0.66)));
    root.style.setProperty('--lyric-mode', 'light');
  } else {
    root.style.setProperty('--lyric-rgb', '28, 30, 44');
    root.style.setProperty('--lyric-dim-rgb', '70, 74, 92');
    root.style.setProperty('--lyric-mode', 'dark');
  }
  root.classList.toggle('lyric-dark', stats.luma >= 0.45);
}

/** 从图片/视频元素采样。 */
export function sampleMedia(src: HTMLImageElement | HTMLVideoElement): AmbientStats | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 24;
    canvas.height = 14;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(src, 0, 0, 24, 14);
    const data = ctx.getImageData(0, 0, 24, 14).data;
    let r = 0;
    let g = 0;
    let b = 0;
    const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i]!;
      g += data[i + 1]!;
      b += data[i + 2]!;
    }
    r /= n;
    g /= n;
    b /= n;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    const sat = max === 0 ? 0 : (max - min) / max;
    let hue = 0;
    const d = max - min;
    if (d > 0) {
      if (max === r) hue = ((g - b) / d) % 6;
      else if (max === g) hue = (b - r) / d + 2;
      else hue = (r - g) / d + 4;
      hue *= 60;
      if (hue < 0) hue += 360;
    }
    return { luma, sat, hue };
  } catch {
    return null;
  }
}
