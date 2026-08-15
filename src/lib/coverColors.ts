/** 封面取色 + 歌词三色调色板（primary / secondary / highlight）。 */

export interface CoverSample {
  best: [number, number, number];
  warm: [number, number, number];
  cool: [number, number, number];
  light: [number, number, number];
  dark: [number, number, number];
  accent: [number, number, number];
  area: [number, number, number];
  avg: [number, number, number];
  avgL: number;
  avgChroma: number;
  maxChroma: number;
  colorfulRatio: number;
  usableColorfulRatio: number;
  mono: boolean;
}

export interface LyricPalette {
  primary: string;
  secondary: string;
  highlight: string;
  glow: string;
  shadow: string;
}

/** 银蓝兜底（近单色封面）。 */
export const SILVER_BLUE: LyricPalette = {
  primary: '#d8f1ff',
  secondary: '#9db8cf',
  highlight: '#eef7ff',
  glow: '#9db8cf',
  shadow: 'rgba(0,6,10,0.48)',
};

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d > 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h, s, l];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 1) + 1) % 1;
  const f = (n: number): number => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return [
    Math.round(f(0) * 255),
    Math.round(f(8) * 255),
    Math.round(f(4) * 255),
  ];
}

function rgbCss(c: [number, number, number]): string {
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** 相对亮度（0~1）。 */
function luma(r: number, g: number, b: number): number {
  return (r * 0.299 + g * 0.587 + b * 0.114) / 255;
}

function chroma(r: number, g: number, b: number): number {
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
}

function liftToMin(c: [number, number, number], minLum: number): [number, number, number] {
  let [r, g, b] = c;
  let lum = luma(r, g, b);
  if (lum >= minLum) return [r, g, b];
  // 向白方向整体抬升
  let guard = 0;
  while (lum < minLum && guard < 24) {
    r = Math.min(255, r + (255 - r) * 0.28);
    g = Math.min(255, g + (255 - g) * 0.28);
    b = Math.min(255, b + (255 - b) * 0.28);
    lum = luma(r, g, b);
    guard++;
  }
  return [Math.round(r), Math.round(g), Math.round(b)];
}

/** 高冲击文字色调整（lyricHighImpactTextHsl）。 */
function highImpactHsl(h: number, s: number, l: number, avgL: number): [number, number, number] {
  const neutral = s < 0.035;
  const sampledBright = l >= 0.62 || avgL >= 0.64;
  const ns = neutral ? 0 : sampledBright ? Math.max(s, 0.89) : Math.max(s * 1.2, 0.89);
  const nl = sampledBright ? Math.min(0.94, Math.max(0.66, Math.max(l, 0.7))) : Math.min(0.9, Math.max(0.7, Math.max(l + 0.3, 0.74)));
  return [h, ns, nl];
}

function paletteFromHsl(h: number, s: number, l: number, avgL: number): LyricPalette {
  const [ph, ps, pl] = highImpactHsl(h, s, l, avgL);
  const primaryRgb = liftToMin(hslToRgb(ph, ps, pl), 0.36);
  const secondaryRgb = liftToMin(hslToRgb(ph + 0.07, Math.max(0.5, ps - 0.14), Math.max(0.28, pl - 0.1)), 0.28);
  const highlightRgb = liftToMin(hslToRgb(ph + 0.025, Math.max(0.52, ps - 0.1), Math.min(0.95, pl + 0.12)), 0.48);
  return {
    primary: rgbCss(primaryRgb),
    secondary: rgbCss(secondaryRgb),
    highlight: rgbCss(highlightRgb),
    glow: rgbCss(secondaryRgb),
    shadow: 'rgba(0,6,10,0.48)',
  };
}

export function paletteFromSample(sample: CoverSample): LyricPalette {
  if (sample.mono) return SILVER_BLUE;
  const [h, s, l] = rgbToHsl(sample.best[0], sample.best[1], sample.best[2]);
  return paletteFromHsl(h, s, l, sample.avgL);
}

/** 自定义基色：输入 hex，走同一套三色生成逻辑。 */
export function paletteFromBaseColor(hex: string): LyricPalette {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return SILVER_BLUE;
  const n = parseInt(m[1]!, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const [h, s, l] = rgbToHsl(r, g, b);
  return paletteFromHsl(h, Math.max(s, 0.35), l, l);
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1]!, 16) : 0xffffff;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function sampleFromDrawable(
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  width: number,
  height: number,
): CoverSample | null {
  try {
    const maxDim = 480;
    const scale = Math.min(1, maxDim / Math.max(width, height));
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    draw(ctx, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;

    let best: [number, number, number] | null = null;
    let bestScore = -Infinity;
    let warm: [number, number, number] | null = null;
    let cool: [number, number, number] | null = null;
    let light: [number, number, number] | null = null;
    let dark: [number, number, number] | null = null;
    let accent: [number, number, number] | null = null;
    let bestChroma = 0;
    let maxChroma = 0;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let sumChroma = 0;
    let colorful = 0;
    let usableColorful = 0;
    let count = 0;
    const buckets = new Map<string, { r: number; g: number; b: number; n: number }>();

    for (let y = 0; y < h; y += 8) {
      for (let x = 0; x < w; x += 8) {
        const i = (y * w + x) * 4;
        const a = data[i + 3]!;
        if (a < 128) continue;
        const r = data[i]!;
        const g = data[i + 1]!;
        const b = data[i + 2]!;
        const lum = luma(r, g, b);
        const chr = chroma(r, g, b);
        const score = chr * 1.6 + (0.5 - Math.abs(lum - 0.5)) * 0.45;
        count++;
        sumR += r;
        sumG += g;
        sumB += b;
        sumChroma += chr;
        if (chr > maxChroma) maxChroma = chr;
        if (chr > 0.08) colorful++;
        if (chr > 0.08 && lum >= 0.12 && lum <= 0.88) usableColorful++;
        if (score > bestScore) {
          bestScore = score;
          best = [r, g, b];
        }
        if (r > b + 12 && (warm === null || chr > chroma(warm[0], warm[1], warm[2]))) warm = [r, g, b];
        if (b > r + 12 && (cool === null || chr > chroma(cool[0], cool[1], cool[2]))) cool = [r, g, b];
        if (lum > 0.68 && (light === null || lum > luma(light[0], light[1], light[2]))) light = [r, g, b];
        if (lum < 0.3 && (dark === null || lum < luma(dark[0], dark[1], dark[2]))) dark = [r, g, b];
        if (chr > bestChroma && lum >= 0.2 && lum <= 0.85) {
          bestChroma = chr;
          accent = [r, g, b];
        }
        const key = `${Math.floor(r / 24)},${Math.floor(g / 24)},${Math.floor(b / 24)}`;
        const bucket = buckets.get(key);
        if (bucket) {
          bucket.r += r;
          bucket.g += g;
          bucket.b += b;
          bucket.n++;
        } else {
          buckets.set(key, { r, g, b, n: 1 });
        }
      }
    }
    if (!count || !best) return null;
    const avgR = sumR / count;
    const avgG = sumG / count;
    const avgB = sumB / count;
    const area = [...buckets.values()].sort((a, b) => b.n - a.n)[0];
    const avgChroma = sumChroma / count;
    const colorfulRatio = colorful / count;
    const usableColorfulRatio = usableColorful / count;
    const mono =
      maxChroma < 0.095 ||
      avgChroma < 0.026 ||
      colorfulRatio < 0.014 ||
      usableColorfulRatio < 0.006;
    return {
      best,
      warm: warm ?? best,
      cool: cool ?? best,
      light: light ?? best,
      dark: dark ?? best,
      accent: accent ?? best,
      area: area ? [Math.round(area.r / area.n), Math.round(area.g / area.n), Math.round(area.b / area.n)] : best,
      avg: [Math.round(avgR), Math.round(avgG), Math.round(avgB)],
      avgL: luma(avgR, avgG, avgB),
      avgChroma,
      maxChroma,
      colorfulRatio,
      usableColorfulRatio,
      mono,
    };
  } catch {
    return null;
  }
}

/** 从封面图片 URL 采样（每 8 像素一次，跳过 alpha<0.5）。 */
export async function sampleCover(src: string): Promise<CoverSample | null> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('cover load failed'));
    im.src = src;
  });
  return sampleFromDrawable(
    (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
    img.naturalWidth || 1,
    img.naturalHeight || 1,
  );
}

