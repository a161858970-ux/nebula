import type { LoginAdapter } from '../login/index';

/** 兜底音源平台的路由目标。 */
export interface FallbackTarget {
  platform: string;
  /** svip > vip > free（已登录免费） > guest（未登录，仅免费音质）。 */
  tier: 'svip' | 'vip' | 'free' | 'guest';
}

/**
 * 多平台 VIP 路由：按用户在各平台已登录账号的 VIP 状态生成兜底顺序。
 * - 汽水（qishui）默认排除：取链接口在当前环境不可用，仅作为歌单来源。
 * - 60 秒缓存：getAccount 可能触发网络请求，避免每次兜底都全量探测。
 */
export function createFallbackPriorityProvider(
  loginAdapters: Record<string, LoginAdapter>,
  excluded: string[] = ['qishui'],
): () => Promise<FallbackTarget[]> {
  let cache: { at: number; order: FallbackTarget[] } | null = null;

  const tierOf = (acc: { loggedIn?: boolean; isVip?: boolean; isSvip?: boolean } | null | undefined): FallbackTarget['tier'] => {
    if (!acc?.loggedIn) return 'guest';
    if (acc.isSvip) return 'svip';
    if (acc.isVip) return 'vip';
    return 'free';
  };

  return async (): Promise<FallbackTarget[]> => {
    const now = Date.now();
    if (cache && now - cache.at < 60_000) return cache.order;
    const targets: FallbackTarget[] = [];
    for (const [platform, adapter] of Object.entries(loginAdapters)) {
      if (excluded.includes(platform)) continue;
      try {
        const acc = await adapter.getAccount?.();
        targets.push({ platform, tier: tierOf(acc) });
      } catch {
        targets.push({ platform, tier: 'guest' });
      }
    }
    const rank = { svip: 0, vip: 1, free: 2, guest: 3 } as const;
    targets.sort((a, b) => rank[a.tier] - rank[b.tier] || a.platform.localeCompare(b.platform));
    cache = { at: now, order: targets };
    return targets;
  };
}
