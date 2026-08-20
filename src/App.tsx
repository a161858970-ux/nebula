import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackgroundLayer } from './components/BackgroundLayer';
import { BottomBar } from './components/BottomBar';
import { SearchBar } from './components/SearchBar';
import { LyricsLayer } from './components/LyricsLayer';
import { StageCanvas } from './components/StageCanvas';
import { TopBar } from './components/TopBar';
import { AccountDock } from './components/AccountDock';
import { PlaylistDock } from './components/PlaylistDock';
import { WallpaperPicker } from './components/WallpaperPicker';
import { OverlayStack } from './components/OverlayStack';
import { audioPlayer } from './lib/audio/AudioPlayer';
import type { PanController } from './lib/panEngine';
import { SEED, type CardSpec, type LayoutMetrics } from './lib/layout';
import type { BackgroundSetting } from './lib/backgrounds';
import { generateTracks } from './lib/catalog';
import type { Track } from './lib/catalog';
import { mulberry32 } from './lib/rng';
import { hasDesktopAPI, toBackendTrack, toFrontendTrack, type DesktopTrack } from './lib/playlist/ipcClient';
import type { DesktopWallpaperItem, DesktopWallpaperSetResult } from './lib/playlist/ipcClient';
import { preferredQuality } from './lib/preferences';
import { useAccounts } from './hooks/accounts/useAccounts';
import { useLibrary } from './hooks/library/useLibrary';
import { usePlaylist } from './hooks/playlist/usePlaylist';
import { usePlaylistImport, type ImportCommit } from './hooks/playlistImport/usePlaylistImport';
import { useOverlays } from './hooks/overlays/useOverlays';
import { useLyrics } from './hooks/lyrics/useLyrics';
import { useBackground } from './hooks/background/useBackground';
import { useInterfaceSettings } from './hooks/interfaceSettings/useInterfaceSettings';
import { usePlayback } from './hooks/playback/PlaybackContext';
import { InterfaceSettingsProvider } from './hooks/interfaceSettings/InterfaceSettingsContext';
import { VisualAtmosphereProvider } from './hooks/background/VisualAtmosphereContext';
import { useEdgePanels } from './hooks/edgePanels/useEdgePanels';
import { useSearchCluster } from './hooks/searchCluster/useSearchCluster';
import { useStage } from './hooks/stage/useStage';
import { libraryService } from './lib/library';

/** 初始曲库量：渲染成本与它无关，仅影响数据生成与空间索引（线性）。 */
const CARD_COUNT = 1000;
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

