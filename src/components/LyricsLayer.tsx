import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useAudioPlayer } from '../lib/audio/useAudioPlayer';
import { useInterfaceSettingsContext } from '../hooks/interfaceSettings/InterfaceSettingsContext';
import { useVisualAtmosphere } from '../hooks/background/VisualAtmosphereContext';
import { SILVER_BLUE, lyricPaletteCssVars, paletteFromBaseColor } from '../lib/coverColors';
import { currentLyricIndex, type LyricLineUI, type LyricWordUI } from '../lib/lyrics';
import type { FrameBus } from '../lib/stage';

interface LyricsLayerProps {
  lines: LyricLineUI[];
  frameBus: FrameBus;
  /** 当前歌曲唯一标识：切歌时立即重置飞行状态。 */
  songKey?: string;
  /** 前奏/纯音乐时居中展示的歌曲信息。 */
  songTitle?: string;
  songArtist?: string;
}

type Role = 'current' | 'next' | 'nextNext' | 'leaving';

interface Flight {
  lineIdx: number;
  role: Role;
  prevRole: Role;
  sx: number;
  sy: number;
  rot: number;
  baseScale: number;
  scale: number;
  targetScale: number;
  opacity: number;
  targetOpacity: number;
  /** 水平错位（8%–18% 视口宽，随机方向）。 */
  xOff: number;
  /** 垂直带偏移量（next 用）。 */
  yMag: number;
  /** 下下句带偏移量（生成时一次定死）。 */
  yMagNext: number;
  /** 布局二的上/下侧。 */
  side: 'above' | 'below';
  /** 呼吸相位。 */
  phase: number;
  /** 目标角度（按角色微调）。 */
  angleCur: number;
  angleNext: number;
  /** 入场状态。 */
  entering: boolean;
  entryT: number;
  entryDur: number;
  entryFromX: number;
  entryFromY: number;
  /** 离场状态。 */
  exitT: number;
  exitDur: number;
  exitVx: number;
  exitVy: number;
}

const MARGIN = 240;
/** 主带：垂直中心 ±12%。 */
const MAIN_Y = 0.5;
/** 下一句带偏移 18%–28% 高度。 */
const NEXT_MAG = [0.18, 0.28] as const;
/** 下下句带：堆叠布局再向外 34%–48%（夹在可视区内）。 */
const NEXTNEXT_MAG = [0.34, 0.48] as const;
/** 水平错位 8%–18% 视口宽。 */
const X_OFF = [0.08, 0.18] as const;
/** 垂直入场概率。 */
const VERTICAL_P = 0.12;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** 估算单行文字像素宽度（CJK≈1 字宽，拉丁≈0.56 字宽）。 */
function estimateWidth(text: string, fontSize: number, scale: number): number {
  let w = 0;
  for (const ch of text) {
    w += /[\u2E80-\u9FFF\uF900-\uFAFF\u3000-\u303F]/.test(ch) ? 1 : 0.56;
  }
  return Math.max(48, w * fontSize * scale);
}

/** 当前时间对应的“可用正文”行（跳过翻译独行/空行）。 */
function usableCurrent(lines: LyricLineUI[], timeMs: number): number {
  const idx = currentLyricIndex(lines, timeMs);
  for (let i = idx; i >= 0; i--) {
    if (lines[i] && (lines[i]!.text || lines[i]!.words?.length)) return i;
  }
  return -1;
}

function usableNext(lines: LyricLineUI[], from: number): number {
  for (let i = from + 1; i < lines.length; i++) {
    if (lines[i] && (lines[i]!.text || lines[i]!.words?.length)) return i;
  }
  return -1;
}

/**
 * Z1 空域层 v2：三身份带状系统。
 * - 全局最多 current / next / nextNext 三句，身份随播放时间实时推进；
 * - 当前句主带 = 垂直中心 ±12%，保护性微调（不追字居中）；
 * - next / nextNext 位于等候带，呼吸漂浮；晋升短距滑入主带；
 * - 离开斜向飞出，柔和不抢焦点；前奏/纯音乐居中展示歌曲信息。
 */