/** 从当前背景媒体元素（img / video）采样。 */
export async function sampleMediaElement(el: HTMLImageElement | HTMLVideoElement): Promise<CoverSample | null> {
  const width = (el as HTMLVideoElement).videoWidth || (el as HTMLImageElement).naturalWidth || 1;
  const height = (el as HTMLVideoElement).videoHeight || (el as HTMLImageElement).naturalHeight || 1;
  return sampleFromDrawable(
    (ctx, w, h) => ctx.drawImage(el, 0, 0, w, h),
    width,
    height,
  );
}

export function coverCssVars(sample: CoverSample | null): Record<string, string> {
  if (!sample) return {};
  return {
    '--cover-dominant-rgb': `${sample.best[0]}, ${sample.best[1]}, ${sample.best[2]}`,
    '--cover-accent-rgb': `${sample.accent[0]}, ${sample.accent[1]}, ${sample.accent[2]}`,
    '--cover-area-rgb': `${sample.area[0]}, ${sample.area[1]}, ${sample.area[2]}`,
    '--cover-avg-rgb': `${sample.avg[0]}, ${sample.avg[1]}, ${sample.avg[2]}`,
  };
}

export function lyricPaletteCssVars(palette: LyricPalette): Record<string, string> {
  const toRgb = (css: string): string => {
    const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(css);
    return m ? `${m[1]}, ${m[2]}, ${m[3]}` : '245, 246, 250';
  };
  return {
    '--lyric-primary-rgb': toRgb(palette.primary),
    '--lyric-secondary-rgb': toRgb(palette.secondary),
    '--lyric-highlight-rgb': toRgb(palette.highlight),
    '--lyric-glow-rgb': toRgb(palette.glow),
    '--lyric-shadow': palette.shadow,
  };
}

export function paletteToRgbTriplet(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  return `${r}, ${g}, ${b}`;
}
