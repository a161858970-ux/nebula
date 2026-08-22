import { useCallback, useEffect, useState } from 'react';
import type { DesktopLoginPlatform, DesktopPlaylistSummary } from '../../lib/playlist/ipcClient';
import { hasDesktopAPI } from '../../lib/playlist/ipcClient';
import { emptyAccount, type AccountState } from '../../lib/accounts';

/**
 * 账号领域（docs/ARCHITECTURE.md §2）：
 * 多平台登录状态、歌单摘要、启动并行探活、外部「去登录」请求。
 * 不依赖任何其他 hook；「去登录后打开右侧面板」由 App 组合层接线（showPanel）。
 */
export function useAccounts() {
  const [platforms, setPlatforms] = useState<DesktopLoginPlatform[]>([]);
  const [accounts, setAccounts] = useState<Record<string, AccountState>>({});
  const [loginNonce, setLoginNonce] = useState(0);
  const [drawerPlatform, setDrawerPlatform] = useState('netease');

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

  // 启动并行探活：拉平台列表 → 对可登录平台逐个 refresh
  useEffect(() => {
    if (!hasDesktopAPI()) return;
    let cancelled = false;
    window.nebulaAPI!
      .loginPlatforms()
      .then((res) => {
        if (!res.ok) return;
        setPlatforms(res.data);
        if (cancelled) return;
        const targets = res.data.filter((p) => p.kind === 'qr' || p.kind === 'oauth' || p.kind === 'window');
        return Promise.all(targets.map((p) => refreshAccount(p.platform)));
      })
      .catch(() => {
        /* 探活失败静默 */
      });
    return () => {
      cancelled = true;
    };
  }, [refreshAccount]);

  /** 外部「去登录」请求：记录目标平台并递增 nonce（AccountDock 据此打开登录胶囊）。 */
  const requestLogin = useCallback((platform: string) => {
    setDrawerPlatform(platform);
    setLoginNonce((n) => n + 1);
  }, []);

  return {
    platforms,
    accounts,
    loginNonce,
    drawerPlatform,
    refreshAccount,
    setDrawerPlatform,
    requestLogin,
  };
}
