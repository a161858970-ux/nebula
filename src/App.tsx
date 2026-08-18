import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackgroundLayer } from './components/BackgroundLayer';
import { BottomBar } from './components/BottomBar';
import { MusicCard } from './components/MusicCard';
import { SearchBar } from './components/SearchBar';
import { LyricsLayer, type FrameBus } from './components/LyricsLayer';
import { TopBar } from './components/TopBar';
import { AccountDock } from './components/AccountDock';
import { PlaylistDock } from './components/PlaylistDock';
import { WallpaperPicker } from './components/WallpaperPicker';
import { OverlayStack } from './components/OverlayStack';
import { PanController } from './lib/panEngine';
import type { PanFrame } from './lib/panEngine';
import { audioPlayer } from './lib/audio/AudioPlayer';
import { useAudioPlayer } from './lib/audio/useAudioPlayer';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  SEED,
  cardScreenPos,
  computeTileSize,
  generateCards,
  type CardSpec,
  type LayoutMetrics,
} from './lib/layout';
import { fisheyeBlur, fisheyeBrightness, fisheyeScale, fisheyeZIndex } from './lib/fisheye';
import { buildSpatialIndex, queryVisibleIds } from './lib/spatial';
import type { BackgroundSetting } from './lib/backgrounds';
import {
  SILVER_BLUE,
  coverCssVars,
  lyricPaletteCssVars,
  paletteFromBaseColor,
  type CoverSample,
  type LyricPalette,
} from './lib/coverColors';
import { initGlassGlow, registerProximity, unregisterProximity } from './lib/glassGlow';
import { generateTracks } from './lib/catalog';
import type { Track } from './lib/catalog';
import { mulberry32 } from './lib/rng';
import { buildClusterPositions, matchSongs, panForCentering } from './lib/search';
import { hasDesktopAPI, toBackendTrack, toFrontendTrack, type DesktopTrack } from './lib/playlist/ipcClient';
import type { DesktopWallpaperItem, DesktopWallpaperSetResult } from './lib/playlist/ipcClient';
import { useAccounts } from './hooks/accounts/useAccounts';
import { useLibrary } from './hooks/library/useLibrary';
import { usePlaylist } from './hooks/playlist/usePlaylist';
import { usePlaylistImport, type ImportCommit } from './hooks/playlistImport/usePlaylistImport';
import { useOverlays } from './hooks/overlays/useOverlays';
import { useLyrics } from './hooks/lyrics/useLyrics';
import { useBackground } from './hooks/background/useBackground';
import { useInterfaceSettings } from './hooks/interfaceSettings/useInterfaceSettings';
import { useEdgePanels } from './hooks/edgePanels/useEdgePanels';
import { useSearchCluster } from './hooks/searchCluster/useSearchCluster';
import { libraryService } from './lib/library';

/** 初始曲库量：渲染成本与它无关，仅影响数据生成与空间索引（线性）。 */
const CARD_COUNT = 1000;
/** 视口外挂载缓冲。 */
const CULL_BUFFER = 300;
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

