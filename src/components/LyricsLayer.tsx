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
  /** 当前句放大系数（可 DIY）。 */
  currentScale: number;
  /** 逐字已唱字上浮幅度 px（可 DIY）。 */
  wordRise: number;
}

interface LyricsLayerProps {
  lines: LyricLineUI[];
  currentTime: number;
  playing: boolean;
  frameBus: FrameBus;
  settings: LyricVisualSettings;
  /** 当前歌曲唯一标识：切歌时立即重置飞行状态，避免旧歌句子残留。 */
  songKey?: string;
  /** 前奏/纯音乐时居中展示的歌曲信息。 */
  songTitle?: string;
  songArtist?: string;
}

type LyricState = 'future' | 'current' | 'past';

interface Flight {
  lineIdx: number;
  state: LyricState;
  prevState: LyricState;
  /** 屏幕坐标（不随 pan/zoom 变化，与背景层一样固定）。 */
  sx: number;
  sy: number;
  prevSx: number;
  prevSy: number;
  /** 基础匀速速度（过去/未来句使用）。 */
  vx: number;
  vy: number;
  /** 平滑后的真实位移速度（用于 past 出口接管）。 */
  realVx: number;
  realVy: number;
  /** 路径起点与斜率。 */
  p0x: number;
  p0y: number;
  slope: number;
  /** 是否垂直（上下）入场：限制斜率、不旋转文字、可穿播放条。 */
  vertical: boolean;
  rot: number;
  baseScale: number;
  scale: number;
  targetScale: number;
  opacity: number;
  targetOpacity: number;
  /** 当前句中心补偿目标的低通平滑值（换字阻尼）。 */
  targetSxSmooth: number;
  /** 下一句预补偿：第一字中心偏移（DOM 实测后缓存）。 */
  word0Offset: number;
  /** 下一句预补偿的水平随机偏置，避免与当前句完全重叠。 */
  preOffset: number;
  /** 过去句退出加速计时。 */
  exitT: number;
}

const MARGIN = 240;
const MAX_ACTIVE_FAST = 3;
const MAX_ACTIVE_SLOW = 4;
const SLOW_GAP_MS = 5200;
/** 底部播放条安全区（仅限左右水平小倾角句子）。 */
const BAR_SAFE = 112;
/** 下一句预补偿窗口：距 line.start 前多少毫秒开始缓向中心。 */
const PRECOMP_MS = 1800;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

/** 由行时长推导整句穿越视口所需时间：长句慢、短句快。 */
function travelMs(line: LyricLineUI, nextTime?: number): number {
  const dur = line.duration ?? (nextTime != null ? clamp(nextTime - line.timeMs, 1200, 12000) : 6000);
  return clamp(dur + 3200, 5200, 11000);
}

/** 估算单行文字像素宽度（CJK≈1 字宽，拉丁≈0.56 字宽），用于垂直句定位。 */
function estimateWidth(text: string, fontSize: number, scale: number): number {
  let w = 0;
  for (const ch of text) {
    w += /[\u2E80-\u9FFF\uF900-\uFAFF\u3000-\u303F]/.test(ch) ? 1 : 0.56;
  }
  return Math.max(48, w * fontSize * scale);
}

/**
 * Z1 空域层：斜向穿梭歌词（状态机 + 逐字中心软补偿）。
 * - 屏幕坐标定位，不随缩放/平移变化；
 * - currentTime 由 rAF 平滑外推（audio timeupdate 仅 ~4Hz）；
 * - 当前句逐字中心补偿带换字阻尼与 15%–85% 加权；
 * - 下一句在轮到时提前缓到中心，避免成为当前句时被往回拽；
 * - 过去句用真实位移速度柔和离场；一句只飞一次；回拉进度条恢复；
 * - 前奏/纯音乐居中展示歌曲信息。
 */
