import { wrap } from './layout';

export interface PanFrame {
  x: number;
  y: number;
  vw: number;
  vh: number;
  zoom: number;
}

export interface PanControllerOptions {
  tileWidth: number;
  tileHeight: number;
  initialX: number;
  initialY: number;
  /** 每帧回调：用于视口查询与卡片 CSS 变量更新（含静止后的最后一帧）。 */
  onFrame: (frame: PanFrame) => void;
  /** 拖拽真正开始（越过阈值）时回调，用于清除 hover。 */
  onPanStart?: () => void;
}

type Mode = 'idle' | 'dragging' | 'inertia';

const DRAG_THRESHOLD = 5;
const INERTIA_MIN_VELOCITY = 0.12;
const INERTIA_DECAY = 4.6;
const MAX_INERTIA_VELOCITY = 7;
const WHEEL_SETTLE_MS = 160;
const SAMPLE_WINDOW_MS = 120;
const ANIMATE_MS = 950;
export const ZOOM_MIN = 0.45;
export const ZOOM_MAX = 2.6;

/**
 * 无限平移引擎（Pointer + Wheel + 惯性 + 周期回绕）。
 * 只负责 pan 状态与手势，渲染由 onFrame 驱动。
 */
export class PanController {
  readonly pan = { x: 0, y: 0 };
  zoom = 1;

  private velocity = { x: 0, y: 0 };
  private mode: Mode = 'idle';
  private raf = 0;
  private lastFrame = 0;
  private lastWheelAt = -1e9;
  private activePointer: { id: number; x: number; y: number; t: number } | null = null;
  private downPos = { x: 0, y: 0 };
  private dragging = false;
  private samples: { x: number; y: number; t: number }[] = [];
  private disposed = false;

  constructor(
    private container: HTMLElement,
    private opts: PanControllerOptions,
  ) {
    this.pan.x = opts.initialX;
    this.pan.y = opts.initialY;
  }

  start(): void {
    const el = this.container;
    el.addEventListener('pointerdown', this.onPointerDown);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    window.addEventListener('resize', this.onResize);
    this.lastFrame = performance.now();
    this.requestFrame();
  }

  dispose(): void {
    this.disposed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
    const el = this.container;
    el.removeEventListener('pointerdown', this.onPointerDown);
    el.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    window.removeEventListener('resize', this.onResize);
  }

  /** 回到画布中心。 */
  reset(): void {
    const vw = this.container.clientWidth || window.innerWidth;
    const vh = this.container.clientHeight || window.innerHeight;
    this.pan.x = (this.opts.tileWidth - vw) / 2;
    this.pan.y = (this.opts.tileHeight - vh) / 2;
    this.zoom = 1;
    this.velocity = { x: 0, y: 0 };
    this.mode = 'idle';
    this.container.classList.remove('is-panning', 'is-grabbing');
    this.requestFrame();
  }

  /** 主动触发一次布局帧（渐进揭示、数据更新等场景使用）。 */
  refresh(): void {
    this.requestFrame();
  }