export function LyricsLayer({
  lines,
  frameBus,
  songKey,
  songTitle,
  songArtist,
}: LyricsLayerProps) {
  // 叶子高频订阅（播放进度）+ 上下文（设置 / 氛围色板）
  const playState = useAudioPlayer();
  const currentTime = playState.currentTime;
  const playing = playState.playing;
  const { lyricSettings: settings } = useInterfaceSettingsContext();
  const { palette: atmoPalette } = useVisualAtmosphere();
  const palette = useMemo(
    () =>
      settings.lyricColorSource === 'custom'
        ? paletteFromBaseColor(settings.customColor)
        : atmoPalette ?? SILVER_BLUE,
    [settings.lyricColorSource, settings.customColor, atmoPalette],
  );
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
  const styleRef = useRef(settings.highlightStyle);
  const propMsRef = useRef(currentTime * 1000);
  const smoothTRef = useRef(currentTime * 1000);
  const lastTRef = useRef(currentTime * 1000);
  const simTRef = useRef(0);
  /** 水平偏移平衡器：避免候选句连续多句扎堆同一侧。 */
  const balanceRef = useRef(0);

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
    simTRef.current = 0;
    balanceRef.current = 0;
  }
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
  // 切换高亮模式：清空 --wp/--feather 写入缓存，强制全量重写
  if (styleRef.current !== settings.highlightStyle) {
    styleRef.current = settings.highlightStyle;
    wpCacheRef.current.clear();
  }

  /** float 模式伪逐字：仅 highlightStyle === 'float' 时，为无 words 的 LRC 行
   *  按 CJK 逐字 / Latin 按词均匀分配时间生成 word-level 数据。
   *  sweep 模式返回空 Map → 走原有 whole-line 回退路径。 */
  const pseudoWordsMap = useMemo(() => {
    if (settings.highlightStyle !== 'float') return new Map<number, LyricWordUI[]>();
    const map = new Map<number, LyricWordUI[]>();
    const CJK = /[\u2E80-\u9FFF\uF900-\uFAFF\u3000-\u303F\uFF00-\uFFEF]/;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.words?.length || !line.text) continue;
      // 分词：CJK 逐字，Latin 按空格分词
      const tokens: string[] = [];
      let buf = '';
      for (const ch of line.text) {
        if (CJK.test(ch)) {
          if (buf) { tokens.push(buf); buf = ''; }
          tokens.push(ch);
        } else if (ch === ' ') {
          if (buf) { tokens.push(buf); buf = ''; }
        } else {
          buf += ch;
        }
      }
      if (buf) tokens.push(buf);
      if (tokens.length <= 1) continue;
      const gap = lines[i + 1] != null
        ? Math.min(12000, Math.max(1200, lines[i + 1]!.timeMs - line.timeMs))
        : 6000;
      const dur = line.duration ?? gap;
      const perToken = dur / tokens.length;
      map.set(i, tokens.map((t, j) => ({
        text: t,
        startMs: line.timeMs + j * perToken,
        duration: perToken,
      })));
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, settings.highlightStyle]);

  const playingRef = useRef(playing);
  playingRef.current = playing;
  const propMs = currentTime * 1000;
  if (propMs !== propMsRef.current) {
    propMsRef.current = propMs;
    smoothTRef.current = propMs;
  }
  // 前奏/纯音乐：正文（可用行）未开始时居中展示歌曲信息
  const introVisible = !!songTitle && (lines.length === 0 || usableCurrent(lines, propMs) === -1);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let raf = 0;
    let last = performance.now();

    /** 角色对应的目标带（不含呼吸）。 */
    const lineWidthPx = (lineIdx: number, line: LyricLineUI | undefined, scale: number): number => {
      const el = elRefs.current.get(lineIdx);
      const cosR = 1; // 旋转对水平投影影响 <2%，忽略
      if (el && el.scrollWidth > 0) return el.scrollWidth * scale * cosR;
      if (line?.text) return estimateWidth(line.text, settings.fontSize, 1) * scale;
      return 0;
    };
    /** 水平安全区：左右对称（当前句略紧），宽句被夹到中心而非偏向一侧。 */
    const clampX = (x: number, role: Role, width: number, cw: number): number => {
      const m = cw * (role === 'current' ? 0.08 : 0.1);
      return clamp(x, m, Math.max(m, cw - m - width));
    };
    const roleTarget = (
      fl: Flight,
      role: Role,
      cw: number,
      ch: number,
      line: LyricLineUI | undefined,
    ): { x: number; y: number } => {
      const width = lineWidthPx(fl.lineIdx, line, fl.scale);
      // 以“文字中心”对齐 cw/2 + xOff：xOff 作用于文字中心而非左边缘，
      // 否则正偏移会被半宽放大、负偏移被半宽抵消，视觉上整体偏右
      let x = cw / 2 - width / 2 + fl.xOff;
      x = clampX(x, role, width, cw);
      let y: number;
      if (role === 'current') {
        y = ch * MAIN_Y;
      } else if (role === 'next') {
        const mag = fl.yMag;
        y = settings.lyricLayout === 'stacked' ? ch * MAIN_Y - mag : fl.side === 'above' ? ch * MAIN_Y - mag : ch * MAIN_Y + mag;
      } else {
        const mag = fl.yMagNext;
        y =
          settings.lyricLayout === 'stacked'
            ? ch * MAIN_Y - mag
            : fl.side === 'above'
              ? ch * MAIN_Y + mag
              : ch * MAIN_Y - mag;
      }
      return { x, y: clamp(y, ch * 0.06, ch * 0.94) };
    };

    /** 按角色设置目标视觉。 */
    const applyRoleVisuals = (fl: Flight, role: Role): void => {
      const isCur = role === 'current';
      const isNext = role === 'next';
      fl.targetScale =
        (isCur ? settings.currentScale : isNext ? 0.82 : role === 'nextNext' ? 0.68 : fl.targetScale) * fl.baseScale;
      fl.targetOpacity = isCur ? 1 : isNext ? 0.62 : role === 'nextNext' ? 0.42 : 0.95;
      const targetAngle =
        role === 'current' ? fl.angleCur : role === 'next' ? fl.angleNext : role === 'nextNext' ? fl.angleNext + 5 : fl.angleCur;
      const entryBoost = fl.entering && fl.entryT < 1 ? 8 : 0;
      fl.rot += (targetAngle + entryBoost - fl.rot) * (1 - Math.exp(-dtRef * 4.5));
    };

    const spawnFlight = (lineIdx: number, role: Role, t: number, cw: number, ch: number): Flight => {
      const side = Math.random() < 0.5 ? 'above' : 'below';
      // 水平偏移平衡：连续同侧超过 2 次即强制换边，避免候选句扎堆一侧
      let xSign: number;
      if (balanceRef.current >= 1) xSign = -1;
      else if (balanceRef.current <= -1) xSign = 1;
      else xSign = Math.random() < 0.5 ? -1 : 1;
      balanceRef.current = clamp(balanceRef.current + xSign * 0.5, -2, 2);
      const fl: Flight = {
        lineIdx,
        role,
        prevRole: role,
        sx: 0,
        sy: 0,
        rot: rand(-14, 14),
        baseScale: rand(0.96, 1.04),
        scale: 0.68,
        targetScale: 0.68,
        opacity: 0,
        targetOpacity: 0.42,
        xOff: xSign * rand(X_OFF[0], X_OFF[1]) * cw,
        yMag: rand(NEXT_MAG[0], NEXT_MAG[1]) * ch,
        yMagNext:
          settings.lyricLayout === 'stacked'
            ? rand(NEXTNEXT_MAG[0], NEXTNEXT_MAG[1]) * ch
            : rand(NEXT_MAG[0], NEXT_MAG[1]) * ch,
        side,
        phase: rand(0, Math.PI * 2),
        angleCur: (Math.random() < 0.5 ? -1 : 1) * rand(8, 14),
        angleNext: (Math.random() < 0.5 ? -1 : 1) * rand(14, 20),
        entering: true,
        entryT: 0,
        entryDur: 1.2,
        entryFromX: 0,
        entryFromY: 0,
        exitT: 1,
        exitDur: 1.2,
        exitVx: 0,
        exitVy: 0,
      };
      const target = roleTarget(fl, role, cw, ch, lines[lineIdx]);
      const timeToStart = lines[lineIdx]?.timeMs != null ? lines[lineIdx]!.timeMs - t : 0;
      if (role === 'current') {
        // seek 补位：直接出现在主带，短促淡入
        fl.sx = target.x;
        fl.sy = target.y;
        fl.entering = true;
        fl.entryT = 1;
        fl.opacity = 0;
      } else {
        const canFly = timeToStart > 2000;
        if (canFly) {
          const vertical = Math.random() < VERTICAL_P;
          fl.entryDur = clamp(rand(1.1, 1.7), 0.6, Math.max(0.6, timeToStart * 0.85));
          if (vertical) {
            const fromTop = Math.random() < 0.5;
            fl.entryFromX = target.x;
            fl.entryFromY = fromTop ? -MARGIN : ch + MARGIN;
          } else {
            const fromLeft = Math.random() < 0.5;
            fl.entryFromX = fromLeft ? -MARGIN : cw + MARGIN;
            fl.entryFromY = target.y + rand(-ch * 0.06, ch * 0.06);
          }
          fl.sx = fl.entryFromX;
          fl.sy = fl.entryFromY;
          fl.entering = true;
          fl.entryT = 0;
        } else {
          fl.sx = target.x;
          fl.sy = target.y;
          fl.entering = true;
          fl.entryT = 1;
        }
      }
      return fl;
    };

    const syncActive = (): void => {
      const keys = [...flights.current.keys()].sort((a, b) => a - b);
      const sig = keys.join(',');
      if (sig !== lastKeysRef.current) {
        lastKeysRef.current = sig;
        setActiveKeys(keys);
      }
    };

    let dtRef = 0.016;

    const frame = (now: number): void => {
      const dt = clamp((now - last) / 1000, 0.001, 0.05);
      last = now;
      dtRef = dt;
      const f = frameBus;
      const cw = f.vw;
      const ch = f.vh;
      const playingNow = playingRef.current;
      let t = smoothTRef.current;
      if (playingNow) {
        t += dt * 1000;
        smoothTRef.current = t;
        simTRef.current += dt;
      }
      // seek 检测：清除新位置之后的 consumed 条目，让未来句可重新入场；同时保留旧的大跳回退保护
      if (Math.abs(t - lastTRef.current) > 200) {
        // 大幅回退（>1.5s）：完全清空
        if (t < lastTRef.current - 1500) {
          consumedRef.current.clear();
        } else {
          // 任意方向 seek（>200ms）：仅清除时间戳在新位置之后的条目
          for (const idx of consumedRef.current) {
            if (lines[idx] && lines[idx]!.timeMs > t) consumedRef.current.delete(idx);
          }
        }
      }
      lastTRef.current = t;

      const active = flights.current;
      if (!linesReadyRef.current) {
        syncActive();
        raf = requestAnimationFrame(frame);
        return;
      }

      // 三身份：current / next / nextNext（跳过不可用行）
      const cur = usableCurrent(lines, t);
      const next = cur >= 0 ? usableNext(lines, cur) : -1;
      const nextNext = next >= 0 ? usableNext(lines, next) : -1;
      const wanted: Array<{ idx: number; role: Role }> = [];
      if (cur >= 0) wanted.push({ idx: cur, role: 'current' });
      if (next >= 0) wanted.push({ idx: next, role: 'next' });
      if (nextNext >= 0) wanted.push({ idx: nextNext, role: 'nextNext' });

      // 1) 补建缺失身份
      for (const w of wanted) {
        if (!active.has(w.idx) && !consumedRef.current.has(w.idx)) {
          active.set(w.idx, spawnFlight(w.idx, w.role, t, cw, ch));
        }
      }

      // 2) 身份/角色推进
      for (const fl of active.values()) {
        const w = wanted.find((x) => x.idx === fl.lineIdx);
        const newRole: Role = w ? w.role : 'leaving';
        if (newRole !== fl.role) {
          fl.prevRole = fl.role;
          fl.role = newRole;
          // 晋升当前句：水平偏移收窄到中心附近，避免视觉重心持续偏一侧
          if (newRole === 'current') {
            fl.xOff = (fl.xOff >= 0 ? 1 : -1) * cw * 0.03;
          }
          if (newRole === 'leaving') {
            // 离开：左右 50%，带 ±1.5°–5° 小角度的非水平柔和飞出（1.0–1.4s）
            const dir = Math.random() < 0.5 ? -1 : 1;
            fl.exitT = 0;
            fl.exitDur = rand(1.0, 1.4);
            // 左出时目标需让“句尾”越过左边界，避免句尾未出屏即被回收
            const wPx = lineWidthPx(fl.lineIdx, lines[fl.lineIdx], fl.scale);
            const exitX = dir > 0 ? cw + MARGIN * 2 : -MARGIN * 2 - wPx;
            const exitY = fl.sy + rand(-ch * 0.1, ch * 0.08);
            const dx = exitX - fl.sx;
            const dy = exitY - fl.sy;
            const ang = ((Math.random() < 0.5 ? -1 : 1) * rand(1.5, 5) * Math.PI) / 180;
            const cosA = Math.cos(ang);
            const sinA = Math.sin(ang);
            fl.exitVx = (dx * cosA - dy * sinA) / fl.exitDur;
            fl.exitVy = (dx * sinA + dy * cosA) / fl.exitDur;
          }
        }
        applyRoleVisuals(fl, fl.role);
      }

      // 3) 逐句更新
      for (const [lineIdx, fl] of active) {
        const line = lines[lineIdx];
        if (fl.role === 'leaving') {
          if (playingNow && fl.exitT < 1) {
            fl.exitT = Math.min(1, fl.exitT + dt / fl.exitDur);
            const ease = 1 - 0.35 * fl.exitT; // 轻微减速
            fl.sx += fl.exitVx * ease * dt;
            fl.sy += fl.exitVy * ease * dt;
          }
        } else if (playingNow) {
          const target = roleTarget(fl, fl.role, cw, ch, lines[lineIdx]);
          let tx = target.x;
          const ty = target.y;
          // 当前句：保护性微调（最后 25%–30% 时长冻结）
          if (fl.role === 'current' && line && line.words?.length) {
            const dur = line.duration ?? (lines[lineIdx + 1]?.timeMs != null ? lines[lineIdx + 1]!.timeMs - line.timeMs : 6000);
            const remaining = line.timeMs + dur - t;
            if (remaining > dur * 0.3) {
              const wi = line.words.findIndex((w) => t >= w.startMs && t <= w.startMs + (w.duration || 0));
              const idxW = wi < 0 ? line.words.findIndex((w) => t <= w.startMs + (w.duration || 0) / 2) : wi;
              const wEl = idxW >= 0 ? wordEls.current.get(`${lineIdx}:${idxW}`) : undefined;
              if (wEl && idxW >= 0) {
                const cosR = Math.abs(Math.cos((fl.rot * Math.PI) / 180)) || 1;
                const off = (wEl.offsetLeft + wEl.offsetWidth / 2) * fl.scale * cosR;
                const wordX = fl.sx + off;
                if (wordX < cw * 0.12) tx += (cw * 0.12 - wordX) * 0.18;
                else if (wordX > cw * 0.88) tx -= (wordX - cw * 0.88) * 0.18;
                tx = clampX(tx, 'current', lineWidthPx(lineIdx, line, fl.scale), cw);
              }
            }
          }
          if (fl.entering && fl.entryT < 1) {
            fl.entryT = Math.min(1, fl.entryT + dt / fl.entryDur);
            const e = easeInOutCubic(fl.entryT);
            fl.sx = fl.entryFromX + (tx - fl.entryFromX) * e;
            fl.sy = fl.entryFromY + (ty - fl.entryFromY) * e;
            if (fl.entryT >= 1) fl.entering = false;
          } else {
            // 呼吸漂浮（仅等候句）
            let bx = 0;
            let by = 0;
            if (fl.role === 'next' || fl.role === 'nextNext') {
              bx = Math.sin(simTRef.current * 1.4 + fl.phase) * cw * 0.012;
              by = Math.cos(simTRef.current * 1.05 + fl.phase) * ch * 0.014;
            }
            const k = 1 - Math.exp(-dt * (fl.role === 'current' ? 3.5 : 2.0));
            fl.sx += (tx + bx - fl.sx) * k;
            fl.sy += (ty + by - fl.sy) * k;
          }
          const k2 = 1 - Math.exp(-dt * 5);
          fl.scale += (fl.targetScale - fl.scale) * k2;
          fl.opacity += (fl.targetOpacity - fl.opacity) * k2;
        }

        const el = elRefs.current.get(lineIdx);
        if (!el) continue;
        el.style.transform = `translate3d(${fl.sx.toFixed(1)}px, ${fl.sy.toFixed(1)}px, 0) rotate(${fl.rot.toFixed(1)}deg) scale(${fl.scale.toFixed(3)})`;
        el.style.opacity = fl.opacity.toFixed(3);
        el.classList.toggle('is-current', fl.role === 'current');

        // 逐字高亮（仅 current；--wp 按需写）
        const lineWords = (fl.role === 'current') ? (line?.words?.length ? line.words : pseudoWordsMap.get(lineIdx)) : undefined;
        if (lineWords?.length) {
          for (let wi = 0; wi < lineWords.length; wi++) {
            const w = lineWords[wi]!;
            const key = `${lineIdx}:${wi}`;
            const wEl = wordEls.current.get(key);
            if (!wEl) continue;
            const wp = clamp((t - w.startMs) / (w.duration || 1), 0, 1);
            const cached = wpCacheRef.current.get(key);
            if (cached === undefined || Math.abs(cached - wp) > 0.0005) {
              wpCacheRef.current.set(key, wp);
              wEl.style.setProperty('--wp', wp.toFixed(3));
              wEl.style.setProperty('--feather', '0.06');
            }
          }
        } else if (line && line.text) {
          const key = `${lineIdx}:whole`;
          const wEl = wordEls.current.get(key);
          if (wEl) {
            let wp = 0;
            if (fl.role === 'current') {
              const dur = clamp(
                line.duration ?? (lines[lineIdx + 1]?.timeMs != null ? lines[lineIdx + 1]!.timeMs - line.timeMs : 6000),
                2000,
                4800,
              );
              wp = clamp((t - line.timeMs) / dur, 0, 1);
            }
            const cached = wpCacheRef.current.get(key);
            if (cached === undefined || Math.abs(cached - wp) > 0.0005) {
              wpCacheRef.current.set(key, wp);
              wEl.style.setProperty('--wp', wp.toFixed(3));
              wEl.style.setProperty('--feather', '0.055');
            }
          }
        }

        // 回收：按出场方向判“整句”越界（左出用句尾，右出用句首），句尾未出屏不删
        const wPx = lineWidthPx(lineIdx, line, fl.scale);
        const offX = fl.exitVx > 0 ? fl.sx > cw + MARGIN : fl.sx + wPx < -MARGIN;
        const offscreen = offX || fl.sy < -MARGIN || fl.sy > ch + MARGIN;
        if (fl.role === 'leaving' && (offscreen || fl.exitT >= 1)) {
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
  }, [lines, settings.currentScale, settings.lyricLayout, settings.highlightStyle]);

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
          '--lyric-weight': settings.bold ? 700 : 600,
          ...lyricPaletteCssVars(palette),
        } as CSSProperties
      }
      aria-hidden="true"
    >
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
        const pseudoWords = pseudoWordsMap.get(lineIdx);
        const hasRealWords = !!line.words?.length;
        const words = hasRealWords
          ? line.words!
          : pseudoWords
            ? pseudoWords
            : line.text
              ? [{ text: line.text, startMs: line.timeMs, duration: line.duration || 4000 }]
              : [];
        const whole = !hasRealWords && !pseudoWords && !!line.text;
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
                      {w.text}
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