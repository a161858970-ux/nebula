import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MutableRefObject, RefObject } from 'react';
import { audioPlayer } from '../../lib/audio/AudioPlayer';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  SEED,
  cardScreenPos,
  computeTileSize,
  generateCards,
  type CardSpec,
  type LayoutMetrics,
} from '../../lib/layout';
import { fisheyeBlur, fisheyeBrightness, fisheyeScale, fisheyeZIndex } from '../../lib/fisheye';
import { buildSpatialIndex, queryVisibleIds } from '../../lib/spatial';
import { CULL_BUFFER, type FrameBus } from '../../lib/stage';
import { initGlassGlow, registerProximity, unregisterProximity } from '../../lib/glassGlow';
import type { Track } from '../../lib/catalog';
import { mulberry32 } from '../../lib/rng';
import { buildClusterPositions, matchSongs, panForCentering, type SearchMatch } from '../../lib/search';
import { PanController } from '../../lib/panEngine';
import type { PanFrame } from '../../lib/panEngine';
import { hasDesktopAPI, toBackendTrack, toFrontendTrack } from '../../lib/playlist/ipcClient';
import type { DesktopTrack } from '../../lib/playlist/ipcClient';
import { libraryService } from '../../lib/library';
import { preferredQuality } from '../../lib/preferences';
import type { ImportStatus } from '../../lib/playlistTypes';

/** contextMenu 的最小结构类型（与 useOverlays.ContextMenuState 结构化兼容）。 */
interface CtxMenuShape {
  x: number;
  y: number;
  track: Track;
}

interface UseStageOptions {
  /** 舞台控制器 ref（App 声明并传给 useSearchCluster 做搜索定位接线）。 */
  controllerRef: MutableRefObject<PanController | null>;
  /** 当前曲库（渲染卡片 + 曲库刷新）。 */
  songs: Track[];
  /** 搜索命中（簇团替换有效布局）。 */
  searchMatches: SearchMatch[];
  /** 搜索聚簇定位（__nebula.search 接线）。 */
  applySearch: (matches: SearchMatch[], focusIndex: number | null) => void;
  /** 右键菜单打开时保留卡片悬浮态（防菜单抢占指针）。 */
  contextMenuRef: RefObject<CtxMenuShape | null>;
  /** 导入渐进揭示完成后的收尾（组合层接 usePlaylistImport.complete）。 */
  completeImport: (status: ImportStatus, message: string) => void;
  /** 当前播放歌曲 id（低频 context 注入，避免 stage 依赖 playback hook）。 */
  currentSongId: number | null;
  /** 卡片点播后打开二级播放窗。 */
  setNowPlayingOpen: (open: boolean) => void;
  /** 由 App 声明并传给 useSearchCluster 的布局 refs（useStage 渲染时写入）。 */
  metricsRef: MutableRefObject<LayoutMetrics>;
  effectiveCardsRef: MutableRefObject<CardSpec[]>;
}

/**
 * 舞台领域（docs/ARCHITECTURE.md §2，最后迁移的高风险块）：
 * 拥有 hovered/visible/failed/liked/渐进揭示/PanController/虚拟化渲染数据；
 * 只依赖 lib（audioPlayer / LibraryService / 布局 / 空间索引 / 搜索），不依赖其他 hook。
 */