  /** 平滑动画定位到目标 pan 位置（搜索定位等场景；硬定位仍走 reset）。 */
  animateTo(target: { x: number; y: number }): void {
    this.mode = 'idle';
    this.velocity = { x: 0, y: 0 };
    const fromX = this.pan.x;
    const fromY = this.pan.y;
    const start = performance.now();

    const step = (now: number): void => {
      const t = Math.min(1, Math.max(0, (now - start) / ANIMATE_MS));
      const e = 1 - Math.pow(1 - t, 3);
      this.pan.x = fromX + (target.x - fromX) * e;
      this.pan.y = fromY + (target.y - fromY) * e;
      this.requestFrame();
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  private requestFrame(): void {
    if (!this.raf && !this.disposed) {
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (this.activePointer) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.activePointer = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    this.downPos = { x: e.clientX, y: e.clientY };
    this.dragging = false;
    this.velocity = { x: 0, y: 0 };
    this.samples = [];
    this.mode = 'dragging';
    this.requestFrame();
  };

  private onPointerMove = (e: PointerEvent): void => {
    const active = this.activePointer;
    if (!active || e.pointerId !== active.id) return;

    const now = performance.now();
    const dx = e.clientX - active.x;
    const dy = e.clientY - active.y;

    if (!this.dragging) {
      const moved = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y);
      if (moved > DRAG_THRESHOLD) {
        this.dragging = true;
        this.container.classList.add('is-panning', 'is-grabbing');
        this.opts.onPanStart?.();
      }
    }

    if (this.dragging) {
      this.pan.x -= dx;
      this.pan.y -= dy;
      this.samples.push({ x: e.clientX, y: e.clientY, t: now });
      this.trimSamples(now);
      this.requestFrame();
    }

    active.x = e.clientX;
    active.y = e.clientY;
    active.t = now;
  };

  private onPointerUp = (e: PointerEvent): void => {
    const active = this.activePointer;
    if (!active || e.pointerId !== active.id) return;
    this.activePointer = null;
    this.container.classList.remove('is-grabbing');

    if (this.dragging) {
      const v = this.computeVelocity();
      this.velocity = v;
      if (Math.hypot(v.x, v.y) >= INERTIA_MIN_VELOCITY) {
        this.mode = 'inertia';
      } else {
        this.mode = 'idle';
        this.velocity = { x: 0, y: 0 };
      }
    } else {
      this.mode = 'idle';
    }
    this.dragging = false;
    this.requestFrame();
  };

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    if (this.mode === 'inertia') {
      this.mode = 'idle';
      this.velocity = { x: 0, y: 0 };
    }
    const delta =
      e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * this.container.clientHeight : e.deltaY;
    // 滚轮缩放（以光标为锚点，光标下的世界点保持不动）
    const factor = Math.exp(-delta * 0.0014);
    const nextZoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, this.zoom * factor));
    if (Math.abs(nextZoom - this.zoom) > 1e-4) {
      const mx = e.clientX;
      const my = e.clientY;
      const wx = this.pan.x + mx / this.zoom;
      const wy = this.pan.y + my / this.zoom;
      this.zoom = nextZoom;
      this.pan.x = wx - mx / nextZoom;
      this.pan.y = wy - my / nextZoom;
    }
    this.lastWheelAt = performance.now();
    this.requestFrame();
  };

  private onResize = (): void => {
    this.requestFrame();
  };

  private tick = (now: number): void => {
    this.raf = 0;
    let keep = false;

    if (this.mode === 'dragging') {
      keep = true;
    } else if (this.mode === 'inertia') {
      const dt = Math.min(0.05, Math.max(0.001, (now - this.lastFrame) / 1000));
      this.pan.x += this.velocity.x * dt * 1000;
      this.pan.y += this.velocity.y * dt * 1000;
      const decay = Math.exp(-INERTIA_DECAY * dt);
      this.velocity.x *= decay;
      this.velocity.y *= decay;
      if (Math.hypot(this.velocity.x, this.velocity.y) < INERTIA_MIN_VELOCITY) {
        this.mode = 'idle';
        this.velocity = { x: 0, y: 0 };
      } else {
        keep = true;
      }
    }

    if (now - this.lastWheelAt < WHEEL_SETTLE_MS) keep = true;

    // 周期回绕：把 pan 收进 [0, tile)，内容周期性重复 → 视觉无边界
    this.pan.x = wrap(this.pan.x, this.opts.tileWidth);
    this.pan.y = wrap(this.pan.y, this.opts.tileHeight);

    this.opts.onFrame({
      x: this.pan.x,
      y: this.pan.y,
      vw: this.container.clientWidth || window.innerWidth,
      vh: this.container.clientHeight || window.innerHeight,
      zoom: this.zoom,
    });

    if (keep) {
      this.requestFrame();
    } else {
      this.container.classList.remove('is-panning');
    }
    this.lastFrame = now;
  };

  private computeVelocity(): { x: number; y: number } {
    const s = this.samples;
    if (s.length < 2) return { x: 0, y: 0 };
    const first = s[0]!;
    const last = s[s.length - 1]!;
    const dt = last.t - first.t;
    if (dt < 8) return { x: 0, y: 0 };
    let vx = (last.x - first.x) / dt;
    let vy = (last.y - first.y) / dt;
    const speed = Math.hypot(vx, vy);
    if (speed > MAX_INERTIA_VELOCITY) {
      const k = MAX_INERTIA_VELOCITY / speed;
      vx *= k;
      vy *= k;
    }
    return { x: -vx, y: -vy };
  }

  private trimSamples(now: number): void {
    const cutoff = now - SAMPLE_WINDOW_MS;
    while (this.samples.length > 1 && this.samples[0]!.t < cutoff) {
      this.samples.shift();
    }
  }
}
