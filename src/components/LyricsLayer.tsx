import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { LyricLineUI } from '../lib/lyrics';
import { currentLyricIndex } from '../lib/lyrics';

export interface FrameBus {
  x: number;
  y: number;
  zoom: number;
  vw: number;
  vh: number;
}

export interface LyricVisualSettings {
  fontSize: number;
  highlightStyle: 'sweep' | 'float';
  wordHighlight: boolean;
  /** 悬浮层次：under = 卡片云之下（Z1）；over = 覆盖在卡片云之上。 */
  layerMode: 'under' | 'over';
}

interface LyricsLayerProps {
  lines: LyricLineUI[];
  currentTime: number;
  playing: boolean;
  translateOn: boolean;
  frameBus: FrameBus;
  settings: LyricVisualSettings;
  /** 当前歌曲唯一标识：切歌时立即重置飞行状态，避免旧歌句子残留。 */
  songKey?: string;
}

type LyricState = 'future' | 'current' | 'past';

interface Flight {
  lineIdx: number;
  state: LyricState;
  prevState: LyricState;
  /** 屏幕坐标（不随 pan/zoom 变化，与背景层一样固定）。 */
  sx: number;
  sy: number;
  /** 基础匀速速度（过去/未来句使用）。 */
  vx: number;
  vy: number;
  /** 路径起点与斜率，当前句沿轨迹做位置补偿。 */
  p0x: number;
  p0y: number;
  slope: number;
  rot: number;
  /** 轻微随机缩放基准（生成时一次定死，避免同首歌里跳来跳去）。 */
  baseScale: number;
  scale: number;
  targetScale: number;
  opacity: number;
  targetOpacity: number;
}

const MARGIN = 240;
const MAX_ACTIVE_FAST = 3;
const MAX_ACTIVE_SLOW = 4;
const SLOW_GAP_MS = 5200;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** 由行时长推导整句穿越视口所需时间：长句慢、短句快。 */
function travelMs(line: LyricLineUI, nextTime?: number): number {
  const dur = line.duration ?? (nextTime != null ? clamp(nextTime - line.timeMs, 1200, 12000) : 6000);
  return clamp(dur + 3200, 5200, 11000);
}

/**
 * Z1 空域层：斜向穿梭歌词（状态机 + 逐字中心位置补偿）。
 * - 屏幕坐标定位：不随鼠标缩放/画布平移变化，与背景层一样固定；
 * - currentTime 由 rAF 平滑外推（audio timeupdate 仅 ~4Hz），逐字特效 60fps；
 * - 当前句逐字做“位置偏移补偿”，让正在唱的字位于画面水平中心；
 * - 一句只飞一次；回拉进度条时清空消耗标记恢复显示；
 * - 过去/未来句可更边缘，当前句飞行带更靠近垂直中心。
 */