export function LyricsLayer({
  lines,
  currentTime,
  playing,
  frameBus,
  settings,
  songKey,
  songTitle,
  songArtist,
}: LyricsLayerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const elRefs = useRef(new Map<number, HTMLSpanElement>());
  const wordEls = useRef(new Map<string, HTMLSpanElement>());
  const flights = useRef(new Map<number, Flight>());
  const consumedRef = useRef(new Set<number>());
  const wpCacheRef = useRef(new Map<string, number>());
  const [activeKeys, setActiveKeys] = useState<number[]>([]);
  const lastKeysRef = useRef('');
  const prevLinesRef = useRef(lines);
  const songKeyRef = useRef(songKey);
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
    wpCacheRef.current.clear();
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
    wpCacheRef.current.clear();
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
  // 前奏/纯音乐：正文未开始时居中展示歌曲信息
  const introVisible =
    !!songTitle &&
    (lines.length === 0 || currentLyricIndex(lines, propMs) < 0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let raf = 0;
    let last = performance.now();

    const spawn = (lineIdx: number, idx: number): Flight => {
      const f = frameBus;
      const cw = f.vw;
      const ch = f.vh;
      const line = lines[lineIdx];
      const text = line?.text ?? '';
      const lineW = estimateWidth(text, settings.fontSize, 1);
      // 低概率上下边缘入场；左右句受底部播放条安全区约束
      const vertical = Math.random() < 0.12;
      const central = Math.abs(lineIdx - idx) <= 1;
      let sx0: number;
      let sy0: number;
      let sx1: number;
      let sy1: number;
      if (vertical) {
        // 垂直句：文字保持水平，按左右半区让文字朝向画面中心；可正常穿过播放条
        const fromTop = Math.random() < 0.5;
        const anchorX = rand(cw * 0.2, cw * 0.8);
        sx0 =
          anchorX >= cw / 2
            ? clamp(anchorX - lineW, cw * 0.04, cw - lineW - cw * 0.04)
            : clamp(anchorX, cw * 0.04, Math.max(cw * 0.04, cw - lineW - cw * 0.04));
        sy0 = fromTop ? -MARGIN : ch + MARGIN;
        // 水平位移 ≥0.45cw，避免近乎垂直的大斜率
        const drift = (Math.random() < 0.5 ? -1 : 1) * rand(cw * 0.45, cw * 0.6);
        sx1 = clamp(sx0 + drift, cw * 0.04, cw * 0.96);
        sy1 = fromTop ? ch + MARGIN : -MARGIN;
      } else {
        const fromLeft = Math.random() < 0.5;
        const centralBand = central ? [ch * 0.32, ch * 0.58] : [ch * 0.14, Math.min(ch * 0.78, ch - BAR_SAFE)];
        sy1 = rand(centralBand[0]!, centralBand[1]!);
        sy0 = clamp(
          sy1 + (fromLeft ? rand(ch * 0.08, ch * 0.2) : rand(-ch * 0.2, -ch * 0.08)),
          ch * 0.1,
          Math.min(ch * 0.86, ch - BAR_SAFE),
        );
        sx0 = fromLeft ? -MARGIN : cw + MARGIN;
        sx1 = fromLeft ? cw + MARGIN : -MARGIN;
      }
      const dx = sx1 - sx0;
      const dy = sy1 - sy0;
      const dist = Math.hypot(dx, dy) || 1;
      const travel = travelMs(line ?? { timeMs: 0 }, lines[lineIdx + 1]?.timeMs);
      const speed = dist / (travel / 1000);
      // 路径角映射 [-90, 90]（永不倒置）+ ±3° 扰动；垂直句文字不旋转
      let rot = vertical ? rand(-5, 5) : (Math.atan2(dy, dx) * 180) / Math.PI;
      if (!vertical) rot = ((rot + 90) % 180) - 90 + rand(-3, 3);
      const baseScale = rand(0.96, 1.04);
      return {
        lineIdx,
        state: 'future',
        prevState: 'future',
        sx: sx0,
        sy: sy0,
        prevSx: sx0,
        prevSy: sy0,
        vx: (dx / dist) * speed,
        vy: (dy / dist) * speed,
        realVx: 0,
        realVy: 0,
        p0x: sx0,
        p0y: sy0,
        slope: dx !== 0 ? dy / dx : 0,
        vertical,
        rot,
        baseScale,
        scale: 0.66 * baseScale,
        targetScale: 0.66 * baseScale,
        opacity: 0.55,
        targetOpacity: 0.55,
        targetSxSmooth: cw / 2,
        word0Offset: 0,
        preOffset: rand(-0.08, 0.08) * cw,
        exitT: 1,
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
      let t = smoothTRef.current;
      if (playingNow) {
        t += dt * 1000;
        smoothTRef.current = t;
      }
      if (t < lastTRef.current - 1500) consumedRef.current.clear();
      lastTRef.current = t;

      const idx = currentLyricIndex(lines, t);
      const active = flights.current;
      if (!linesReadyRef.current) {
        syncActive();
        raf = requestAnimationFrame(frame);
        return;
      }
      const gap = idx >= 0 ? (lines[idx + 1]?.timeMs ?? 0) - (lines[idx]?.timeMs ?? 0) : 0;
      const maxActive = gap > SLOW_GAP_MS ? MAX_ACTIVE_SLOW : MAX_ACTIVE_FAST;

      // 1) 状态重判 + 出口速度/视觉目标切换
      for (const fl of active.values()) {
        fl.state = fl.lineIdx < idx ? 'past' : fl.lineIdx === idx ? 'current' : 'future';
        if (fl.state === 'past') consumedRef.current.add(fl.lineIdx);
        if (fl.state !== fl.prevState) {
          fl.prevState = fl.state;
          const isCur = fl.state === 'current';
          fl.targetScale = (isCur ? settings.currentScale : fl.state === 'future' ? 0.66 : 0.7) * fl.baseScale;
          fl.targetOpacity = isCur ? 1 : fl.state === 'future' ? 0.55 : 0.66;
          if (fl.state === 'past') {
            // 用真实位移速度接管出口，避免方向/速度跳变
            const vMag = Math.hypot(fl.realVx, fl.realVy);
            const maxV = Math.max(90, Math.hypot(fl.vx, fl.vy));
            if (vMag > 24) {
              fl.vx = clamp(fl.realVx, -maxV, maxV);
              fl.vy = clamp(fl.realVy, -maxV, maxV);
            } else {
              // 被钉在中心附近：从 0 缓慢加速离开
              fl.vx = 0;
              fl.vy = 0;
            }
            fl.exitT = 0;
          }
        }
        if (fl.state === 'past' && fl.exitT < 1 && playingNow) {
          fl.exitT = Math.min(1, fl.exitT + dt / 0.7);
          const e = easeOutCubic(fl.exitT);
          fl.sx += fl.vx * e * dt;
          fl.sy += fl.vy * e * dt;
        } else if (playingNow) {
          const isCurrent = fl.state === 'current';
          const line = lines[fl.lineIdx];
          const lineWords = line?.words && settings.wordHighlight ? line.words : undefined;
          if (isCurrent && lineWords?.length) {
            // 换字阻尼：目标低通 + 字进度 15%–85% 加权
            let wi = lineWords.findIndex((w) => t >= w.startMs && t <= w.startMs + (w.duration || 0));
            if (wi < 0) wi = lineWords.findIndex((w) => t <= w.startMs + (w.duration || 0) / 2);
            if (wi < 0) wi = lineWords.length - 1;
            const w = lineWords[wi]!;
            const wEl = wordEls.current.get(`${fl.lineIdx}:${wi}`);
            const cosR = Math.abs(Math.cos((fl.rot * Math.PI) / 180)) || 1;
            const off = wEl ? (wEl.offsetLeft + wEl.offsetWidth / 2) * fl.scale * cosR : 0;
            const wordTarget = cw / 2 - off;
            fl.targetSxSmooth += (wordTarget - fl.targetSxSmooth) * (1 - Math.exp(-dt * 5));
            // 字进度加权：两端放松，中间用力
            const wp = clamp((t - w.startMs) / (w.duration || 1), 0, 1);
            const edge = 0.15;
            const weight =
              0.3 +
              0.7 *
                clamp(wp / edge, 0, 1) *
                clamp((1 - wp) / edge, 0, 1);
            let k = 10 * weight;
            if (fl.vertical) k *= 0.5; // 垂直句补偿减半，避免被强拉回中部
            const targetSx = fl.targetSxSmooth;
            const targetSy = fl.vertical
              ? fl.sy + (targetSx - fl.sx) * fl.slope
              : clamp(fl.p0y + (targetSx - fl.p0x) * fl.slope, ch * 0.08, ch - BAR_SAFE + 30);
            fl.sx += (targetSx - fl.sx) * (1 - Math.exp(-dt * k));
            fl.sy += (targetSy - fl.sy) * (1 - Math.exp(-dt * k));
          } else if (fl.state === 'future' && lineWords?.length && t >= line.timeMs - PRECOMP_MS) {
            // 下一句预补偿：轮到时已缓到中心，避免被往回拽
            if (fl.word0Offset === 0) {
              const w0 = wordEls.current.get(`${fl.lineIdx}:0`);
              if (w0) fl.word0Offset = (w0.offsetLeft + w0.offsetWidth / 2) * fl.scale;
            }
            const targetSx = cw / 2 - fl.word0Offset + fl.preOffset;
            const k = 1 - Math.exp(-dt * 2.2);
            fl.sx += (targetSx - fl.sx) * k;
            fl.sy += (fl.p0y + (targetSx - fl.p0x) * fl.slope - fl.sy) * k;
          } else {
            fl.sx += fl.vx * dt;
            fl.sy += fl.vy * dt;
          }
          // 真实位移速度跟踪
          const realK = 1 - Math.exp(-dt * 8);
          fl.realVx += ((fl.sx - fl.prevSx) / Math.max(dt, 1e-3) - fl.realVx) * realK;
          fl.realVy += ((fl.sy - fl.prevSy) / Math.max(dt, 1e-3) - fl.realVy) * realK;
          fl.prevSx = fl.sx;
          fl.prevSy = fl.sy;
          const k2 = 1 - Math.exp(-dt * 5.5);
          fl.scale += (fl.targetScale - fl.scale) * k2;
          fl.opacity += (fl.targetOpacity - fl.opacity) * k2;
        }

        const el = elRefs.current.get(fl.lineIdx);
        if (!el) continue;
        el.style.transform = `translate3d(${fl.sx.toFixed(1)}px, ${fl.sy.toFixed(1)}px, 0) rotate(${fl.rot.toFixed(1)}deg) scale(${fl.scale.toFixed(3)})`;
        el.style.opacity = fl.opacity.toFixed(3);
        el.classList.toggle('is-current', fl.state === 'current');

        // 逐字高亮（--wp 仅按需写入，过去/未来句只写一次）
        const line = lines[fl.lineIdx];
        const lineWords = line?.words && settings.wordHighlight ? line.words : undefined;
        if (lineWords?.length) {
          for (let wi = 0; wi < lineWords.length; wi++) {
            const w = lineWords[wi]!;
            const key = `${fl.lineIdx}:${wi}`;
            const wEl = wordEls.current.get(key);
            if (!wEl) continue;
            let wp = 0;
            if (fl.state === 'current') {
              wp = clamp((t - w.startMs) / (w.duration || 1), 0, 1);
            } else if (fl.state === 'past') {
              wp = 1;
            }
            const cached = wpCacheRef.current.get(key);
            if (cached === undefined || Math.abs(cached - wp) > 0.0005) {
              wpCacheRef.current.set(key, wp);
              wEl.style.setProperty('--wp', wp.toFixed(3));
            }
          }
        } else if (line && line.text) {
          const key = `${fl.lineIdx}:whole`;
          const wEl = wordEls.current.get(key);
          if (wEl) {
            let wp = 0;
            if (fl.state === 'current') {
              const dur = clamp(
                line.duration ?? (lines[fl.lineIdx + 1]?.timeMs != null ? lines[fl.lineIdx + 1]!.timeMs - line.timeMs : 6000),
                2000,
                4800,
              );
              wp = clamp((t - line.timeMs) / dur, 0, 1);
            } else if (fl.state === 'past') {
              wp = 1;
            }
            const cached = wpCacheRef.current.get(key);
            if (cached === undefined || Math.abs(cached - wp) > 0.0005) {
              wpCacheRef.current.set(key, wp);
              wEl.style.setProperty('--wp', wp.toFixed(3));
            }
          }
        }

        // 回收：当前句不按原点位置回收；过去/未来句飞出视口后回收
        const offscreen = fl.sx < -MARGIN || fl.sx > cw + MARGIN || fl.sy < -MARGIN || fl.sy > ch + MARGIN;
        if (offscreen && fl.state !== 'current') {
          consumedRef.current.add(fl.lineIdx);
          active.delete(fl.lineIdx);
        }
      }

      // 2) 创建：当前句必在；未来句按动态 lead 提前入场（跳过空行）
      if (idx >= 0 && !active.has(idx) && !consumedRef.current.has(idx)) {
        const line = lines[idx];
        if (line && (line.text || line.words?.length)) active.set(idx, spawn(idx, idx));
        else consumedRef.current.add(idx);
      }
      for (let i = 0; i < lines.length && active.size < maxActive; i++) {
        if (active.has(i) || consumedRef.current.has(i)) continue;
        if (i <= idx) continue;
        const line = lines[i]!;
        if (!line.text && !line.words?.length) {
          consumedRef.current.add(i);
          continue;
        }
        const next = lines[i + 1]?.timeMs;
        const gapI = (next ?? line.timeMs + 4000) - line.timeMs;
        const lead = clamp(gapI * 0.25, 350, 1200);
        if (t + lead >= line.timeMs) active.set(i, spawn(i, idx));
      }
      // 超限：优先杀最早的 past 句（只消耗已唱完的，未来句可重新生成）
      while (active.size > maxActive) {
        const pastKeys = [...active.keys()].filter((k) => active.get(k)!.state === 'past');
        const killKey = (pastKeys.length ? pastKeys : [...active.keys()]).sort((a, b) => a - b)[0];
        if (killKey == null) break;
        if (active.get(killKey)!.state === 'past') consumedRef.current.add(killKey);
        active.delete(killKey);
      }
      syncActive();
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, settings.wordHighlight, settings.currentScale]);

  // 换歌/清空时在绘制前清掉渲染列表
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
      style={
        {
          '--lyric-size': `${settings.fontSize}px`,
          '--lyric-rise': `${settings.wordRise}px`,
        } as CSSProperties
      }
      aria-hidden="true"
    >
      {/* 前奏/纯音乐：正文未开始时居中展示歌曲信息 */}
      {introVisible && (
        <div className="lyrics-intro">
          <div className="li-title">{songTitle}</div>
          {songArtist && <div className="li-artist">{songArtist}</div>}
          {lines.length === 0 && <div className="li-note">纯音乐 · 暂无歌词</div>}
        </div>
      )}
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
          </span>
        );
      })}
    </div>
  );
}