export function useStage({
  controllerRef,
  songs,
  searchMatches,
  applySearch,
  contextMenuRef,
  completeImport,
  currentSongId,
  setNowPlayingOpen,
  metricsRef,
  effectiveCardsRef,
}: UseStageOptions) {
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [visibleIds, setVisibleIds] = useState<number[]>([]);
  const [revealedCount, setRevealedCount] = useState(() => songs.length);
  const [failedIds, setFailedIds] = useState<ReadonlySet<number>>(new Set());
  const [likedIds, setLikedIds] = useState<ReadonlySet<number>>(new Set());
  const [importing, setImporting] = useState(false);

  const stageRef = useRef<HTMLDivElement>(null);
  const cardEls = useRef(new Map<number, HTMLElement>());
  const visibleRef = useRef(new Set<number>());
  const revealedRef = useRef(revealedCount);
  const songsRef = useRef(songs);
  songsRef.current = songs;
  const revealTimerRef = useRef<number | null>(null);
  const spawnFromCenterRef = useRef<Set<number> | null>(null);
  const lastFailedSongRef = useRef<number | null>(null);

  // 派生布局（与 useSearchCluster 共用：渲染时写 refs，回调运行时读）
  const cards = useMemo(() => generateCards(mulberry32(SEED), songs), [songs]);
  const metrics = useMemo(() => computeTileSize(songs.length), [songs.length]);
  metricsRef.current = metrics;
  const clusterPositions = useMemo(
    () =>
      buildClusterPositions(
        cards,
        searchMatches.map((m) => m.index),
        metrics,
      ),
    [cards, searchMatches, metrics],
  );
  const effectiveCards = useMemo(
    () =>
      clusterPositions.size
        ? cards.map((c, i) => {
            const p = clusterPositions.get(i);
            return p ? { ...c, x: p.x, y: p.y } : c;
          })
        : cards,
    [cards, clusterPositions],
  );
  effectiveCardsRef.current = effectiveCards;
  const spatial = useMemo(() => buildSpatialIndex(effectiveCards, metrics), [effectiveCards, metrics]);
  const spatialRef = useRef(spatial);
  spatialRef.current = spatial;

  const panRef = useRef({
    x: (metrics.tileWidth - (typeof window !== 'undefined' ? window.innerWidth : 1280)) / 2,
    y: (metrics.tileHeight - (typeof window !== 'undefined' ? window.innerHeight : 800)) / 2,
  });
  const frameBusRef = useRef<FrameBus>({
    x: panRef.current.x,
    y: panRef.current.y,
    zoom: 1,
    vw: typeof window !== 'undefined' ? window.innerWidth : 1280,
    vh: typeof window !== 'undefined' ? window.innerHeight : 800,
  });

  const registerEl = useCallback((id: number, el: HTMLElement | null) => {
    if (el) {
      cardEls.current.set(id, el);
      registerProximity(el);
    } else {
      cardEls.current.delete(id);
      unregisterProximity(el);
    }
  }, []);

  const handleHoverChange = useCallback(
    (id: number, hovered: boolean) => {
      // 右键菜单打开时保留卡片悬浮态，避免菜单抢占指针导致卡片“收回”
      if (!hovered && contextMenuRef.current) return;
      setHoveredId(hovered ? id : null);
    },
    [contextMenuRef],
  );

  const handleFrame = useCallback((frame: PanFrame) => {
    panRef.current = { x: frame.x, y: frame.y };
    frameBusRef.current.x = frame.x;
    frameBusRef.current.y = frame.y;
    frameBusRef.current.zoom = frame.zoom;
    frameBusRef.current.vw = frame.vw;
    frameBusRef.current.vh = frame.vh;
    const cardsNow = effectiveCardsRef.current;
    const spatialNow = spatialRef.current;
    const metricsNow = metricsRef.current;
    const ids = queryVisibleIds(cardsNow, spatialNow, frame, CULL_BUFFER, metricsNow).filter(
      (id) => id < revealedRef.current,
    );
    const maxDist = Math.hypot(frame.vw, frame.vh) / 2;
    const spawnSet = spawnFromCenterRef.current;

    const cur = visibleRef.current;
    let changed = ids.length !== cur.size;
    if (!changed) {
      for (const id of ids) {
        if (!cur.has(id)) {
          changed = true;
          break;
        }
      }
    }
    if (changed) {
      visibleRef.current = new Set(ids);
      setVisibleIds(ids);
    }

    for (const id of ids) {
      const el = cardEls.current.get(id);
      if (!el) continue;
      const card = cardsNow[id];
      if (!card) continue;
      const pos = cardScreenPos(
        card,
        panRef.current,
        metricsNow.tileWidth,
        metricsNow.tileHeight,
        frame.vw,
        frame.vh,
        CULL_BUFFER,
        frame.zoom,
      );
      if (!pos) {
        el.classList.add('is-offscreen');
        continue;
      }
      el.classList.remove('is-offscreen');
      if (spawnSet?.has(id)) {
        el.style.setProperty('--x', `${frame.vw / 2 - CARD_WIDTH / 2}px`);
        el.style.setProperty('--y', `${frame.vh / 2 - CARD_HEIGHT / 2}px`);
        el.style.setProperty('--scale', '0.9');
        el.style.setProperty('--blur', '0px');
        el.style.setProperty('--brightness', '1');
        el.style.zIndex = '1';
        spawnSet.delete(id);
        continue;
      }
      el.style.setProperty('--x', `${pos.x}px`);
      el.style.setProperty('--y', `${pos.y}px`);
      el.style.setProperty('--scale', String(Math.min(3.4, fisheyeScale(pos.dist, maxDist) * frame.zoom)));
      el.style.setProperty('--blur', `${fisheyeBlur(pos.dist)}px`);
      el.style.setProperty('--brightness', String(fisheyeBrightness(pos.dist)));
      el.style.zIndex = String(fisheyeZIndex(pos.dist, maxDist));
    }
  }, []);

  // PanController 生命周期 + __nebula 调试口
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;

    const controller = new PanController(stage, {
      tileWidth: metrics.tileWidth,
      tileHeight: metrics.tileHeight,
      initialX: (metrics.tileWidth - window.innerWidth) / 2,
      initialY: (metrics.tileHeight - window.innerHeight) / 2,
      onFrame: handleFrame,
      onPanStart: () => setHoveredId(null),
    });
    controllerRef.current = controller;
    controller.start();

    window.__nebula = {
      reset: () => controller.reset(),
      pan: () => ({ x: controller.pan.x, y: controller.pan.y }),
      total: songs.length,
      visible: () => cardEls.current.size,
      revealed: () => revealedRef.current,
      player: audioPlayer,
      songsData: () => songsRef.current,
      setSongAudio: (id: number, url: string) => {
        libraryService.applyImported(
          songsRef.current.map((s, i) => (i === id ? { ...s, audio: url } : s)),
        );
      },
      search: (q: string) => {
        const m = matchSongs(q, songsRef.current);
        if (!m.length) return;
        applySearch(m, m[0]!.index);
      },
      zoom: () => controllerRef.current?.zoom ?? 1,
    };

    return () => {
      controller.dispose();
      controllerRef.current = null;
      window.__nebula = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics, handleFrame, songs.length, applySearch]);

  // 播放器失败事件 → 卡片置灰
  useEffect(
    () =>
      audioPlayer.subscribe(() => {
        const s = audioPlayer.getState();
        if (s.failed && s.song && lastFailedSongRef.current !== s.song.id) {
          lastFailedSongRef.current = s.song.id;
          setFailedIds((prev) => (prev.has(s.song!.id) ? prev : new Set(prev).add(s.song!.id)));
        }
      }),
    [],
  );

  useEffect(
    () => () => {
      if (revealTimerRef.current !== null) window.clearInterval(revealTimerRef.current);
    },
    [],
  );

  useEffect(() => initGlassGlow(), []);

  // 会话记忆恢复：上次导入歌单 + 上次播放歌曲（只跑一次）
  useEffect(() => {
    try {
      const raw = localStorage.getItem('music-nebula.session');
      if (!raw) return;
      const s = JSON.parse(raw) as { tracks?: DesktopTrack[]; currentId?: number };
      if (!s.tracks?.length) return;
      const restored = s.tracks.map((t, i) => toFrontendTrack(t, i));
      libraryService.restoreSongs(restored);
      setRevealedCount(restored.length);
      revealedRef.current = restored.length;
      visibleRef.current = new Set();
      setVisibleIds([]);
      const cur = restored.find((t) => t.id === s.currentId) ?? restored[0]!;
      audioPlayer.restore(cur, restored);
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 渐进式生成：每 100ms 揭示一批卡片，总时长约 4 秒。 */
  const startProgressiveReveal = useCallback((total: number, onDone?: () => void) => {
    if (revealTimerRef.current !== null) window.clearInterval(revealTimerRef.current);
    revealedRef.current = 0;
    setRevealedCount(0);
    const batch = Math.max(1, Math.ceil(total / 40));
    const timer = window.setInterval(() => {
      revealedRef.current = Math.min(total, revealedRef.current + batch);
      setRevealedCount(revealedRef.current);
      controllerRef.current?.refresh();
      if (revealedRef.current >= total) {
        window.clearInterval(timer);
        revealTimerRef.current = null;
        onDone?.();
      }
    }, 100);
    revealTimerRef.current = timer;
  }, []);

  /** 统一入口：把解析好的歌曲集合交给星云（渐进生成）。 */
  const beginImport = useCallback(
    (adapterName: string, tracks: Track[], simulated = false, note?: string) => {
      visibleRef.current = new Set();
      setVisibleIds([]);
      libraryService.applyImported(tracks);
      setImporting(true);
      spawnFromCenterRef.current = new Set(tracks.map((_, i) => i));
      startProgressiveReveal(tracks.length, () => {
        setImporting(false);
        spawnFromCenterRef.current = null;
        completeImport(
          simulated ? 'warn' : 'done',
          simulated ? `已导入 ${tracks.length} 首（模拟）${note ?? ''}` : `已导入 ${tracks.length} 首（${adapterName}）`,
        );
      });
    },
    [startProgressiveReveal, completeImport],
  );

  const resetImportState = useCallback(() => {
    setHoveredId(null);
    audioPlayer.stop();
    setFailedIds(new Set());
    lastFailedSongRef.current = null;
    setLikedIds(new Set());
  }, []);

  /** 卡片点播：解析（桌面取链）→ 播放 → 打开二级页。 */
  const handleCardPlay = useCallback(async (songId: number) => {
    const song = songsRef.current[songId];
    if (!song) return;
    let target = song;
    if (!target.audio && hasDesktopAPI()) {
      const res = await window.nebulaAPI!.resolveSong(toBackendTrack(target), preferredQuality() || undefined);
      if (res.ok && res.data?.url) {
        target = {
          ...target,
          audio: res.data.url,
          trial: res.data.trial,
          trialEndTime: res.data.trialEndTime,
          quality: res.data.quality,
        };
      }
    }
    audioPlayer.playSong(target, songsRef.current);
    setNowPlayingOpen(true);
  }, [setNowPlayingOpen]);

  /** 回到中心：当前歌曲卡片居中，无则重置视角。 */
  const handleReset = useCallback(() => {
    setHoveredId(null);
    const controller = controllerRef.current;
    const song = audioPlayer.getState().song;
    if (song && controller) {
      const card = effectiveCardsRef.current[song.id];
      if (card) {
        const z = controller.zoom;
        const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
        const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
        controller.animateTo(panForCentering({ x: card.x, y: card.y }, vw, vh, z));
        return;
      }
    }
    controller?.reset();
  }, []);

  const handleToggleLike = useCallback(() => {
    const song = audioPlayer.getState().song;
    if (!song) return;
    setLikedIds((prev) => {
      const next = new Set(prev);
      if (next.has(song.id)) next.delete(song.id);
      else next.add(song.id);
      return next;
    });
  }, []);

  const liked = currentSongId != null && likedIds.has(currentSongId);

  return {
    stageRef,
    frameBusRef,
    panRef,
    importing,
    hoveredId,
    visibleIds,
    failedIds,
    likedIds,
    liked,
    metrics,
    effectiveCards,
    registerEl,
    handleHoverChange,
    handleCardPlay,
    handleReset,
    handleToggleLike,
    beginImport,
    resetImportState,
  };
}