export function LyricsLayer({
  lines,
  currentTime,
  playing,
  translateOn,
  frameBus,
  settings,
  songKey,
}: LyricsLayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const elRefs = useRef(new Map<number, HTMLSpanElement>());
  const wordEls = useRef(new Map<string, HTMLSpanElement>());
  const flights = useRef(new Map<number, Flight>());
  const consumedRef = useRef(new Set<number>());
  const [activeKeys, setActiveKeys] = useState<number[]>([]);
  const lastKeysRef = useRef('');
  const prevLinesRef = useRef(lines);
  const songKeyRef = useRef(songKey);
  /** 歌词数据是否已属于当前歌曲（切歌后、新歌词到达前不渲染）。 */
  const linesReadyRef = useRef(true);
  const propMsRef = useRef(currentTime * 1000);
  const smoothTRef = useRef(currentTime * 1000);
  const lastTRef = useRef(currentTime * 1000);

  // 切歌：立即清空飞行对象并暂停渲染，等待新歌词到达
  if (songKey !== songKeyRef.current) {
    songKeyRef.current = songKey;
    linesReadyRef.current = false;
    flights.current.clear();
    elRefs.current.clear();
    wordEls.current.clear();
    consumedRef.current.clear();
    lastKeysRef.current = '';
    propMsRef.current = 0;
    smoothTRef.current = 0;
    lastTRef.current = 0;
  }
  // 新歌词到达（或换歌后首次拿到数据）：恢复渲染
  if (lines !== prevLinesRef.current) {
    prevLinesRef.current = lines;
    flights.current.clear();
    elRefs.current.clear();
    wordEls.current.clear();
    consumedRef.current.clear();
    lastKeysRef.current = '';
    linesReadyRef.current = true;
  }

  const playingRef = useRef(playing);
  playingRef.current = playing;
  const propMs = currentTime * 1000;
  if (propMs !== propMsRef.current) {
    propMsRef.current = propMs;
    smoothTRef.current = propMs;
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let raf = 0;
    let last = performance.now();

    const spawn = (lineIdx: number, idx: number): Flight => {
      const f = frameBus;
      const cw = f.vw;
      const ch = f.vh;
      // 低概率从上下边缘进入，其余左右两侧；当前/将到句的飞行带更靠垂直中心
      const vertical = Math.random() < 0.12;
      const central = Math.abs(lineIdx - idx) <= 1;
      const band = central ? [ch * 0.38, ch * 0.62] : [ch * 0.18, ch * 0.82];
      const exitY = rand(band[0]!, band[1]!);
      let sx0: number;
      let sy0: number;
      let sx1: number;
      let sy1: number;
      if (vertical) {
        const fromTop = Math.random() < 0.5;
        sx0 = rand(-MARGIN, cw + MARGIN);
        sy0 = fromTop ? -MARGIN : ch + MARGIN;
        sx1 = rand(cw * 0.2, cw * 0.8);
        sy1 = fromTop ? ch + MARGIN : -MARGIN;
      } else {
        const fromLeft = Math.random() < 0.5;
        sy1 = exitY;
        sy0 = clamp(
          exitY + (fromLeft ? rand(ch * 0.08, ch * 0.22) : rand(-ch * 0.22, -ch * 0.08)),
          ch * 0.12,
          ch * 0.88,
        );
        sx0 = fromLeft ? -MARGIN : cw + MARGIN;
        sx1 = fromLeft ? cw + MARGIN : -MARGIN;
      }
      const dx = sx1 - sx0;
      const dy = sy1 - sy0;
      const dist = Math.hypot(dx, dy) || 1;
      const line = lines[lineIdx];
      const travel = travelMs(line ?? { timeMs: 0 }, lines[lineIdx + 1]?.timeMs);
      const speed = dist / (travel / 1000);
      // 路径角映射 [-90, 90]（永不倒置）+ ±3° 随机扰动，不完全贴路径
      let rot = (Math.atan2(dy, dx) * 180) / Math.PI;
      rot = ((rot + 90) % 180) - 90 + rand(-3, 3);
      const baseScale = rand(0.96, 1.04);
      return {
        lineIdx,
        state: 'future',
        prevState: 'future',
        sx: sx0,
        sy: sy0,
        vx: (dx / dist) * speed,
        vy: (dy / dist) * speed,
        p0x: sx0,
        p0y: sy0,
        slope: dx !== 0 ? dy / dx : 0,
        rot,
        baseScale,
        scale: 0.66 * baseScale,
        targetScale: 0.66 * baseScale,
        opacity: 0.55,
        targetOpacity: 0.55,
      };
    };

    const syncActive = (): void => {
      const keys = [...flights.current.keys()].sort((a, b) => a - b);
      const sig = keys.join(',');
      if (sig !== lastKeysRef.current) {
        lastKeysRef.current = sig;
        setActiveKeys(keys);
      }
    };

    const frame = (now: number): void => {
      const dt = clamp((now - last) / 1000, 0.001, 0.05);
      last = now;
      const f = frameBus;
      const cw = f.vw;
      const ch = f.vh;
      const playingNow = playingRef.current;
      // 平滑时间：播放中按真实帧间隔外推（audio timeupdate 只有 ~4Hz）
      let t = smoothTRef.current;
      if (playingNow) {
        t += dt * 1000;
        smoothTRef.current = t;
      }
      // 回拉进度条：清掉消耗标记，让画面重新正常显示
      if (t < lastTRef.current - 1500) consumedRef.current.clear();
      lastTRef.current = t;

      const idx = currentLyricIndex(lines, t);
      const active = flights.current;
      // 切歌后歌词未就绪：保持空白，不生成任何句子
      if (!linesReadyRef.current) {
        syncActive();
        raf = requestAnimationFrame(frame);
        return;
      }
      const gap = idx >= 0 ? (lines[idx + 1]?.timeMs ?? 0) - (lines[idx]?.timeMs ?? 0) : 0;
      const maxActive = gap > SLOW_GAP_MS ? MAX_ACTIVE_SLOW : MAX_ACTIVE_FAST;

      // 1) 状态重判（拖进度条/暂停时也实时生效）
      for (const fl of active.values()) {
        fl.state = fl.lineIdx < idx ? 'past' : fl.lineIdx === idx ? 'current' : 'future';
        if (fl.state === 'past') consumedRef.current.add(fl.lineIdx);
        if (fl.state !== fl.prevState) {
          fl.prevState = fl.state;
          const isCur = fl.state === 'current';
          // 固定区间 + 轻微随机（baseScale 一次定死），层次拉开
          fl.targetScale = (isCur ? 1.3 : fl.state === 'future' ? 0.66 : 0.7) * fl.baseScale;
          fl.targetOpacity = isCur ? 1 : fl.state === 'future' ? 0.55 : 0.66;
        }
      }

      // 2) 创建：当前句必在；未来句按下一句间隔动态 lead 提前入场
      if (idx >= 0 && !active.has(idx) && !consumedRef.current.has(idx)) {
        active.set(idx, spawn(idx, idx));
      }
      for (let i = 0; i < lines.length && active.size < maxActive; i++) {
        if (active.has(i) || consumedRef.current.has(i)) continue;
        if (i <= idx) continue;
        const next = lines[i + 1]?.timeMs;
        const gapI = (next ?? lines[i]!.timeMs + 4000) - lines[i]!.timeMs;
        const lead = clamp(gapI * 0.25, 350, 1200);
        if (t + lead >= lines[i]!.timeMs) active.set(i, spawn(i, idx));
      }
      // 超限：优先杀最早的 past 句，其次最小下标（只消耗已唱完的，未来句可重新生成）
      while (active.size > maxActive) {
        const pastKeys = [...active.keys()].filter((k) => active.get(k)!.state === 'past');
        const killKey = (pastKeys.length ? pastKeys : [...active.keys()]).sort((a, b) => a - b)[0];
        if (killKey == null) break;
        if (active.get(killKey)!.state === 'past') consumedRef.current.add(killKey);
        active.delete(killKey);
      }

      // 3) 更新每个飞行对象
      for (const [lineIdx, fl] of active) {
        const line = lines[lineIdx];
        const lineWords = line?.words && settings.wordHighlight ? line.words : undefined;
        const isCurrent = fl.state === 'current';
        if (playingNow) {
          if (isCurrent && lineWords?.length) {
            // 位置偏移补偿：让正在唱的字位于画面水平中心（沿轨迹取 y）
            let wi = lineWords.findIndex((w) => t >= w.startMs && t <= w.startMs + (w.duration || 0));
            if (wi < 0) wi = lineWords.findIndex((w) => t <= w.startMs + (w.duration || 0) / 2);
            if (wi < 0) wi = lineWords.length - 1;
            const wEl = wordEls.current.get(`${lineIdx}:${wi}`);
            const cosR = Math.abs(Math.cos((fl.rot * Math.PI) / 180)) || 1;
            const off = wEl ? (wEl.offsetLeft + wEl.offsetWidth / 2) * fl.scale * cosR : 0;
            const targetSx = cw / 2 - off;
            // 沿轨迹取 y，但夹在可见域内，防止垂直入场的大斜率把当前句带出屏幕
            const targetSy = clamp(fl.p0y + (targetSx - fl.p0x) * fl.slope, ch * 0.08, ch * 0.92);
            const k = 1 - Math.exp(-dt * 10);
            fl.sx += (targetSx - fl.sx) * k;
            fl.sy += (targetSy - fl.sy) * k;
          } else {
            fl.sx += fl.vx * dt;
            fl.sy += fl.vy * dt;
          }
        }
        if (playingNow) {
          const k = 1 - Math.exp(-dt * 5.5);
          fl.scale += (fl.targetScale - fl.scale) * k;
          fl.opacity += (fl.targetOpacity - fl.opacity) * k;
        }

        const el = elRefs.current.get(lineIdx);
        if (!el) continue;
        el.style.transform = `translate3d(${fl.sx.toFixed(1)}px, ${fl.sy.toFixed(1)}px, 0) rotate(${fl.rot.toFixed(1)}deg) scale(${fl.scale.toFixed(3)})`;
        el.style.opacity = fl.opacity.toFixed(3);
        el.classList.toggle('is-current', isCurrent);

        // 逐字高亮：只有当前句按字推进；无字数据整句推进
        if (lineWords?.length) {
          for (let wi = 0; wi < lineWords.length; wi++) {
            const w = lineWords[wi]!;
            const key = `${lineIdx}:${wi}`;
            const wEl = wordEls.current.get(key);
            if (!wEl) continue;
            let wp = 0;
            if (isCurrent) {
              wp = clamp((t - w.startMs) / (w.duration || 1), 0, 1);
            } else if (fl.state === 'past') {
              wp = 1;
            }
            wEl.style.setProperty('--wp', wp.toFixed(3));
          }
        } else if (line && line.text) {
          const key = `${lineIdx}:whole`;
          const wEl = wordEls.current.get(key);
          if (wEl) {
            let wp = 0;
            if (isCurrent) {
              // 整句高亮：时长收窄到 2–4.8s，避免长句后半段拖
              const dur = clamp(
                line.duration ?? (lines[lineIdx + 1]?.timeMs != null ? lines[lineIdx + 1]!.timeMs - line.timeMs : 6000),
                2000,
                4800,
              );
              wp = clamp((t - line.timeMs) / dur, 0, 1);
            } else if (fl.state === 'past') {
              wp = 1;
            }
            wEl.style.setProperty('--wp', wp.toFixed(3));
          }
        }

        // 4) 回收：当前句不按原点位置回收（居中补偿时原点可能移出视口）；
        //    过去/未来句飞出视口后回收
        const offscreen = fl.sx < -MARGIN || fl.sx > cw + MARGIN || fl.sy < -MARGIN || fl.sy > ch + MARGIN;
        if (offscreen && fl.state !== 'current') {
          consumedRef.current.add(lineIdx);
          active.delete(lineIdx);
        }
      }
      syncActive();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, settings.wordHighlight]);

  // 换歌/清空时在绘制前清掉渲染列表，杜绝旧歌残留一帧
  useLayoutEffect(() => {
    lastKeysRef.current = '';
    setActiveKeys([]);
  }, [lines]);

  return (
    <div
      ref={containerRef}
      className={`lyrics-layer hl-${settings.highlightStyle}${
        settings.layerMode === 'over' ? ' lyrics-over' : ''
      }`}
      style={{ '--lyric-size': `${settings.fontSize}px` } as CSSProperties}
      aria-hidden="true"
    >
      {activeKeys.map((lineIdx) => {
        const line = lines[lineIdx];
        if (!line) return null;
        const useWords = settings.wordHighlight && !!line.words?.length;
        const words = useWords
          ? line.words!
          : line.text
            ? [{ text: line.text, startMs: line.timeMs, duration: line.duration || 4000 }]
            : [];
        const whole = !useWords && !!line.text;
        return (
          <span
            key={lineIdx}
            ref={(el) => {
              if (el) elRefs.current.set(lineIdx, el);
              else elRefs.current.delete(lineIdx);
            }}
            className="flow-lyric"
          >
            {words.length > 0 && (
              <span className={`fl-text${whole ? ' is-whole' : ''}`}>
                {words.map((w, wi) => {
                  const key = whole ? `${lineIdx}:whole` : `${lineIdx}:${wi}`;
                  const prev = words[wi - 1];
                  // 相邻拉丁词之间补空格，避免 “thisworldthat” 挤成一坨
                  const needSpace =
                    !whole && !!prev && /[A-Za-z0-9]/.test(prev.text) && /[A-Za-z0-9]/.test(w.text);
                  return (
                    <span
                      key={wi}
                      className="fl-word"
                      ref={(el) => {
                        if (el) wordEls.current.set(key, el);
                        else wordEls.current.delete(key);
                      }}
                    >
                      {needSpace ? ' ' : null}
                      <span className="fw-base">{w.text}</span>
                      <span className="fw-fill">{w.text}</span>
                    </span>
                  );
                })}
              </span>
            )}
            {translateOn && line.translation && <span className="fl-tr">{line.translation}</span>}
          </span>
        );
      })}
    </div>
  );
}
