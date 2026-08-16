import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import type { AccountState } from '../lib/accounts';
import type { Track } from '../lib/catalog';
import { ImportBar, type ImportStatus } from './ImportBar';
import { DOCK_PLATFORM_ORDER, platformMeta } from './platforms';

interface PlaylistDockProps {
  visible: boolean;
  accounts: Record<string, AccountState>;
  importStatus: ImportStatus;
  importMessage: string;
  songs: Track[];
  currentPlaylist: { platform: string; id: string; name: string; cover: string } | null;
  onEnter: () => void;
  onLeave: () => void;
  onImportPlaylist: (platform: string, id: string) => void;
  onImportUrl: (url: string) => void;
  onGoLogin: (platform: string) => void;
  onRefreshAll: () => void;
  onPlaySongFromList: (index: number) => void;
  onPlayPlaylist: () => void;
  onSongContextMenu: (e: React.MouseEvent, track: Track) => void;
}

/** 胶囊展开后的固定宽度（窗口宽度与胶囊一致）。 */
const CAPSULE_W = 300;
const ROW_SPRING = { type: 'spring' as const, stiffness: 430, damping: 30 };
const WIN_SPRING = { type: 'spring' as const, stiffness: 240, damping: 28 };

const rowVariants = {
  hidden: { opacity: 0, scale: 0.5, y: 10 },
  show: (i: number) => ({
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { type: 'spring' as const, stiffness: 500, damping: 24, delay: 0.03 + i * 0.06 },
  }),
};

/** 小跳字动画：字符逐个弹性入场。 */
function JumpText({ text, delay = 0 }: { text: string; delay?: number }) {
  return (
    <span className="jump-text" aria-label={text}>
      {Array.from(text).map((ch, i) => (
        <motion.span
          key={i}
          className="jump-char"
          initial={{ opacity: 0, y: 9, scale: 0.5 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 560, damping: 25, delay: delay + i * 0.016 }}
        >
          {ch}
        </motion.span>
      ))}
    </span>
  );
}

/**
 * 左侧歌单导入 Dock：6 小球（网易云 / QQ / 酷狗 / 汽水 / Spotify / 手动导入）
 * → 悬浮向右单向展开胶囊 → 点击已登录平台上移并向下展开歌单窗口。
 */
