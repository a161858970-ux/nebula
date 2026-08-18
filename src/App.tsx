import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { BackgroundLayer } from './components/BackgroundLayer';
import type { CoverBgMode } from './components/BackgroundLayer';
import { BottomBar } from './components/BottomBar';
import { MusicCard } from './components/MusicCard';
import { SearchBar } from './components/SearchBar';
import { LyricsLayer, type FrameBus, type LyricVisualSettings } from './components/LyricsLayer';
import { NowPlayingPanel } from './components/NowPlayingPanel';
import { TopBar } from './components/TopBar';
import { AccountDock } from './components/AccountDock';
import { PlaylistDock } from './components/PlaylistDock';
import { WallpaperPicker } from './components/WallpaperPicker';
import { InfoModals } from './components/InfoModals';
import { PanController } from './lib/panEngine';
import type { PanFrame } from './lib/panEngine';
import { audioPlayer } from './lib/audio/AudioPlayer';
import { useAudioPlayer } from './lib/audio/useAudioPlayer';
import { resolvePlaylist } from './lib/playlist/adapters';
import type { ImportStatus } from './components/ImportBar';
import { CARD_HEIGHT, CARD_WIDTH, SEED, cardScreenPos, computeTileSize, generateCards } from './lib/layout';
import { fisheyeBlur, fisheyeBrightness, fisheyeScale, fisheyeZIndex } from './lib/fisheye';
import { buildSpatialIndex, queryVisibleIds } from './lib/spatial';
import { loadBackground, saveBackground } from './lib/backgrounds';
import type { BackgroundSetting } from './lib/backgrounds';
import { DEFAULT_AMBIENT, PRESET_AMBIENT, applyAmbient, sampleMedia } from './lib/bgSampler';
import {
  SILVER_BLUE,
  coverCssVars,
  lyricPaletteCssVars,
  paletteFromBaseColor,
  paletteFromSample,
  sampleCover,
  sampleMediaElement,
  type CoverSample,
  type LyricPalette,
} from './lib/coverColors';
import { initGlassGlow, registerProximity, unregisterProximity } from './lib/glassGlow';
import { filterCreditLines, mergeWordLyrics, type LyricLineUI } from './lib/lyrics';
import { generateTracks } from './lib/catalog';
import type { Track } from './lib/catalog';
import { mulberry32 } from './lib/rng';
import { buildClusterPositions, matchSongs, panForCentering, type SearchMatch } from './lib/search';
import { hasDesktopAPI, toBackendTrack, toFrontendTrack, type DesktopTrack } from './lib/playlist/ipcClient';
import type { DesktopWallpaperItem, DesktopWallpaperSetResult } from './lib/playlist/ipcClient';
import { useAccounts } from './hooks/accounts/useAccounts';

/** 初始曲库量：渲染成本与它无关，仅影响数据生成与空间索引（线性）。 */
const CARD_COUNT = 1000;
/** 视口外挂载缓冲。 */
const CULL_BUFFER = 300;
/** 边缘感应热点宽度。 */
const EDGE_HOTSPOT = 16;
/** 移出面板后的收起延迟（防抖）。 */
const EDGE_HIDE_DELAY = 300;

declare global {
  interface Window {
    __nebula?: {
      reset: () => void;
      pan: () => { x: number; y: number };
      total: number;
      visible: () => number;
      revealed: () => number;
      player: typeof audioPlayer;
      songsData: () => Track[];
      setSongAudio: (id: number, url: string) => void;
      search: (q: string) => void;
      zoom: () => number;
    };
  }
}

/** 读取用户上次选择的音质档位（localStorage）。 */
function preferredQuality(): string {
  try {
    return localStorage.getItem('music-nebula.quality') ?? '';
  } catch {
    return '';
  }
}

/** 读取布尔型 UI 设置（localStorage 存 '1' / '0'）。 */
function loadUiBool(key: string): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

/** 后端歌词结果（unknown）防御性归一化。 */
function normalizeLyricLines(data: unknown, title?: string, artist?: string): LyricLineUI[] {
  if (!data || typeof data !== 'object') return [];
  const lines = (data as { lines?: unknown }).lines;
  if (!Array.isArray(lines)) return [];
  const out: LyricLineUI[] = [];
  for (const raw of lines) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as { timeMs?: unknown; text?: unknown; translation?: unknown };
    if (typeof r.timeMs !== 'number' || typeof r.text !== 'string') continue;
    out.push({
      timeMs: r.timeMs,
      text: r.text,
      translation: typeof r.translation === 'string' && r.translation ? r.translation : undefined,
    });
  }
  if (!out.length) return out;
  // 逐字歌词：yrc 优先，QQ 的 qrc 直接映射进 yrc 统一解析
  const src = data as { yrc?: unknown; qrc?: unknown };
  const yrc = typeof src.yrc === 'string' ? src.yrc : '';
  const qrc = typeof src.qrc === 'string' ? src.qrc : '';
  return filterCreditLines(mergeWordLyrics(out, yrc || qrc), title, artist);
}

type EdgeKey = 'top' | 'right' | 'left';

