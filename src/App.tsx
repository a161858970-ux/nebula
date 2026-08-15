import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackgroundLayer } from './components/BackgroundLayer';
import type { CoverBgMode } from './components/BackgroundLayer';
import { BottomBar } from './components/BottomBar';
import { MusicCard } from './components/MusicCard';
import { SearchBar } from './components/SearchBar';
import { LyricsLayer, type FrameBus, type LyricVisualSettings } from './components/LyricsLayer';
import { NowPlayingPanel } from './components/NowPlayingPanel';
import { TopBar } from './components/TopBar';
import { AccountsDrawer, type DrawerTab } from './components/AccountsDrawer';
import { PlaylistSidebar } from './components/PlaylistSidebar';
import { WallpaperPicker } from './components/WallpaperPicker';
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
  type CoverSample,
  type LyricPalette,
} from './lib/coverColors';
import { initGlassGlow, registerProximity, unregisterProximity } from './lib/glassGlow';
import { filterCreditLines, mergeWordLyrics, type LyricLineUI } from './lib/lyrics';
import { generateTracks } from './lib/catalog';
import type { Track } from './lib/catalog';
import { mulberry32 } from './lib/rng';
import { buildClusterPositions, matchSongs, panForCentering, type SearchMatch } from './lib/search';
import { hasDesktopAPI, toBackendTrack, toFrontendTrack } from './lib/playlist/ipcClient';
import type { DesktopLoginPlatform, DesktopPlaylistSummary } from './lib/playlist/ipcClient';
import type { DesktopWallpaperItem, DesktopWallpaperSetResult } from './lib/playlist/ipcClient';
import { emptyAccount, type AccountState } from './lib/accounts';

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
    let wordHighlight = true;
    let layerMode: LyricVisualSettings['layerMode'] = 'under';
    let currentScale = 1.22;
    let wordRise = 4;
    let lyricLayout: LyricVisualSettings['lyricLayout'] = 'stacked';
    let lyricColorSource: LyricVisualSettings['lyricColorSource'] = 'cover';
    let customColor = '#3aa0ff';
    try {
      const s = typeof localStorage !== 'undefined' ? localStorage.getItem('music-nebula.lyric-settings') : null;
      if (s) {
        const p = JSON.parse(s) as Partial<LyricVisualSettings>;
        if (typeof p.fontSize === 'number' && p.fontSize >= 14 && p.fontSize <= maxFont) fontSize = p.fontSize;
        if (p.highlightStyle === 'sweep' || p.highlightStyle === 'float') highlightStyle = p.highlightStyle;
        if (typeof p.wordHighlight === 'boolean') wordHighlight = p.wordHighlight;
        if (p.layerMode === 'under' || p.layerMode === 'over') layerMode = p.layerMode;
        if (typeof p.currentScale === 'number' && p.currentScale >= 1 && p.currentScale <= 1.6) currentScale = p.currentScale;
        if (typeof p.wordRise === 'number' && p.wordRise >= 0 && p.wordRise <= 12) wordRise = p.wordRise;
        if (p.lyricLayout === 'stacked' || p.lyricLayout === 'offset') lyricLayout = p.lyricLayout;
        if (p.lyricColorSource === 'cover' || p.lyricColorSource === 'custom') lyricColorSource = p.lyricColorSource;
        if (typeof p.customColor === 'string' && /^#?[0-9a-f]{6}$/i.test(p.customColor)) customColor = p.customColor;
      }
    } catch {
      /* 用默认值 */
    }
    return {
      fontSize,
      highlightStyle,
      wordHighlight,
      layerMode,
      currentScale,
      wordRise,
      lyricLayout,
      lyricColorSource,
      customColor,
    };
  });
  const [lyricLines, setLyricLines] = useState<LyricLineUI[]>([]);
  const [bgCoverMode, setBgCoverMode] = useState<CoverBgMode>(() => {
    const m = typeof localStorage !== 'undefined' ? localStorage.getItem('music-nebula.bg-cover-mode') : null;
    if (m === 'fill' || m === 'frosted' || m === 'color' || m === 'palette' || m === 'blend' || m === 'prism') {
      return m;
    }
    if (m === 'cinematic') return 'blend';
    return 'frosted';
  });

  // ---------- 多平台账号状态（可并行登录） ----------
  const [platforms, setPlatforms] = useState<DesktopLoginPlatform[]>([]);
  const [accounts, setAccounts] = useState<Record<string, AccountState>>({});
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('accounts');
  const [drawerPlatform, setDrawerPlatform] = useState('netease');
  const [localBusy, setLocalBusy] = useState(false);
  const [wallpaperOpen, setWallpaperOpen] = useState(false);

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
      const t = e.target as HTMLElement | null;
      if (t?.closest('.edge-panel')) return;
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

  // ---------- 多平台账号：启动并行探活 ----------
  const refreshAccount = useCallback(async (platform: string) => {
    if (!hasDesktopAPI()) return;
    const api = window.nebulaAPI!;
    setAccounts((prev) => ({
      ...prev,
      [platform]: { ...(prev[platform] ?? emptyAccount(platform)), loading: true },
    }));
    try {
      const acc = await api.loginAccount(platform);
      const loggedIn = !!(acc.ok && acc.data?.loggedIn);
      let playlists: DesktopPlaylistSummary[] = [];
      if (loggedIn) {
        const pl = await api.loginPlaylists(platform);
        if (pl.ok) playlists = pl.data;
      }
      setAccounts((prev) => ({
        ...prev,
        [platform]: {
          platform,
          loggedIn,
          nickname: acc.ok ? acc.data?.nickname : undefined,
          avatarUrl: acc.ok ? acc.data?.avatarUrl : undefined,
          isVip: acc.ok ? acc.data?.isVip : undefined,
          isSvip: acc.ok ? acc.data?.isSvip : undefined,
          playlists,
          loading: false,
        },
      }));
    } catch {
      setAccounts((prev) => ({
        ...prev,
        [platform]: { ...(prev[platform] ?? emptyAccount(platform)), loading: false },
      }));
    }
  }, []);

  useEffect(() => {
    if (!hasDesktopAPI()) return;
    let cancelled = false;
    window.nebulaAPI!
      .loginPlatforms()
      .then((res) => {
        if (!res.ok) return;
        setPlatforms(res.data);
        if (cancelled) return;
        const targets = res.data.filter((p) => p.kind === 'qr' || p.kind === 'oauth');
        return Promise.all(targets.map((p) => refreshAccount(p.platform)));
      })
      .catch(() => {
        /* 探活失败静默 */
      });
    return () => {
      cancelled = true;
    };
  }, [refreshAccount]);

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

  // 歌词赋色：封面自动取色 / 自定义基色 → 写入 CSS 变量（primary/secondary/highlight）
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
    const src = playerState.song?.cover;
    if (!src) {
      apply(SILVER_BLUE, null);
      return;
    }
    sampleCover(src)
      .then((s) => {
        if (cancelled) return;
        apply(s ? paletteFromSample(s) : SILVER_BLUE, s);
      })
      .catch(() => {
        if (!cancelled) apply(SILVER_BLUE, null);
      });
    return () => {
      cancelled = true;
    };
  }, [playerState.song?.cover, lyricSettings.lyricColorSource, lyricSettings.customColor]);

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

  // 音质档位：随当前歌曲变化拉取可用列表（桌面版）
  useEffect(() => {
    const song = playerState.song;
    if (!song || !hasDesktopAPI() || !song.sourceId) return;
    let cancelled = false;
    window.nebulaAPI!
      .songQualities(toBackendTrack(song))
      .then((res) => {
        if (!cancelled && res.ok) audioPlayer.setQualities(res.data ?? []);
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
  const handleWordHighlight = useCallback(
    (b: boolean) => persistLyricSettings({ ...lyricSettings, wordHighlight: b }),
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

  const handleGoLogin = useCallback(
    (platform: string) => {
      setDrawerPlatform(platform);
      setDrawerTab('accounts');
      showPanel('right');
    },
    [showPanel],
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

  const effectiveBgSetting: BackgroundSetting =
    bgSetting.type === 'cover'
      ? playerState.song?.cover
        ? { type: 'image', url: playerState.song.cover }
        : { type: 'preset', id: 'midnight' }
      : bgSetting;

  return (
    <main className="app">
      <BackgroundLayer setting={effectiveBgSetting} coverMode={bgSetting.type === 'cover' ? bgCoverMode : undefined} />

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

      <div ref={stageRef} className={`stage-3d${importing ? ' is-importing' : ''}`}>
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
          />
        }
        onEnter={() => enterPanel('top')}
        onLeave={() => leavePanel('top')}
        onOpenLocal={handleOpenLocal}
      />

      <AccountsDrawer
        visible={edge.right}
        tab={drawerTab}
        selectedPlatform={drawerPlatform}
        platforms={platforms}
        accounts={accounts}
        bgSetting={bgSetting}
        coverMode={bgCoverMode}
        onEnter={() => enterPanel('right')}
        onLeave={() => leavePanel('right')}
        onTabChange={setDrawerTab}
        onSelectPlatform={setDrawerPlatform}
        onRefreshAccount={refreshAccount}
        onSelectBg={handleSelectBg}
        onFile={handleBgFile}
        onCoverMode={handleCoverMode}
        lyricSettings={lyricSettings}
        onFontSize={handleLyricFontSize}
        onHighlightStyle={handleHighlightStyle}
        onWordHighlight={handleWordHighlight}
        onLayerMode={handleLayerMode}
        onCurrentScale={handleCurrentScale}
        onWordRise={handleWordRise}
        onLyricLayout={handleLyricLayout}
        onLyricColorSource={handleLyricColorSource}
        onCustomColor={handleCustomColor}
        onOpenWallpapers={() => setWallpaperOpen(true)}
      />

      <PlaylistSidebar
        visible={edge.left}
        platforms={platforms}
        accounts={accounts}
        importStatus={importStatus}
        importMessage={importMessage}
        onEnter={() => enterPanel('left')}
        onLeave={() => leavePanel('left')}
        onImportPlaylist={handleImportByPlatform}
        onImportUrl={handleImport}
        onGoLogin={handleGoLogin}
        onRefreshAll={handleRefreshAll}
      />

      <button className="glass-btn center-btn" onClick={handleReset} aria-label="回到中心">
        ⌖ 回到中心
      </button>

      <BottomBar
        liked={liked}
        translateOn={lyricTranslate}
        qualities={playerState.qualities}
        quality={playerState.quality || preferredQuality()}
        mode={playerState.mode}
        onToggleLike={handleToggleLike}
        onToggleTranslate={handleToggleTranslate}
        onSelectQuality={handleQualitySelect}
        onCycleMode={() => audioPlayer.cycleMode()}
        onOpenNowPlaying={() => setNowPlayingOpen(true)}
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
    </main>
  );
}