export function PlaylistDock({
  visible,
  accounts,
  importStatus,
  importMessage,
  songs,
  currentPlaylist,
  onEnter,
  onLeave,
  onImportPlaylist,
  onImportUrl,
  onGoLogin,
  onRefreshAll,
  onPlaySongFromList,
  onPlayPlaylist,
  onSongContextMenu,
}: PlaylistDockProps) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [expandedPlId, setExpandedPlId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 面板收回时复位所有展开状态
  useEffect(() => {
    if (!visible) {
      setHovered(null);
      setOpenId(null);
      setExpandedPlId(null);
    }
  }, [visible]);

  const isCurrent = (platform: string, id: string): boolean =>
    !!currentPlaylist && currentPlaylist.platform === platform && currentPlaylist.id === id;

  // 窗口打开时：打开的平台移到顶部，其余平台与手动球依次下移让位
  const rows = openId
    ? [openId, ...DOCK_PLATFORM_ORDER.filter((p) => p !== openId), 'manual']
    : [...DOCK_PLATFORM_ORDER, 'manual'];

  const capsuleContent = (id: string) => {
    const meta = platformMeta(id);
    if (id === 'manual') {
      return (
        <div className="import-panel dock-manual-panel">
          <ImportBar status={importStatus} message={importMessage} onImport={onImportUrl} />
        </div>
      );
    }
    const account = accounts[id];
    if (account?.loggedIn) {
      return (
        <div className="dock-cap-label">
          <JumpText text={`${meta.name} · 歌单 ${account.playlists.length} 个`} />
        </div>
      );
    }
    return (
      <div className="dock-cap-login">
        <span className="dock-cap-name">
          <JumpText text={meta.name} />
        </span>
        <span className="dock-cap-state">未登录</span>
        <button
          type="button"
          className="fx-strong dock-cap-btn"
          onClick={(e) => {
            e.stopPropagation();
            onGoLogin(id);
          }}
        >
          去登录
        </button>
      </div>
    );
  };

  const windowContent = (id: string) => {
    const meta = platformMeta(id);
    const account = accounts[id];
    if (!account?.loggedIn) return null;
    return (
      <div className="dock-window-body">
        <div className="dock-win-head">
          <span className="dock-win-title">{meta.name} · 歌单</span>
          <button type="button" className="fx-soft dock-refresh" onClick={onRefreshAll} title="刷新全平台歌单">
            刷新
          </button>
        </div>
        {account.loading ? (
          <div className="dock-win-empty">正在拉取歌单…</div>
        ) : !account.playlists.length ? (
          <div className="dock-win-empty">该账号暂无歌单</div>
        ) : (
          <div className="dock-playlists">
            {account.playlists.map((pl, i) => {
              const current = isCurrent(id, pl.id);
              const showExpanded = current && expandedPlId === pl.id;
              return (
                <motion.div
                  key={pl.id}
                  className={`dock-pl-wrap${current ? ' is-current' : ''}`}
                  initial={{ opacity: 0, y: 12, scale: 0.97 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 30, delay: i * 0.045 }}
                >
                  <button
                    type="button"
                    className="dock-pl fx-soft"
                    onClick={() => {
                      if (current) setExpandedPlId((v) => (v === pl.id ? null : pl.id));
                      else onImportPlaylist(id, pl.id);
                    }}
                  >
                    {pl.cover ? (
                      <img className="sidebar-playlist-cover" src={pl.cover} alt="" loading="lazy" />
                    ) : (
                      <span className="sidebar-playlist-cover is-ph" />
                    )}
                    <span className="dock-pl-name">{pl.name}</span>
                    <span className="sidebar-playlist-count">{pl.trackCount} 首</span>
                    {current && <em className="pl-imported">已导入</em>}
                  </button>
                  {showExpanded && (
                    <div className="pl-detail dock-pl-detail" ref={listRef}>
                      <div className="pl-head">
                        <img className="pl-head-cover" src={currentPlaylist!.cover || pl.cover} alt="" />
                        <div className="pl-head-info">
                          <span className="pl-head-name">{currentPlaylist!.name || pl.name}</span>
                          <span className="pl-head-count">{songs.length} 首</span>
                        </div>
                        <button className="pl-head-btn" onClick={onPlayPlaylist} title="播放歌单">
                          ▶ 播放歌单
                        </button>
                        <button
                          className="pl-head-btn"
                          onClick={() => listRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
                          title="回到顶部"
                        >
                          ⬆ 回到顶部
                        </button>
                      </div>
                      <div className="pl-songs">
                        {songs.map((song, si) => (
                          <div
                            key={`${song.source}:${song.sourceId ?? si}`}
                            className="pl-song"
                            onDoubleClick={() => onPlaySongFromList(si)}
                            onContextMenu={(e) => onSongContextMenu(e, song)}
                          >
                            {song.cover ? (
                              <img className="pl-song-cover" src={song.cover} alt="" loading="lazy" />
                            ) : (
                              <span className="pl-song-cover is-ph" />
                            )}
                            <div className="pl-song-meta">
                              <span className="pl-song-title">{song.title}</span>
                              <span className="pl-song-artist">{song.artist}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <aside
      className={`edge-panel edge-left dock dock-left${visible ? ' is-open' : ''}`}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <div className="dock-stack">
        {rows.map((id, i) => {
          const meta = platformMeta(id);
          const account = accounts[id];
          const expanded = hovered === id || openId === id;
          const isManual = id === 'manual';
          return (
            <motion.div
              layout
              key={id}
              custom={i}
              variants={rowVariants}
              initial="hidden"
              animate={visible ? 'show' : 'hidden'}
              className={`dock-row${isManual ? ' dock-manual' : ''}${openId === id ? ' is-open' : ''}`}
              style={{ zIndex: 20 + i }}
              transition={ROW_SPRING}
              onPointerEnter={() => setHovered(id)}
              onPointerLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setHovered(null);
              }}
            >
              <button
                type="button"
                className={`dock-ball fx-medium${openId === id ? ' is-open' : ''}`}
                style={isManual ? undefined : ({ '--brand': meta.brand } as React.CSSProperties)}
                aria-label={isManual ? '手动导入歌单' : meta.name}
                onClick={() => {
                  if (isManual) return;
                  if (openId === id) {
                    setOpenId(null);
                    setExpandedPlId(null);
                  } else if (account?.loggedIn) {
                    setOpenId(id);
                    setExpandedPlId(null);
                    setHovered(id);
                  }
                }}
              >
                {isManual ? (
                  <span className="dock-manual-glyph">＋</span>
                ) : (
                  <img className="dock-logo-img" src={meta.logo} alt="" draggable={false} />
                )}
                {!isManual && account?.loggedIn && <span className="dock-dot" title="已登录" />}
              </button>

              <motion.div
                className="dock-capsule"
                animate={{ width: expanded ? CAPSULE_W : 0 }}
                transition={ROW_SPRING}
              >
                <div className="dock-capsule-inner">{expanded ? capsuleContent(id) : null}</div>
              </motion.div>

              {openId === id && (
                <motion.div
                  layout
                  className="dock-window"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  transition={WIN_SPRING}
                >
                  {windowContent(id)}
                </motion.div>
              )}
            </motion.div>
          );
        })}
      </div>
    </aside>
  );
}
