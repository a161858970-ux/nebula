import { useLayoutEffect, useRef, useState } from 'react';
import type { AccountState } from '../lib/accounts';
import type { Track } from '../lib/catalog';
import type { ImportStatus } from './ImportBar';
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

/** 未登录平台窗口内文案（与原型逐字一致）。 */
const UNAVAILABLE_TEXT: Record<string, string> = {
  kugou: '酷狗网页登录接口未公开，暂不支持账号登录',
  qishui: '汽水音乐为字节系封闭平台，暂无公开登录/歌单 API',
  spotify: '未登录 Spotify · 需配置 SPOTIFY_CLIENT_ID',
};

/** 手动导入输入框：tidy-pig-67 复刻（回车导入，无效链接小字提醒）。 */
function ManualImport({
  status,
  onImport,
}: {
  status: ImportStatus;
  onImport: (url: string) => void;
}) {
  const [value, setValue] = useState('');
  return (
    <div className="manual-import">
      <div className="group">
        <svg
          className="search-icon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m21 21-4.3-4.3" />
        </svg>
        <input
          className="input"
          placeholder="歌单链接"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            // 回车导入；留空=演示歌单（与既有行为一致）
            if (e.key === 'Enter') onImport(value.trim());
          }}
          spellCheck={false}
        />
      </div>
      {status === 'error' && <div className="manual-error">歌单链接无效</div>}
    </div>
  );
}

/**
 * 左侧歌单导入 Dock —— 原型 dock-prototype-v3.html 的逐行移植。
 * 视觉真源：prototype/dock-prototype-v3.html（用户已验证定稿，勿改结构/类名）。
 */
