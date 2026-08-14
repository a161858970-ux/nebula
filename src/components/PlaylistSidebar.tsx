import { useState } from 'react';
import type { DesktopLoginPlatform } from '../lib/playlist/ipcClient';
import type { AccountState } from '../lib/accounts';
import { ImportBar, type ImportStatus } from './ImportBar';

interface PlaylistSidebarProps {
  visible: boolean;
  platforms: DesktopLoginPlatform[];
  accounts: Record<string, AccountState>;
  importStatus: ImportStatus;
  importMessage: string;
  onEnter: () => void;
  onLeave: () => void;
  onImportPlaylist: (platform: string, id: string) => void;
  onImportUrl: (url: string) => void;
  onGoLogin: (platform: string) => void;
  onRefreshAll: () => void;
}

const PLATFORM_TABS = [
  { platform: 'netease', name: '网易云' },
  { platform: 'qq', name: 'QQ 音乐' },
  { platform: 'kugou', name: '酷狗' },
] as const;

/** 左侧边缘感应歌单面板：平台歌单导入 + 手动链接（与账号管理解耦）。 */
export function PlaylistSidebar({
  visible,
  platforms,
  accounts,
  importStatus,
  importMessage,
  onEnter,
  onLeave,
  onImportPlaylist,
  onImportUrl,
  onGoLogin,
  onRefreshAll,
}: PlaylistSidebarProps) {
  const [tab, setTab] = useState<'netease' | 'qq' | 'kugou' | 'manual'>('manual');

  return (
    <aside
      className={`edge-panel edge-left sidebar${visible ? ' is-open' : ''}`}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <div className="sidebar-head-row">
        <span className="sidebar-head">歌单导入</span>
        <button className="sidebar-refresh" onClick={onRefreshAll}>
          刷新
        </button>
      </div>
      <div className="sidebar-tabs">
        {PLATFORM_TABS.map((p) => (
          <button
            key={p.platform}
            className={tab === p.platform ? 'active' : ''}
            onClick={() => setTab(p.platform)}
          >
            {p.name}
            {accounts[p.platform]?.loggedIn && <em className="acct-dot" />}
          </button>
        ))}
        <button className={tab === 'manual' ? 'active' : ''} onClick={() => setTab('manual')}>
          手动链接
        </button>
      </div>

      {tab === 'manual' ? (
        <div className="import-panel">
          <ImportBar status={importStatus} message={importMessage} onImport={onImportUrl} />
        </div>
      ) : (
        (() => {
          const account = accounts[tab];
          const platformInfo = platforms.find((p) => p.platform === tab);
          if (!account?.loggedIn) {
            return (
              <div className="sidebar-empty">
                <p>未登录{platformInfo?.name ?? '该平台'}，登录后可拉取个人歌单。</p>
                <button className="glass-btn" onClick={() => onGoLogin(tab)}>
                  去登录
                </button>
                <p className="sidebar-hint">也可以切换到「手动链接」粘贴歌单链接导入。</p>
              </div>
            );
          }
          if (account.loading) {
            return <div className="sidebar-empty">正在拉取歌单…</div>;
          }
          if (!account.playlists.length) {
            return <div className="sidebar-empty">该账号暂无歌单。</div>;
          }
          return (
            <div className="sidebar-playlists">
              {account.playlists.map((pl) => (
                <button
                  key={pl.id}
                  className="sidebar-playlist"
                  onClick={() => onImportPlaylist(tab, pl.id)}
                >
                  {pl.cover ? (
                    <img className="sidebar-playlist-cover" src={pl.cover} alt="" loading="lazy" />
                  ) : (
                    <span className="sidebar-playlist-cover is-ph" />
                  )}
                  <span className="sidebar-playlist-name">{pl.name}</span>
                  <span className="sidebar-playlist-count">{pl.trackCount} 首</span>
                </button>
              ))}
            </div>
          );
        })()
      )}
    </aside>
  );
}
