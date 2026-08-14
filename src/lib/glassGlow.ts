/**
 * 液态玻璃交互系统（全局委托，零组件侵入）。
 *
 * - 任何匹配 `.glass` 系选择器的元素，鼠标进入后启动局部流体柔光：
 *   光标相对坐标写入 `--gx / --gy`（百分比），由 `::after` 径向渐变承载；
 *   位置以指数平滑跟随（自然惯性），离开后平滑淡出。
 * - 两级反馈：
 *   1) 靠近（邻近半径内）→ `.is-near`：轻微上浮（仅 transform，不动底色/模糊）；
 *   2) 进入内部 → 启动局部柔光（`--glow-a` 渐入）。
 * - 光晕颜色取自全局 `--glow-rgb`（由背景采样模块按底色实时调整）。
 */

export const GLASS_SELECTOR = [
  '.glass',
  '.glass-btn',
  '.music-card',
  '.bottom-bar',
  '.search-box',
  '.search-drop',
  '.import-panel',
  '.login-panel',
  '.bg-picker',
  '.now-playing',
  '.now-playing-panel',
  '.lyric-bar',
].join(',');

interface GlowState {
  el: HTMLElement;
  gx: number;
  gy: number;
  tx: number;
  ty: number;
  alpha: number;
  targetAlpha: number;
  active: boolean;
}

const NEAR_RADIUS = 150;
const LERP = 0.16;
const FADE = 0.16;

let initialized = false;
let raf = 0;
const states = new Map<HTMLElement, GlowState>();
const proximityTargets = new Set<HTMLElement>();
let cursor = { x: -9999, y: -9999 };

function matchGlass(target: EventTarget | null): HTMLElement | null {
  let el = target as HTMLElement | null;
  while (el && el !== document.body) {
    if (el.matches?.(GLASS_SELECTOR)) return el;
    el = el.parentElement;
  }
  return null;
}

function ensureState(el: HTMLElement): GlowState {
  let s = states.get(el);
  if (!s) {
    s = { el, gx: 50, gy: 50, tx: 50, ty: 50, alpha: 0, targetAlpha: 0, active: false };
    states.set(el, s);
    kick();
  }
  return s;
}

function onPointerMove(e: PointerEvent): void {
  cursor.x = e.clientX;
  cursor.y = e.clientY;

  const glass = matchGlass(e.target);
  for (const el of states.keys()) {
    const s = states.get(el)!;
    if (el !== glass) {
      if (!s.active) continue;
      // 指针离开：若仍在元素内（移动到子节点）则不关闭
      if (el.contains(e.target as Node)) continue;
      s.active = false;
      s.targetAlpha = 0;
    }
  }
  if (!glass) return;

  const s = ensureState(glass);
  const r = glass.getBoundingClientRect();
  s.tx = r.width > 0 ? ((e.clientX - r.left) / r.width) * 100 : 50;
  s.ty = r.height > 0 ? ((e.clientY - r.top) / r.height) * 100 : 50;
  s.active = true;
  s.targetAlpha = 1;

  // 邻近反馈（第二级之前的第一级：靠近卡片轻微上浮）
  for (const el of proximityTargets) {
    const r2 = el.getBoundingClientRect();
    const cx = r2.left + r2.width / 2;
    const cy = r2.top + r2.height / 2;
    const d = Math.hypot(e.clientX - cx, e.clientY - cy);
    const near = d < NEAR_RADIUS + Math.max(r2.width, r2.height) / 2;
    // 用 CSS 变量而非 class：避免被 React 的 className 协调清除
    el.style.setProperty('--near-z', near ? '26px' : '0px');
    el.style.setProperty('--near-s', near ? '1.045' : '1');
  }
}

function tick(): void {
  raf = 0;
  for (const [el, s] of states) {
    s.gx += (s.tx - s.gx) * LERP;
    s.gy += (s.ty - s.gy) * LERP;
    s.alpha += (s.targetAlpha - s.alpha) * FADE;
    el.style.setProperty('--gx', `${s.gx.toFixed(2)}%`);
    el.style.setProperty('--gy', `${s.gy.toFixed(2)}%`);
    el.style.setProperty('--glow-a', s.alpha.toFixed(3));
    if (!s.active && s.alpha < 0.01) states.delete(el);
  }
  if (states.size) kick();
}

function kick(): void {
  if (!raf) raf = requestAnimationFrame(tick);
}

export function initGlassGlow(): () => void {
  if (initialized) return () => undefined;
  initialized = true;
  document.addEventListener('pointermove', onPointerMove, { passive: true });
  return () => {
    initialized = false;
    document.removeEventListener('pointermove', onPointerMove);
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    states.clear();
  };
}

/** 注册邻近反馈目标（卡片挂载时调用，卸载时注销）。 */
export function registerProximity(el: HTMLElement | null): void {
  if (!el) return;
  proximityTargets.add(el);
}

export function unregisterProximity(el: HTMLElement | null): void {
  if (!el) return;
  proximityTargets.delete(el);
}