export function PlaylistDock({
  visible,
  accounts,
  importStatus,
  songs,
  currentPlaylist,
  onEnter,
  onLeave,
  onImportPlaylist,
  onImportUrl,
  onRefreshAll,
  onPlaySongFromList,
  onPlayPlaylist,
  onSongContextMenu,
}: PlaylistDockProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(true);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const flipRef = useRef<{ id: string; from: number } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 面板收回时复位
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  // 原型 flipRow：开/关窗口时该行 FLIP 上移置顶，dock 整体上移
  useLayoutEffect(() => {
    const f = flipRef.current;
    flipRef.current = null;
    if (!f) return;
    const row = rowRefs.current.get(f.id);
    if (!row) return;
    const to = row.getBoundingClientRect().top;
    const dy = f.from - to;
    if (Math.abs(dy) < 1) return;
    row.style.transition = 'none';
    row.style.transform = `translateY(${dy}px)`;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        row.style.transition = 'transform 0.55s var(--jelly-win)';
        row.style.transform = 'translateY(0)';
      });
    });
  }, [openId]);

  const handlePillClick = (id: string) => {
    if (!visibleRef.current) return;
    const row = rowRefs.current.get(id);
    flipRef.current = { id, from: row ? row.getBoundingClientRect().top : 0 };
    if (openId === id) {
      setOpenId(null);
      return;
    }
    setOpenId(id);
    setDetailOpen(true);
  };

  const isCurrent = (platform: string, id: string): boolean =>
    !!currentPlaylist && currentPlaylist.platform === platform && currentPlaylist.id === id;

  // 窗口打开时：打开的行排到最前（原型 order:-1 的 React 等价）；手动行始终只有一份
  const rows =
    openId === 'manual'
      ? ['manual', ...DOCK_PLATFORM_ORDER]
      : openId
        ? [openId, ...DOCK_PLATFORM_ORDER.filter((p) => p !== openId), 'manual']
        : [...DOCK_PLATFORM_ORDER, 'manual'];

  const windowContent = (id: string) => {
    const meta = platformMeta(id);
    if (id === 'manual') {
      return <ManualImport status={importStatus} onImport={onImportUrl} />;
    }
    const account = accounts[id];
    if (!account?.loggedIn) {
      return <div className="login-detail">{UNAVAILABLE_TEXT[id] ?? `未登录${meta.name}`}</div>;
    }
    return (
      <>
        <div className="win-title">
          <span>{meta.name} · 歌单</span>
          <span className="refresh" onClick={onRefreshAll}>
            刷新
          </span>
        </div>
        {account.playlists.map((pl) => {
          const current = isCurrent(id, pl.id);
          return (
            <div key={pl.id} className={`pl-wrap${current ? ' is-current' : ''}`}>
              <button
                type="button"
                className="pl"
                onClick={() => {
                  if (current) setDetailOpen((v) => !v);
                  else onImportPlaylist(id, pl.id);
                }}
              >
                <span
                  className="pl-cover"
                  style={
                    pl.cover
                      ? { backgroundImage: `url(${pl.cover})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                      : undefined
                  }
                />
                <span className="pl-name">{pl.name}</span>
                <span className="pl-count">{pl.trackCount} 首</span>
                {current && <span className="pl-tag">已导入</span>}
              </button>
              {current && detailOpen && (
                <div className="pl-detail">
                  <div className="pl-head">
                    <span
                      className="pl-head-cover"
                      style={
                        currentPlaylist?.cover
                          ? {
                              backgroundImage: `url(${currentPlaylist.cover})`,
                              backgroundSize: 'cover',
                              backgroundPosition: 'center',
                            }
                          : undefined
                      }
                    />
                    <div className="pl-head-info">
                      <span className="pl-head-name">{currentPlaylist?.name || pl.name}</span>
                      <span className="pl-head-count">{songs.length} 首</span>
                    </div>
                    <button className="pl-head-btn" onClick={onPlayPlaylist}>
                      ▶ 播放歌单
                    </button>
                    <button
                      className="pl-head-btn"
                      onClick={() => listRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
                    >
                      ⬆ 回到顶部
                    </button>
                  </div>
                  <div className="pl-songs">
                    {songs.map((song, i) => (
                      <div
                        key={`${song.source}:${song.sourceId ?? i}`}
                        className="pl-song"
                        onDoubleClick={() => onPlaySongFromList(i)}
                        onContextMenu={(e) => onSongContextMenu(e, song)}
                      >
                        <span
                          className="pl-song-cover"
                          style={
                            song.cover
                              ? { backgroundImage: `url(${song.cover})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                              : undefined
                          }
                        />
                        <div className="pl-song-meta">
                          <span className="pl-song-title">{song.title}</span>
                          <span className="pl-song-artist">{song.artist}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </>
    );
  };

  return (
    <div
      className={`dock dock-left${visible ? ' is-open' : ''}${openId ? ' has-open' : ''}`}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      {rows.map((id) => {
        const meta = platformMeta(id);
        const account = accounts[id];
        const isManual = id === 'manual';
        const isOpen = openId === id;
        return (
          <div
            key={id}
            ref={(el) => {
              if (el) rowRefs.current.set(id, el);
              else rowRefs.current.delete(id);
            }}
            className={`row${isOpen ? ' open' : ''}`}
            data-name={id}
            style={{ '--brand': isManual ? '#9aa4c8' : meta.brand } as React.CSSProperties}
          >
            <button
              type="button"
              className="pill"
              onClick={() => handlePillClick(id)}
            >
              <span className="icon" style={isManual ? { fontSize: 14 } : undefined}>
                {isManual ? (
                  '＋'
                ) : (
                  <img className="dock-logo-img" src={meta.logo} alt="" draggable={false} />
                )}
              </span>
              {isManual ? (
                <span className="cap-text">手动导入 · 粘贴歌单链接（输入框示意）</span>
              ) : account?.loggedIn ? (
                <span className="cap-text">
                  {meta.name} · 歌单 {account.playlists.length} 个
                </span>
              ) : (
                <>
                  <span className="cap-text">{meta.name}</span>
                  <span className="cap-text" style={{ color: 'rgba(255,255,255,.5)' }}>
                    未登录
                  </span>
                </>
              )}
              <span className="go">›</span>
            </button>
            <div className="win">
              <div className="win-inner" ref={isOpen ? listRef : undefined}>
                <div className="win-pad" />
                {windowContent(id)}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