export default function App() {
  const isWallpaperView =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('view') === 'wallpaper';
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [visibleIds, setVisibleIds] = useState<number[]>([]);
  const [songs, setSongs] = useState<Track[]>(() => generateTracks(mulberry32(SEED), CARD_COUNT));
  const [revealedCount, setRevealedCount] = useState(() => songs.length);
  const [failedIds, setFailedIds] = useState<ReadonlySet<number>>(new Set());
  const [likedIds, setLikedIds] = useState<ReadonlySet<number>>(new Set());
  const [importStatus, setImportStatus] = useState<ImportStatus>('idle');
  const [importMessage, setImportMessage] = useState('');
  const [importing, setImporting] = useState(false);
  const [bgSetting, setBgSetting] = useState<BackgroundSetting>(() => loadBackground());
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const [lyricTranslate, setLyricTranslate] = useState(
    () => typeof localStorage === 'undefined' || localStorage.getItem('music-nebula.lyric-translate') !== '0',
  );
  const [lyricSettings, setLyricSettings] = useState<LyricVisualSettings>(() => {
    const maxFont = Math.max(28, Math.round((typeof window !== 'undefined' ? window.innerHeight : 900) / 4));
    let fontSize = 24;
    let highlightStyle: LyricVisualSettings['highlightStyle'] = 'sweep';
    let layerMode: LyricVisualSettings['layerMode'] = 'under';
    let currentScale = 1.22;
    let wordRise = 4;
    let lyricLayout: LyricVisualSettings['lyricLayout'] = 'stacked';
    let lyricColorSource: LyricVisualSettings['lyricColorSource'] = 'cover';
    let customColor = '#3aa0ff';
    let bold = false;
    try {
      const s = typeof localStorage !== 'undefined' ? localStorage.getItem('music-nebula.lyric-settings') : null;
      if (s) {
        const p = JSON.parse(s) as Partial<LyricVisualSettings>;
        if (typeof p.fontSize === 'number' && p.fontSize >= 14 && p.fontSize <= maxFont) fontSize = p.fontSize;
        if (p.highlightStyle === 'sweep' || p.highlightStyle === 'float') highlightStyle = p.highlightStyle;
        if (p.layerMode === 'under' || p.layerMode === 'over') layerMode = p.layerMode;
        if (typeof p.currentScale === 'number' && p.currentScale >= 1 && p.currentScale <= 1.6) currentScale = p.currentScale;
        if (typeof p.wordRise === 'number' && p.wordRise >= 0 && p.wordRise <= 12) wordRise = p.wordRise;
        if (p.lyricLayout === 'stacked' || p.lyricLayout === 'offset') lyricLayout = p.lyricLayout;
        if (p.lyricColorSource === 'cover' || p.lyricColorSource === 'custom') lyricColorSource = p.lyricColorSource;
        if (typeof p.customColor === 'string' && /^#?[0-9a-f]{6}$/i.test(p.customColor)) customColor = p.customColor;
        if (p.bold === true) bold = true;
      }
    } catch {
      /* 用默认值 */
    }
    return {
      fontSize,
      highlightStyle,
      layerMode,
      currentScale,
      wordRise,
      lyricLayout,
      lyricColorSource,
      customColor,
      bold,
    };
  });
  const [lyricLines, setLyricLines] = useState<LyricLineUI[]>([]);
  const [uiHideCards, setUiHideCards] = useState<boolean>(() => loadUiBool('music-nebula.ui-hide-cards'));
  const [uiHideLyrics, setUiHideLyrics] = useState<boolean>(() => loadUiBool('music-nebula.ui-hide-lyrics'));
  const [bgCoverMode, setBgCoverMode] = useState<CoverBgMode>(() => {
    const m = typeof localStorage !== 'undefined' ? localStorage.getItem('music-nebula.bg-cover-mode') : null;
    if (m === 'fill' || m === 'frosted' || m === 'color' || m === 'palette' || m === 'blend' || m === 'prism') {
      return m;
    }
    if (m === 'cinematic') return 'blend';
    return 'blend';
  });

  // ---------- 多平台账号状态（领域 hook：useAccounts） ----------
  const {
    platforms,
    accounts,
    loginNonce,
    drawerPlatform,
    refreshAccount,
    setDrawerPlatform,
    requestLogin,
  } = useAccounts();
  const [localBusy, setLocalBusy] = useState(false);
  const [wallpaperOpen, setWallpaperOpen] = useState(false);
  const [currentPlaylist, setCurrentPlaylist] = useState<{
    platform: string;
    id: string;
    name: string;
    cover: string;
  } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; track: Track } | null>(null);
  const contextMenuRef = useRef(contextMenu);
  contextMenuRef.current = contextMenu;
  const [infoModal, setInfoModal] = useState<{
    kind: 'comments' | 'song' | 'artist';
    track?: Track;
    platform?: string;
    artistId?: string;
    artistName?: string;
  } | null>(null);
  const [modeToast, setModeToast] = useState('');

  // ---------- 边缘感应面板 ----------
  const [edge, setEdge] = useState<Record<EdgeKey, boolean>>({ top: false, right: false, left: false });
  const edgeHoverRef = useRef<Record<EdgeKey, boolean>>({ top: false, right: false, left: false });
  const edgeTimerRef = useRef<Record<EdgeKey, number>>({ top: 0, right: 0, left: 0 });

  const playerState = useAudioPlayer();

  const cards = useMemo(() => generateCards(mulberry32(SEED), songs), [songs]);
  const metrics = useMemo(() => computeTileSize(songs.length), [songs.length]);
  const clusterPositions = useMemo(
    () =>
      buildClusterPositions(
        cards,
        searchMatches.map((m) => m.index),
        metrics,
      ),
    [cards, searchMatches, metrics],
  );
  /** 有效布局：命中卡片替换为簇团位置，其余保持原随机分布（形成“让位包围”）。 */
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
  const spatial = useMemo(() => buildSpatialIndex(effectiveCards, metrics), [effectiveCards, metrics]);

  const stageRef = useRef<HTMLDivElement>(null);
  const cardEls = useRef(new Map<number, HTMLElement>());
  const controllerRef = useRef<PanController | null>(null);
  const visibleRef = useRef(new Set<number>());
  const revealedRef = useRef(revealedCount);
  const songsRef = useRef(songs);
  songsRef.current = songs;
  const searchMatchesRef = useRef(searchMatches);
  searchMatchesRef.current = searchMatches;
  const effectiveCardsRef = useRef(effectiveCards);
  effectiveCardsRef.current = effectiveCards;
  const spatialRef = useRef(spatial);
  spatialRef.current = spatial;
  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;
  const revealTimerRef = useRef<number | null>(null);
  const spawnFromCenterRef = useRef<Set<number> | null>(null);
  const lastFailedSongRef = useRef<number | null>(null);
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

  const handleHoverChange = useCallback((id: number, hovered: boolean) => {
    // 右键菜单打开时保留卡片悬浮态，避免菜单抢占指针导致卡片“收回”
    if (!hovered && contextMenuRef.current) return;
    setHoveredId(hovered ? id : null);
  }, []);

  const handleFrame = useCallback(
    (frame: PanFrame) => {
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
    },
    [],
  );

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
        setSongs((prev) => prev.map((s, i) => (i === id ? { ...s, audio: url } : s)));
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
  }, [metrics, handleFrame, songs.length]);

  /** 供 __nebula.search 与 SearchBar 共用：重排簇团 + 视角定位。 */
  const applySearch = useCallback((matches: SearchMatch[], focusIndex: number | null) => {
    setSearchMatches(matches);
    const controller = controllerRef.current;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    if (!controller) return;
    const cluster = buildClusterPositions(
      effectiveCardsRef.current,
      matches.map((m) => m.index),
      metricsRef.current,
    );
    const focus = focusIndex != null ? cluster.get(focusIndex) ?? effectiveCardsRef.current[focusIndex] : null;
    if (!focus) return;
    controller.animateTo(panForCentering({ x: focus.x, y: focus.y }, vw, vh, controller.zoom));
  }, []);

  const handleSearchPick = useCallback(
    (match: SearchMatch) => {
      applySearch(searchMatchesRef.current.length ? searchMatchesRef.current : [match], match.index);
    },
    [applySearch],
  );

  const handleSearchAll = useCallback(
    (matches: SearchMatch[]) => {
      applySearch(matches, matches[0]?.index ?? null);
    },
    [applySearch],
  );

  const handleSearchQueryChange = useCallback((matches: SearchMatch[]) => {
    setSearchMatches(matches);
  }, []);

  /** 全网搜索点播：仅播放该曲，不影响当前队列；播完自动接回歌单（playTransient）。 */
  const handlePlayNetworkSong = useCallback((track: Track) => {
    audioPlayer.playTransient(track);
  }, []);

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

  // ---------- 边缘感应：热点触发 + 移出防抖 ----------
  const showPanel = useCallback((k: EdgeKey) => {
    if (edgeTimerRef.current[k]) {
      window.clearTimeout(edgeTimerRef.current[k]);
      edgeTimerRef.current[k] = 0;
    }
    setEdge((prev) => (prev[k] ? prev : { ...prev, [k]: true }));
  }, []);

  const scheduleHidePanel = useCallback((k: EdgeKey) => {
    if (contextMenuRef.current) return;
    // 搜索框聚焦期间不收回顶部面板（输入法弹出/打字）
    if (k === 'top') {
      const active = document.activeElement as HTMLElement | null;
      if (active?.closest?.('.topbar')) return;
    }
    if (edgeHoverRef.current[k] || edgeTimerRef.current[k]) return;
    edgeTimerRef.current[k] = window.setTimeout(() => {
      edgeTimerRef.current[k] = 0;
      setEdge((prev) => (prev[k] ? { ...prev, [k]: false } : prev));
    }, EDGE_HIDE_DELAY);
  }, []);

  const enterPanel = useCallback(
    (k: EdgeKey) => {
      edgeHoverRef.current[k] = true;
      showPanel(k);
    },
    [showPanel],
  );

  const leavePanel = useCallback(
    (k: EdgeKey) => {
      edgeHoverRef.current[k] = false;
      scheduleHidePanel(k);
    },
    [scheduleHidePanel],
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (contextMenuRef.current) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('.edge-panel') || t?.closest('.dock')) return;
      const x = e.clientX;
      const y = e.clientY;
      if (y <= EDGE_HOTSPOT) showPanel('top');
      else scheduleHidePanel('top');
      if (x >= window.innerWidth - EDGE_HOTSPOT) showPanel('right');
      else scheduleHidePanel('right');
      if (x <= EDGE_HOTSPOT) showPanel('left');
      else scheduleHidePanel('left');
    };
    document.addEventListener('pointermove', onMove);
    return () => document.removeEventListener('pointermove', onMove);
  }, [showPanel, scheduleHidePanel]);

  // 背景像素采样 → 全局光照 / 歌词 / 玻璃高光配色
  const currentCover = playerState.song?.cover ?? '';
  useEffect(() => {
    if (bgSetting.type === 'preset') {
      applyAmbient(PRESET_AMBIENT[bgSetting.id] ?? DEFAULT_AMBIENT);
      return;
    }
    const media = document.querySelector<HTMLImageElement | HTMLVideoElement>('.bg-media');
    if (!media) {
      applyAmbient(DEFAULT_AMBIENT);
      return;
    }
    const trySample = () => {
      const s = sampleMedia(media);
      if (s) applyAmbient(s);
    };
    const onLoad = () => trySample();
    media.addEventListener('load', onLoad);
    if ((media as HTMLImageElement).complete || (media as HTMLVideoElement).readyState >= 1) trySample();
    let iv = 0;
    if (media.tagName === 'VIDEO') iv = window.setInterval(trySample, 3000);
    return () => {
      media.removeEventListener('load', onLoad);
      if (iv) window.clearInterval(iv);
    };
  }, [bgSetting, currentCover]);

  // 歌词赋色：跟随当前背景（封面/自定义上传/Wallpaper）自动取色，或自定义基色
  useEffect(() => {
    let cancelled = false;
    const apply = (palette: LyricPalette, sample: CoverSample | null): void => {
      const root = document.documentElement;
      const vars = { ...lyricPaletteCssVars(palette), ...coverCssVars(sample) };
      for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    };
    if (lyricSettings.lyricColorSource === 'custom') {
      apply(paletteFromBaseColor(lyricSettings.customColor), null);
      return;
    }
    const media = document.querySelector<HTMLImageElement | HTMLVideoElement>('.bg-media');
    const trySample = (): void => {
      if (cancelled) return;
      if (
        media &&
        (media instanceof HTMLImageElement
          ? media.complete && media.naturalWidth > 0
          : media.readyState >= 1)
      ) {
        sampleMediaElement(media)
          .then((s) => {
            if (!cancelled) apply(s ? paletteFromSample(s) : SILVER_BLUE, s);
          })
          .catch(() => {
            if (!cancelled) apply(SILVER_BLUE, null);
          });
      } else {
        apply(SILVER_BLUE, null);
      }
    };
    if (!media) {
      const src = playerState.song?.cover;
      if (!src) {
        apply(SILVER_BLUE, null);
      } else {
        sampleCover(src)
          .then((s) => {
            if (!cancelled) apply(s ? paletteFromSample(s) : SILVER_BLUE, s);
          })
          .catch(() => {
            if (!cancelled) apply(SILVER_BLUE, null);
          });
      }
    } else {
      trySample();
      media.addEventListener('load', trySample);
      media.addEventListener('loadeddata', trySample);
      return () => {
        cancelled = true;
        media.removeEventListener('load', trySample);
        media.removeEventListener('loadeddata', trySample);
      };
    }
    return () => {
      cancelled = true;
    };
  }, [bgSetting, playerState.song?.cover, lyricSettings.lyricColorSource, lyricSettings.customColor]);

  // 壁纸子窗口应用结果 → 主窗口设置背景
  useEffect(() => {
    if (!hasDesktopAPI() || isWallpaperView) return;
    const off = window.nebulaAPI!.onWallpaperApplied((data) => {
      if ('url' in data) {
        setBgSetting({ type: data.type, url: data.url });
        setWallpaperOpen(false);
      }
    });
    return off;
  }, [isWallpaperView]);

  // 歌词加载：随当前歌曲变化拉取
  useEffect(() => {
    const song = playerState.song;
    if (!song) {
      setLyricLines([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      if (!hasDesktopAPI() || !song.sourceId) {
        setLyricLines([]);
        return;
      }
      try {
        const res = await window.nebulaAPI!.fetchLyric(toBackendTrack(song));
        if (cancelled) return;
        const lines = normalizeLyricLines(res.ok ? res.data : null, song.title, song.artist);
        setLyricLines(lines);
      } catch {
        if (!cancelled) setLyricLines([]);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [playerState.song?.id, playerState.song?.sourceId]);

  // 会话记忆：导入歌单 + 当前播放歌曲（退出后重开自动恢复）
  useEffect(() => {
    try {
      if (!songs.length || songs[0]?.source === 'demo') return;
      localStorage.setItem(
        'music-nebula.session',
        JSON.stringify({
          tracks: songs.map((s) => toBackendTrack(s)),
          currentId: playerState.song?.id,
        }),
      );
    } catch {
      /* ignore */
    }
  }, [songs, playerState.song?.id]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('music-nebula.session');
      if (!raw) return;
      const s = JSON.parse(raw) as { tracks?: DesktopTrack[]; currentId?: number };
      if (!s.tracks?.length) return;
      const restored = s.tracks.map((t, i) => toFrontendTrack(t, i));
      setSongs(restored);
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

  // 音质档位：随当前歌曲变化拉取可用列表（桌面版）
  useEffect(() => {
    const song = playerState.song;
    if (!song || !hasDesktopAPI() || !song.sourceId) return;
    let cancelled = false;
    window.nebulaAPI!
      .songQualities(toBackendTrack(song))
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.data?.length) {
          audioPlayer.setQualities(res.data);
          if (!preferredQuality()) {
            try {
              localStorage.setItem('music-nebula.quality', res.data[0]!.level);
            } catch {
              /* ignore */
            }
          }
        }
      })
      .catch(() => {
        /* 无音质列表时隐藏切换入口 */
      });
    return () => {
      cancelled = true;
    };
  }, [playerState.song?.id, playerState.song?.sourceId]);

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
    (adapterName: string, songs: Track[], simulated = false, note?: string) => {
      visibleRef.current = new Set();
      setVisibleIds([]);
      setSongs(songs);
      setImporting(true);
      spawnFromCenterRef.current = new Set(songs.map((_, i) => i));
      startProgressiveReveal(songs.length, () => {
        setImporting(false);
        spawnFromCenterRef.current = null;
        setImportStatus(simulated ? 'warn' : 'done');
        setImportMessage(
          simulated
            ? `已导入 ${songs.length} 首（模拟）${note ?? ''}`
            : `已导入 ${songs.length} 首（${adapterName}）`,
        );
      });
    },
    [startProgressiveReveal],
  );

  const resetImportState = useCallback(() => {
    setImportStatus('parsing');
    setImportMessage('');
    setHoveredId(null);
    audioPlayer.stop();
    setFailedIds(new Set());
    lastFailedSongRef.current = null;
    setLikedIds(new Set());
  }, []);

  const handleImport = useCallback(
    async (url: string) => {
      resetImportState();
      try {
        const { adapterName, songs, simulated, note } = await resolvePlaylist(url);
        setCurrentPlaylist({ platform: adapterName, id: 'manual', name: '手动链接导入', cover: '' });
        beginImport(adapterName, songs, simulated, note);
      } catch (err) {
        setImportStatus('error');
        setImportMessage(`歌单解析失败：${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [beginImport, resetImportState],
  );

  /** 登录面板“我的歌单”点击导入。 */
  const handleImportByPlatform = useCallback(
    async (platform: string, id: string) => {
      if (!hasDesktopAPI()) return;
      resetImportState();
      try {
        const res = await window.nebulaAPI!.importPlaylistId(platform, id);
        if (!res.ok) throw new Error(res.error);
        setCurrentPlaylist({ platform: res.data.platformName, id, name: res.data.name, cover: res.data.cover });
        beginImport(res.data.platformName, res.data.tracks.map((t, i) => toFrontendTrack(t, i)));
      } catch (err) {
        setImportStatus('error');
        setImportMessage(`歌单导入失败：${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [beginImport, resetImportState],
  );

  /** 本地音乐：原生文件夹选择器 → 主进程解析 ID3 → 星云卡片。 */
  const handleOpenLocal = useCallback(async () => {
    if (!hasDesktopAPI()) return;
    setLocalBusy(true);
    try {
      const res = await window.nebulaAPI!.openLocalDirectory();
      if (res.ok && res.data?.tracks?.length) {
        resetImportState();
        beginImport('本地音乐', res.data.tracks.map((t, i) => toFrontendTrack(t, i)));
      } else if (res.ok) {
        setImportStatus('warn');
        setImportMessage('所选文件夹未发现可导入的音频文件');
      } else {
        setImportStatus('error');
        setImportMessage(res.error);
      }
    } catch (err) {
      setImportStatus('error');
      setImportMessage(`本地音乐导入失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setLocalBusy(false);
    }
  }, [beginImport, resetImportState]);

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
  }, []);

  /** 统一快速解析：主平台取链（内部含兜底）优先；同一 URL 不重试。 */
  const resolveTrackForPlay = useCallback(
    async (track: Track, _reason: 'empty' | 'error'): Promise<Track | null> => {
      if (!hasDesktopAPI()) return null;
      try {
        const res = await window.nebulaAPI!.resolveSong(toBackendTrack(track), preferredQuality() || undefined);
        if (res.ok && res.data?.url && res.data.url !== track.audio) {
          return toFrontendTrack(
            { ...toBackendTrack(track), originalUrl: res.data.url },
            track.id,
            { trial: res.data.trial, trialEndTime: res.data.trialEndTime, quality: res.data.quality },
          );
        }
        const fb = await window.nebulaAPI!.fallbackSong(toBackendTrack(track));
        if (fb.ok && fb.data) return toFrontendTrack(fb.data, track.id);
      } catch {
        /* 忽略，走跳歌 */
      }
      return null;
    },
    [],
  );

  useEffect(() => {
    audioPlayer.retryResolver = resolveTrackForPlay;
    audioPlayer.emptyResolver = resolveTrackForPlay;
  }, [resolveTrackForPlay]);

  const handleQualitySelect = useCallback((level: string) => {
    try {
      localStorage.setItem('music-nebula.quality', level);
    } catch {
      /* ignore */
    }
    const song = audioPlayer.getState().song;
    if (!song || !hasDesktopAPI() || !song.sourceId || song.quality === level) return;
    window.nebulaAPI!
      .resolveSong(toBackendTrack(song), level)
      .then((res) => {
        if (res.ok && res.data?.url) {
          audioPlayer.switchSource(res.data.url, { quality: level, keepTime: true });
        } else {
          audioPlayer.setError(res.ok ? '该音质暂不可用，已保持当前音质' : res.error);
        }
      })
      .catch(() => audioPlayer.setError('音质切换失败'));
  }, []);

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

  /** 歌单列表：双击播放某首 → 回到该歌曲卡片中心。 */
  const playSongFromList = useCallback(
    (index: number) => {
      const song = songsRef.current[index];
      if (!song) return;
      audioPlayer.playSong(song, songsRef.current);
      setNowPlayingOpen(false);
      handleReset();
    },
    [handleReset],
  );

  const playPlaylistFromStart = useCallback(() => {
    const list = songsRef.current;
    if (!list.length) return;
    audioPlayer.playSong(list[0]!, list);
    setNowPlayingOpen(false);
    handleReset();
  }, [handleReset]);

  const insertNextSong = useCallback((track: Track) => {
    audioPlayer.insertNext(track);
  }, []);

  const openContextMenu = useCallback((e: MouseEvent, track: Track) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, track });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const openCommentsModal = useCallback(() => {
    const song = audioPlayer.getState().song;
    if (!song) return;
    setInfoModal({ kind: 'comments', track: song });
  }, []);

  const openSongDetailModal = useCallback(() => {
    const song = audioPlayer.getState().song;
    if (!song) return;
    setInfoModal({ kind: 'song', track: song });
  }, []);

  /** 底部条点击歌手名：先取详情拿歌手 id；多个/匹配不到时退回详情页。 */
  const openArtistByName = useCallback((name: string) => {
    const song = audioPlayer.getState().song;
    if (!song || !hasDesktopAPI()) return;
    window.nebulaAPI!
      .songDetail(toBackendTrack(song))
      .then((res) => {
        if (!res.ok || !res.data) {
          setInfoModal({ kind: 'song', track: song });
          return;
        }
        const parts = name.split(/[\/、&,，]/).map((s) => s.trim()).filter(Boolean);
        const match = res.data.artists.filter((a) =>
          parts.some((p) => p === a.name || p.includes(a.name) || a.name.includes(p)),
        );
        if (match.length === 1) {
          setInfoModal({ kind: 'artist', platform: res.data.platform, artistId: match[0]!.id, artistName: match[0]!.name });
        } else {
          setInfoModal({ kind: 'song', track: song });
        }
      })
      .catch(() => setInfoModal({ kind: 'song', track: song }));
  }, []);

  const openArtistFromChip = useCallback((platform: string, artistId: string, name: string) => {
    setInfoModal({ kind: 'artist', platform, artistId, artistName: name });
  }, []);

  const playArtistTrack = useCallback(
    (t: DesktopTrack) => {
      const front = toFrontendTrack(t, songsRef.current.length);
      audioPlayer.playSong(front, [...songsRef.current, front]);
      setNowPlayingOpen(false);
      handleReset();
    },
    [handleReset],
  );

  const cycleModeWithToast = useCallback(() => {
    audioPlayer.cycleMode();
    const m = audioPlayer.getState().mode;
    const label = m === 'sequential' ? '顺序播放' : m === 'repeat-one' ? '单曲循环' : '随机播放';
    setModeToast(label);
    window.setTimeout(() => setModeToast(''), 1800);
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

  const handleSelectBg = useCallback((s: BackgroundSetting) => {
    setBgSetting(s);
    saveBackground(s);
  }, []);

  const handleToggleTranslate = useCallback(() => {
    setLyricTranslate((v) => {
      const next = !v;
      try {
        localStorage.setItem('music-nebula.lyric-translate', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const persistLyricSettings = useCallback((next: LyricVisualSettings) => {
    setLyricSettings(next);
    try {
      localStorage.setItem('music-nebula.lyric-settings', JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const handleLyricFontSize = useCallback(
    (n: number) => persistLyricSettings({ ...lyricSettings, fontSize: n }),
    [lyricSettings, persistLyricSettings],
  );
  const handleHighlightStyle = useCallback(
    (s: LyricVisualSettings['highlightStyle']) => persistLyricSettings({ ...lyricSettings, highlightStyle: s }),
    [lyricSettings, persistLyricSettings],
  );
  const handleLayerMode = useCallback(
    (m: LyricVisualSettings['layerMode']) => persistLyricSettings({ ...lyricSettings, layerMode: m }),
    [lyricSettings, persistLyricSettings],
  );
  const handleCurrentScale = useCallback(
    (n: number) => persistLyricSettings({ ...lyricSettings, currentScale: n }),
    [lyricSettings, persistLyricSettings],
  );
  const handleWordRise = useCallback(
    (n: number) => persistLyricSettings({ ...lyricSettings, wordRise: n }),
    [lyricSettings, persistLyricSettings],
  );
  const handleLyricLayout = useCallback(
    (m: LyricVisualSettings['lyricLayout']) => persistLyricSettings({ ...lyricSettings, lyricLayout: m }),
    [lyricSettings, persistLyricSettings],
  );
  const handleLyricColorSource = useCallback(
    (s: LyricVisualSettings['lyricColorSource']) => persistLyricSettings({ ...lyricSettings, lyricColorSource: s }),
    [lyricSettings, persistLyricSettings],
  );
  const handleCustomColor = useCallback(
    (c: string) => persistLyricSettings({ ...lyricSettings, customColor: c }),
    [lyricSettings, persistLyricSettings],
  );
  const handleLyricBold = useCallback(
    (b: boolean) => persistLyricSettings({ ...lyricSettings, bold: b }),
    [lyricSettings, persistLyricSettings],
  );
  const toggleHideCards = useCallback(() => {
    setUiHideCards((v) => {
      const next = !v;
      try {
        localStorage.setItem('music-nebula.ui-hide-cards', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  const toggleHideLyrics = useCallback(() => {
    setUiHideLyrics((v) => {
      const next = !v;
      try {
        localStorage.setItem('music-nebula.ui-hide-lyrics', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);
  const handleCoverMode = useCallback((m: CoverBgMode) => {
    setBgCoverMode(m);
    try {
      localStorage.setItem('music-nebula.bg-cover-mode', m);
    } catch {
      /* ignore */
    }
  }, []);

  const handleWallpaperApply = useCallback(
    (_item: DesktopWallpaperItem, result: DesktopWallpaperSetResult) => {
      if (!('url' in result) || !('type' in result)) {
        setWallpaperOpen(false);
        return;
      }
      setBgSetting({ type: result.type, url: result.url });
      setWallpaperOpen(false);
    },
    [],
  );

  const handleBgFile = useCallback((file: File) => {
    if (file.type.startsWith('video/')) {
      setBgSetting({ type: 'video', url: URL.createObjectURL(file) });
      return;
    }
    if (file.size <= 2.5 * 1024 * 1024) {
      const reader = new FileReader();
      reader.onload = () => {
        const url = String(reader.result);
        setBgSetting({ type: 'image', url });
        saveBackground({ type: 'image', url });
      };
      reader.readAsDataURL(file);
    } else {
      setBgSetting({ type: 'image', url: URL.createObjectURL(file) });
    }
  }, []);

  /** 组合层接线：账号域 requestLogin + 边缘面板 showPanel。 */
  const handleGoLogin = useCallback(
    (platform: string) => {
      requestLogin(platform);
      showPanel('right');
    },
    [requestLogin, showPanel],
  );

  /** 全平台歌单一键刷新：只刷新已登录平台，账号信息与歌单一并重新拉取。 */
  const handleRefreshAll = useCallback(() => {
    const targets = Object.keys(accounts).filter((p) => accounts[p].loggedIn);
    if (!targets.length) return;
    void Promise.all(targets.map((p) => refreshAccount(p))).catch(() => {
      /* 单个平台刷新失败不影响其他平台 */
    });
  }, [accounts, refreshAccount]);

  const currentSongId = playerState.song?.id ?? null;
  const liked = playerState.song ? likedIds.has(playerState.song.id) : false;

  if (isWallpaperView) {
    return (
      <main className="app">
        <WallpaperPicker standalone onClose={() => window.close()} onApply={() => {}} />
      </main>
    );
  }

  const effectiveBgSetting: BackgroundSetting =
    bgSetting.type === 'cover'
      ? playerState.song?.cover
        ? { type: 'image', url: playerState.song.cover }
        : { type: 'preset', id: 'midnight' }
      : bgSetting;

  return (
    <main className="app">
      <BackgroundLayer setting={effectiveBgSetting} coverMode={bgSetting.type === 'cover' ? bgCoverMode : undefined} />

      {!uiHideLyrics && (
        <LyricsLayer
          lines={lyricLines}
          currentTime={playerState.currentTime}
          playing={playerState.playing}
          frameBus={frameBusRef.current}
          settings={lyricSettings}
          songKey={
            playerState.song
              ? `${playerState.song.source}:${playerState.song.sourceId ?? playerState.song.id}`
              : 'none'
          }
          songTitle={playerState.song?.title}
          songArtist={playerState.song?.artist}
        />
      )}

      <div
        ref={stageRef}
        className={`stage-3d${importing ? ' is-importing' : ''}${uiHideCards ? ' is-cards-hidden' : ''}`}
      >
        {visibleIds.map((id) => {
          const card = effectiveCards[id]!;
          if (!card) return null;
          return (
            <MusicCard
              key={card.id}
              card={card}
              metrics={metrics}
              buffer={CULL_BUFFER}
              pan={panRef.current}
              zoom={frameBusRef.current.zoom}
              hovered={card.id === hoveredId}
              isCurrent={card.track.id === currentSongId}
              isFailed={failedIds.has(card.track.id)}
              onPlay={handleCardPlay}
              onContextMenu={openContextMenu}
              onHoverChange={handleHoverChange}
              registerEl={registerEl}
            />
          );
        })}
      </div>

      <TopBar
        visible={edge.top}
        total={songs.length}
        localBusy={localBusy}
        searchSlot={
          <SearchBar
            songs={songs}
            onPick={handleSearchPick}
            onSearchAll={handleSearchAll}
            onQueryChange={handleSearchQueryChange}
            onPlayNetworkSong={handlePlayNetworkSong}
            onOpenArtist={openArtistFromChip}
          />
        }
        onEnter={() => enterPanel('top')}
        onLeave={() => leavePanel('top')}
        onOpenLocal={handleOpenLocal}
      />

      <AccountDock
        visible={edge.right}
        selectedPlatform={drawerPlatform}
        loginNonce={loginNonce}
        platforms={platforms}
        accounts={accounts}
        bgSetting={bgSetting}
        coverMode={bgCoverMode}
        lyricSettings={lyricSettings}
        uiHideCards={uiHideCards}
        uiHideLyrics={uiHideLyrics}
        onEnter={() => enterPanel('right')}
        onLeave={() => leavePanel('right')}
        onSelectPlatform={setDrawerPlatform}
        onRefreshAccount={refreshAccount}
        onSelectBg={handleSelectBg}
        onFile={handleBgFile}
        onCoverMode={handleCoverMode}
        onFontSize={handleLyricFontSize}
        onHighlightStyle={handleHighlightStyle}
        onLayerMode={handleLayerMode}
        onCurrentScale={handleCurrentScale}
        onWordRise={handleWordRise}
        onLyricLayout={handleLyricLayout}
        onLyricColorSource={handleLyricColorSource}
        onCustomColor={handleCustomColor}
        onLyricBold={handleLyricBold}
        onToggleHideCards={toggleHideCards}
        onToggleHideLyrics={toggleHideLyrics}
        onOpenWallpapers={() => {
          if (hasDesktopAPI()) void window.nebulaAPI!.wallpaperOpen();
          else setWallpaperOpen(true);
        }}
      />

      <PlaylistDock
        visible={edge.left}
        accounts={accounts}
        importStatus={importStatus}
        importMessage={importMessage}
        onEnter={() => enterPanel('left')}
        onLeave={() => leavePanel('left')}
        onImportPlaylist={handleImportByPlatform}
        onImportUrl={handleImport}
        onGoLogin={handleGoLogin}
        onRefreshAll={handleRefreshAll}
        songs={songs}
        currentPlaylist={currentPlaylist}
        onPlaySongFromList={playSongFromList}
        onPlayPlaylist={playPlaylistFromStart}
        onSongContextMenu={openContextMenu}
      />

      <button className="glass-btn center-btn" onClick={handleReset} aria-label="回到中心">
        ⌖ 回到中心
      </button>

      <BottomBar
        translateOn={lyricTranslate}
        qualities={playerState.qualities}
        quality={playerState.quality || preferredQuality()}
        mode={playerState.mode}
        onToggleTranslate={handleToggleTranslate}
        onSelectQuality={handleQualitySelect}
        onCycleMode={cycleModeWithToast}
        onOpenNowPlaying={() => setNowPlayingOpen(true)}
        onOpenComments={openCommentsModal}
        onOpenSongDetail={openSongDetailModal}
        onOpenArtist={openArtistByName}
      />

      {nowPlayingOpen && playerState.song && (
        <NowPlayingPanel
          song={playerState.song}
          playing={playerState.playing}
          loading={playerState.loading}
          currentTime={playerState.currentTime}
          duration={playerState.duration}
          liked={liked}
          lines={lyricLines}
          translateOn={lyricTranslate}
          onClose={() => setNowPlayingOpen(false)}
          onTogglePlay={() => audioPlayer.toggle()}
          onPrev={() => audioPlayer.prev()}
          onNext={() => audioPlayer.next()}
          onToggleLike={handleToggleLike}
          onToggleTranslate={handleToggleTranslate}
          onSeek={(t) => audioPlayer.seek(t)}
        />
      )}
      {wallpaperOpen && (
        <WallpaperPicker onClose={() => setWallpaperOpen(false)} onApply={handleWallpaperApply} />
      )}
      <InfoModals
        modal={infoModal}
        onClose={() => setInfoModal(null)}
        onOpenArtist={openArtistFromChip}
        onPlayArtistTrack={playArtistTrack}
      />
      {modeToast && <div className="mode-toast">{modeToast}</div>}
      {contextMenu && (
        <>
          <div className="ctx-backdrop" onPointerDown={closeContextMenu} onContextMenu={(e) => e.preventDefault()} />
          <div className="ctx-menu glass" style={{ left: contextMenu.x, top: contextMenu.y }}>
            <button
              onClick={() => {
                insertNextSong(contextMenu.track);
                closeContextMenu();
              }}
            >
              下一首播放
            </button>
            <button onClick={closeContextMenu}>取消</button>
          </div>
        </>
      )}
    </main>
  );
}