export default function App() {
  const isWallpaperView =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('view') === 'wallpaper';
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [visibleIds, setVisibleIds] = useState<number[]>([]);
  // 曲库初始化：首次挂载用演示数据填充 LibraryService（后续由导入/会话恢复接管）
  useState(() => {
    if (libraryService.getState().songs.length === 0) {
      libraryService.applyImported(generateTracks(mulberry32(SEED), CARD_COUNT));
    }
  });
  const { songs } = useLibrary();
  const [revealedCount, setRevealedCount] = useState(() => songs.length);
  const [failedIds, setFailedIds] = useState<ReadonlySet<number>>(new Set());
  const [likedIds, setLikedIds] = useState<ReadonlySet<number>>(new Set());
  const [importing, setImporting] = useState(false);

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
  // ---------- 歌单/导入领域（组合层接线） ----------
  const playlist = usePlaylist();
  // 转发 ref：打破 TDZ，保持 hook 调用顺序稳定（resetImportState / beginImport 在其后定义）
  const sessionStartRef = useRef<() => void>(() => {});
  const commitRef = useRef<(c: ImportCommit) => void>(() => {});
  const handleImportSessionStart = useCallback(() => sessionStartRef.current(), []);
  const handleImportCommitted = useCallback((c: ImportCommit) => commitRef.current(c), []);
  const importer = usePlaylistImport({
    onSessionStart: handleImportSessionStart,
    onImported: handleImportCommitted,
  });
  const { complete: completeImport } = importer;
  const [wallpaperOpen, setWallpaperOpen] = useState(false);
  // ---------- 浮层领域（useOverlays） ----------
  const overlays = useOverlays();
  const {
    contextMenu,
    contextMenuRef,
    infoModal,
    nowPlayingOpen,
    modeToast,
    openContextMenu,
    closeContextMenu,
    openCommentsModal,
    openSongDetailModal,
    openArtistByName,
    openArtistFromChip,
    playArtistTrack,
    setNowPlayingOpen,
    setModeToast,
    setInfoModal,
  } = overlays;
  // 浮层稳定回调（供 memo 区块与后续领域 hook 使用）
  const openNowPlaying = useCallback(() => setNowPlayingOpen(true), [setNowPlayingOpen]);
  const closeNowPlaying = useCallback(() => setNowPlayingOpen(false), [setNowPlayingOpen]);
  const togglePlay = useCallback(() => audioPlayer.toggle(), []);
  const playPrev = useCallback(() => audioPlayer.prev(), []);
  const playNext = useCallback(() => audioPlayer.next(), []);
  const seekTo = useCallback((t: number) => audioPlayer.seek(t), []);
  const openWallpapers = useCallback(() => {
    if (hasDesktopAPI()) void window.nebulaAPI!.wallpaperOpen();
    else setWallpaperOpen(true);
  }, []);
  const closeWallpaper = useCallback(() => setWallpaperOpen(false), []);
  const closeInfo = useCallback(() => setInfoModal(null), [setInfoModal]);
  // ---------- 歌词领域（useLyrics） ----------
  const lyrics = useLyrics();
  const {
    lyricLines,
    lyricSettings,
    lyricTranslationEnabled,
    handleLyricFontSize,
    handleHighlightStyle,
    handleLayerMode,
    handleCurrentScale,
    handleWordRise,
    handleLyricLayout,
    handleLyricColorSource,
    handleCustomColor,
    handleLyricBold,
    toggleTranslation,
  } = lyrics;

  // ---------- 边缘感应面板（useEdgePanels） ----------
  const edgePanels = useEdgePanels({ contextMenuRef });
  const { edge, showPanel, enterTop, leaveTop, enterRight, leaveRight, enterLeft, leaveLeft } = edgePanels;

  const playerState = useAudioPlayer();

  // ---------- 背景/界面设置领域（useBackground 产出 VisualAtmosphere；useInterfaceSettings） ----------
  const background = useBackground({
    enabled: !isWallpaperView,
    onApplied: closeWallpaper,
    coverKey: playerState.song?.cover ?? '',
  });
  const {
    bgSetting,
    bgCoverMode,
    atmosphere,
    handleSelectBg,
    handleCoverMode,
    applyWallpaperResult,
    handleBgFile,
  } = background;
  const interfaceSettings = useInterfaceSettings();
  const { uiHideCards, uiHideLyrics, toggleHideCards, toggleHideLyrics } = interfaceSettings;

  // ---------- 搜索聚簇（useSearchCluster；stage refs 先声明，值在 memo 后填充） ----------
  const stageRef = useRef<HTMLDivElement>(null);
  const controllerRef = useRef<PanController | null>(null);
  // 值在 memo 后填充；null! 仅为早期声明（运行时 action 时已赋值）
  const metricsRef = useRef<LayoutMetrics>(null!);
  const effectiveCardsRef = useRef<CardSpec[]>(null!);
  const searchCluster = useSearchCluster({ controllerRef, effectiveCardsRef, metricsRef });
  const {
    searchMatches,
    applySearch,
    handleSearchPick,
    handleSearchAll,
    handleSearchQueryChange,
  } = searchCluster;

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
  effectiveCardsRef.current = effectiveCards;
  const spatial = useMemo(() => buildSpatialIndex(effectiveCards, metrics), [effectiveCards, metrics]);

  const cardEls = useRef(new Map<number, HTMLElement>());
  const visibleRef = useRef(new Set<number>());
  const revealedRef = useRef(revealedCount);
  const songsRef = useRef(songs);
  songsRef.current = songs;
  const spatialRef = useRef(spatial);
  spatialRef.current = spatial;
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
  }, [metrics, handleFrame, songs.length]);

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

  // 歌词配色桥（App 组合层）：从 VisualAtmosphere 推导歌词/封面 CSS 变量。
  // useBackground 只产出 atmosphere，这里负责"氛围 → 歌词渲染变量"的落地。
  useEffect(() => {
    const root = document.documentElement;
    const apply = (palette: LyricPalette, sample: CoverSample | null): void => {
      const vars = { ...lyricPaletteCssVars(palette), ...coverCssVars(sample) };
      for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    };
    if (lyricSettings.lyricColorSource === 'custom') {
      apply(paletteFromBaseColor(lyricSettings.customColor), null);
      return;
    }
    if (atmosphere.palette) apply(atmosphere.palette, atmosphere.sample);
    else apply(SILVER_BLUE, null);
  }, [lyricSettings.lyricColorSource, lyricSettings.customColor, atmosphere]);

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
      libraryService.applyImported(songs);
      setImporting(true);
      spawnFromCenterRef.current = new Set(songs.map((_, i) => i));
      startProgressiveReveal(songs.length, () => {
        setImporting(false);
        spawnFromCenterRef.current = null;
        completeImport(
          simulated ? 'warn' : 'done',
          simulated ? `已导入 ${songs.length} 首（模拟）${note ?? ''}` : `已导入 ${songs.length} 首（${adapterName}）`,
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

  // 组合层接线：导入会话开始 → resetImportState；导入成功 → 曲库 + 歌单身份 + 渐进揭示
  sessionStartRef.current = resetImportState;
  commitRef.current = (c) => {
    if (c.meta) playlist.setCurrent(c.meta);
    beginImport(c.adapterName, c.tracks, c.simulated, c.note);
  };

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
      playlist.playFromList(index);
      setNowPlayingOpen(false);
      handleReset();
    },
    [playlist, handleReset],
  );

  const playPlaylistFromStart = useCallback(() => {
    playlist.playFromStart();
    setNowPlayingOpen(false);
    handleReset();
  }, [playlist, handleReset]);

  const insertNextSong = useCallback((track: Track) => playlist.insertNext(track), [playlist]);

  /** 歌手页点播：overlays.playArtistTrack + 回到中心（组合层接线）。 */
  const handlePlayArtistTrack = useCallback(
    (t: DesktopTrack) => {
      playArtistTrack(t);
      handleReset();
    },
    [playArtistTrack, handleReset],
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

  /** 组合层接线：壁纸应用结果 → useBackground 设背景 + 关闭壁纸窗口。 */
  const handleWallpaperApply = useCallback(
    (_item: DesktopWallpaperItem, result: DesktopWallpaperSetResult) => {
      applyWallpaperResult(result);
      closeWallpaper();
    },
    [applyWallpaperResult, closeWallpaper],
  );

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

  // 稳定 searchSlot（TopBar memo 化需要引用稳定）
  const searchSlot = useMemo(
    () => (
      <SearchBar
        songs={songs}
        onPick={handleSearchPick}
        onSearchAll={handleSearchAll}
        onQueryChange={handleSearchQueryChange}
        onPlayNetworkSong={handlePlayNetworkSong}
        onOpenArtist={openArtistFromChip}
      />
    ),
    [songs, handleSearchPick, handleSearchAll, handleSearchQueryChange, handlePlayNetworkSong, openArtistFromChip],
  );

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
        localBusy={importer.localBusy}
        searchSlot={searchSlot}
        onEnter={enterTop}
        onLeave={leaveTop}
        onOpenLocal={importer.openLocal}
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
        onEnter={enterRight}
        onLeave={leaveRight}
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
        onOpenWallpapers={openWallpapers}
      />

      <PlaylistDock
        visible={edge.left}
        accounts={accounts}
        importStatus={importer.importStatus}
        importMessage={importer.importMessage}
        onEnter={enterLeft}
        onLeave={leaveLeft}
        onImportPlaylist={importer.importPlaylistId}
        onImportUrl={importer.importUrl}
        onGoLogin={handleGoLogin}
        onRefreshAll={handleRefreshAll}
        songs={songs}
        currentPlaylist={playlist.currentPlaylist}
        onPlaySongFromList={playSongFromList}
        onPlayPlaylist={playPlaylistFromStart}
        onSongContextMenu={openContextMenu}
      />

      <button className="glass-btn center-btn" onClick={handleReset} aria-label="回到中心">
        ⌖ 回到中心
      </button>

      <BottomBar
        translateOn={lyricTranslationEnabled}
        qualities={playerState.qualities}
        quality={playerState.quality || preferredQuality()}
        mode={playerState.mode}
        onToggleTranslate={toggleTranslation}
        onSelectQuality={handleQualitySelect}
        onCycleMode={cycleModeWithToast}
        onOpenNowPlaying={openNowPlaying}
        onOpenComments={openCommentsModal}
        onOpenSongDetail={openSongDetailModal}
        onOpenArtist={openArtistByName}
      />

      <OverlayStack
        nowPlayingOpen={nowPlayingOpen}
        song={playerState.song}
        playing={playerState.playing}
        loading={playerState.loading}
        currentTime={playerState.currentTime}
        duration={playerState.duration}
        liked={liked}
        lines={lyricLines}
        translateOn={lyricTranslationEnabled}
        wallpaperOpen={wallpaperOpen}
        infoModal={infoModal}
        modeToast={modeToast}
        contextMenu={contextMenu}
        onCloseNowPlaying={closeNowPlaying}
        onTogglePlay={togglePlay}
        onPrev={playPrev}
        onNext={playNext}
        onToggleLike={handleToggleLike}
        onToggleTranslate={toggleTranslation}
        onSeek={seekTo}
        onCloseWallpaper={closeWallpaper}
        onApplyWallpaper={handleWallpaperApply}
        onCloseInfo={closeInfo}
        onOpenArtist={openArtistFromChip}
        onPlayArtistTrack={handlePlayArtistTrack}
        onCloseContextMenu={closeContextMenu}
        onInsertNext={insertNextSong}
      />
    </main>
  );
}