export default function App() {
  const isWallpaperView =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('view') === 'wallpaper';
  // 曲库初始化：首次挂载用演示数据填充 LibraryService（后续由导入/会话恢复接管）
  useState(() => {
    if (libraryService.getState().songs.length === 0) {
      libraryService.applyImported(generateTracks(mulberry32(SEED), CARD_COUNT));
    }
  });
  const { songs } = useLibrary();

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
    lyricDebugInfo,
  } = lyrics;

  // ---------- 边缘感应面板（useEdgePanels） ----------
  const edgePanels = useEdgePanels({ contextMenuRef });
  const { edge, showPanel, enterTop, leaveTop, enterRight, leaveRight, enterLeft, leaveLeft } = edgePanels;

  // 低频播放状态（不含 currentTime/duration；高频值由叶子组件订阅）
  const playerState = usePlayback();

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

  // ---------- 搜索聚簇 + 舞台（useSearchCluster 先声明 refs，useStage 渲染时填充） ----------
  const controllerRef = useRef<PanController | null>(null);
  // 值在 useStage 渲染时填充；null! 仅为早期声明（运行时 action 时已赋值）
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

  const currentSongId = playerState.song?.id ?? null;
  const stage = useStage({
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
  });
  const {
    stageRef,
    frameBusRef,
    panRef,
    importing,
    hoveredId,
    visibleIds,
    failedIds,
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
  } = stage;

  /** 全网搜索点播：仅播放该曲，不影响当前队列；播完自动接回歌单（playTransient）。 */
  const handlePlayNetworkSong = useCallback((track: Track) => {
    audioPlayer.playTransient(track);
  }, []);

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

  // 组合层接线：导入会话开始 → resetImportState；导入成功 → 曲库 + 歌单身份 + 渐进揭示
  sessionStartRef.current = resetImportState;
  commitRef.current = (c) => {
    if (c.meta) playlist.setCurrent(c.meta);
    beginImport(c.adapterName, c.tracks, c.simulated, c.note);
  };

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

  // 界面设置 context（低频；App 组合层持有状态与 setter）
  const interfaceSettingsValue = useMemo(
    () => ({
      lyricSettings,
      uiHideCards,
      uiHideLyrics,
      lyricTranslationEnabled,
      toggleHideCards,
      toggleHideLyrics,
      toggleTranslation,
    }),
    [
      lyricSettings,
      uiHideCards,
      uiHideLyrics,
      lyricTranslationEnabled,
      toggleHideCards,
      toggleHideLyrics,
      toggleTranslation,
    ],
  );

  // 视觉氛围 context（useBackground 只产出氛围数据，消费端自行推导歌词色板）
  const atmosphereValue = useMemo(
    () => ({
      palette: atmosphere.palette,
      sample: atmosphere.sample,
      coverMode: bgCoverMode,
      effectiveBg: effectiveBgSetting,
    }),
    [atmosphere.palette, atmosphere.sample, bgCoverMode, effectiveBgSetting],
  );

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
    <InterfaceSettingsProvider value={interfaceSettingsValue}>
      <VisualAtmosphereProvider value={atmosphereValue}>
        <main className="app">
      <BackgroundLayer setting={effectiveBgSetting} coverMode={bgSetting.type === 'cover' ? bgCoverMode : undefined} />

      {!uiHideLyrics && (
        <LyricsLayer
          lines={lyricLines}
          frameBus={frameBusRef.current}
          songKey={
            playerState.song
              ? `${playerState.song.source}:${playerState.song.sourceId ?? playerState.song.id}`
              : 'none'
          }
          songTitle={playerState.song?.title}
          songArtist={playerState.song?.artist}
        />
      )}

      <StageCanvas
        stageRef={stageRef}
        importing={importing}
        uiHideCards={uiHideCards}
        visibleIds={visibleIds}
        effectiveCards={effectiveCards}
        metrics={metrics}
        pan={panRef.current}
        zoom={frameBusRef.current.zoom}
        hoveredId={hoveredId}
        currentSongId={currentSongId}
        failedIds={failedIds}
        onPlay={handleCardPlay}
        onContextMenu={openContextMenu}
        onHoverChange={handleHoverChange}
        registerEl={registerEl}
      />

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

      {/* 开发调试：歌词来源信息（临时，发布前删除） */}
      <div style={{
        position: 'fixed',
        bottom: 120,
        right: 24,
        background: 'rgba(0,0,0,0.75)',
        color: '#0f0',
        fontFamily: 'monospace',
        fontSize: 12,
        padding: '8px 12px',
        borderRadius: 6,
        lineHeight: 1.6,
        zIndex: 9999,
        pointerEvents: 'none',
        minWidth: 180,
      }}>
        {lyricDebugInfo ? (
          <>
            <div>来源: {lyricDebugInfo.source}</div>
            <div>YRC: {lyricDebugInfo.hasYrc ? '✓' : '✗'}</div>
            <div>QRC: {lyricDebugInfo.hasQrc ? '✓' : '✗'}</div>
            <div>逐字: {lyricDebugInfo.wordLines}/{lyricDebugInfo.totalLines}
              ({lyricDebugInfo.totalLines > 0
                ? Math.round(lyricDebugInfo.wordLines / lyricDebugInfo.totalLines * 100)
                : 0}%)
            </div>
          </>
        ) : (
          <div>歌词: 无数据</div>
        )}
      </div>

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
      </VisualAtmosphereProvider>
    </InterfaceSettingsProvider>
  );
}
