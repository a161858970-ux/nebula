import type { AdapterMap } from '../adapters/index';
import type { PlatformAdapter, ResolveResult, Track } from '../types';
import type { FallbackTarget } from './platformRouter';
import { durationSimilarity, titleSimilarity } from '../adapters/mappers';

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const ADAPTER_TIMEOUT_MS = 10000;
const PROBE_TIMEOUT_MS = 6000;

/** URL probe injected by the main process (platform Referer/UA/Cookie applied). */
export type UrlProbe = (url: string, platform: Track['platform']) => Promise<boolean>;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout ${Math.round(ms / 1000)}s`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Match score: title 70% + duration 30%. */
export function matchScore(candidate: Track, target: Track): number {
  return 0.7 * titleSimilarity(candidate.title, target.title) + 0.3 * durationSimilarity(candidate.duration, target.duration);
}

/** 归一化标题（小写 + 去空白/标点），用于精确命中判定。 */
function normTitle(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[\s\u3000·・/\\\-–—()（）[\]【】"'“”‘’!！?？,，.。:：]/g, '');
}

/**
 * 兜底候选的防翻唱/盗版保护：
 * - 标题归一化完全相等优先（严格对照）；
 * - 时长与目标相差 > 8s 或 > 10% 直接剔除（防 Remix/翻唱/错误版本）；
 * - 时长 ≤ 2s 视为严格匹配；歌手包含校验加分。
 */
function filterCandidate(candidate: Track, target: Track): { ok: boolean; rank: number; note?: string } {
  const titleEq = normTitle(candidate.title) === normTitle(target.title);
  const dur = Number(target.duration) || 0;
  const cDur = Number(candidate.duration) || 0;
  const durDiff = Math.abs(cDur - dur);
  if (dur && cDur && durDiff > 8 && durDiff > dur * 0.1) {
    return { ok: false, rank: 9, note: `时长不符 ${dur}s vs ${cDur}s` };
  }
  const durOk = !dur || !cDur || durDiff <= 2;
  const targetArtist = (target.artist || '').toLowerCase().split(' / ')[0] || '';
  const candArtist = (candidate.artist || '').toLowerCase();
  const artistHit = !targetArtist || !candArtist || candArtist.includes(targetArtist) || targetArtist.includes(candArtist);
  const rank = titleEq ? 0 : artistHit && durOk ? 1 : artistHit ? 2 : 3;
  return { ok: true, rank, note: `${titleEq ? '精确' : '相似'} 时长${durOk ? '匹配' : '偏离'} 歌手${artistHit ? '命中' : '未命中'}` };
}

/**
 * Song source fallback dispatcher:
 * - resolve(): primary platform (single call, 10s timeout) -> probe URL -> fallback search;
 *   all failures return an explicit error (never silent empty string).
 * - enrichFallback(): fills fallbackUrl for the frontend <audio> onerror retry path.
 */
export class SongResolver {
  private fallbackTargets: (() => Promise<FallbackTarget[]>) | null = null;

  constructor(
    private adapters: AdapterMap,
    private log: (m: string) => void = (m) => console.warn('[SongResolver]', m),
    private probe?: UrlProbe,
  ) {}

  /** 注入多平台 VIP 路由（electron 主进程接线；缺省时保持旧固定顺序）。 */
  setFallbackTargets(getTargets: () => Promise<FallbackTarget[]>): void {
    this.fallbackTargets = getTargets;
  }

  async resolve(track: Track, quality?: string): Promise<ResolveResult | null> {
    if (track.originalUrl) {
      return {
        url: track.originalUrl,
        fallback: false,
        platform: track.platform,
        sourceId: track.sourceId,
        playable: true,
      };
    }
    try {
      const direct = await withTimeout(
        this.adapters[track.platform].fetchSongUrl(track.sourceId, undefined, quality, track.extra),
        ADAPTER_TIMEOUT_MS,
        `[${track.platform}] fetchSongUrl`,
      );
      if (direct?.url && (await this.acceptUrl(direct.url, track.platform, direct.error))) {
        return {
          url: direct.url,
          fallback: false,
          platform: track.platform,
          sourceId: track.sourceId,
          trial: direct.trial,
          quality: direct.quality,
          playable: direct.playable ?? true,
          error: direct.error,
        };
      }
      if (direct?.url) {
        this.log(`primary URL failed probe, trying fallback: ${track.id}`);
      }
      if (direct?.error) this.log(`primary fetch failed: ${track.id} - ${direct.error}`);
    } catch (err) {
      this.log(`primary fetch error ${track.id}: ${errMsg(err)}`);
    }
    const fallbackResult = await this.resolveFallback(track, quality);
    return (
      fallbackResult ?? {
        url: '',
        fallback: true,
        platform: track.platform,
        sourceId: track.sourceId,
        playable: false,
        error: '主平台与兜底平台均未获取到可播音源（含音源探测过滤）',
      }
    );
  }

  /** Secondary fallback: cross-platform search -> title/duration score -> try fetch. */
  async resolveFallback(track: Track, quality?: string): Promise<ResolveResult | null> {
    const keyword = `${track.title} ${track.artist}`.trim();
    let targets: FallbackTarget[];
    try {
      targets = this.fallbackTargets ? await this.fallbackTargets() : [];
    } catch {
      targets = [];
    }
    const sources: Array<{ adapter: PlatformAdapter; tier: FallbackTarget['tier'] }> = targets.length
      ? targets
          .filter((t) => t.platform !== track.platform)
          .map((t) => ({ adapter: this.adapters[t.platform as keyof AdapterMap], tier: t.tier }))
          .filter((s): s is { adapter: PlatformAdapter; tier: FallbackTarget['tier'] } => !!s.adapter)
      : [
          { adapter: this.adapters.netease, tier: 'guest' as const },
          { adapter: this.adapters.kugou, tier: 'guest' as const },
        ];
    for (const { adapter: source, tier } of sources) {
      if (!source.searchSongs) continue;
      try {
        const candidates = await source.searchSongs(keyword, 15);
        const scored = candidates
          .map((c) => ({ candidate: c, score: matchScore(c, track), guard: filterCandidate(c, track) }))
          .filter((s) => s.score >= 0.55 && s.guard.ok)
          .sort(
            (a, b) =>
              a.guard.rank - b.guard.rank || b.score - a.score || a.candidate.title.length - b.candidate.title.length,
          );
        for (const { candidate, guard } of scored.slice(0, 3)) {
          if (guard.note) this.log(`候选 @${source.platform} "${candidate.title}"：${guard.note}`);
          const albumId =
            typeof candidate.extra?.albumId === 'string' ? candidate.extra.albumId : undefined;
          const url = await withTimeout(
            // VIP/SVIP 平台按用户请求音质取链；免费/未登录平台用默认音质提高可用性
            source.fetchSongUrl(
              candidate.sourceId,
              albumId,
              tier === 'svip' || tier === 'vip' ? quality : undefined,
              candidate.extra,
            ),
            ADAPTER_TIMEOUT_MS,
            `[${source.platform}] fallback fetchSongUrl`,
          );
          if (url?.url && (await this.acceptUrl(url.url, source.platform))) {
            this.log(`fallback hit "${candidate.title} / ${candidate.artist}" @${source.platform}`);
            return {
              url: url.url,
              fallback: true,
              platform: source.platform,
              sourceId: candidate.sourceId,
              trial: url.trial,
              quality: url.quality,
              playable: url.playable ?? true,
            };
          }
        }
      } catch (err) {
        this.log(`fallback search failed @${source.platform}: ${errMsg(err)}`);
      }
    }
    this.log(`no fallback source found: ${keyword}`);
    return null;
  }

  /**
   * Real URL probe before playback. Without an injected probe (smoke/offline) URLs pass through.
   * Probe failures (403 / dead link / HTML error page) reject the candidate.
   */
  private async acceptUrl(url: string, platform: Track['platform'], directError?: string): Promise<boolean> {
    if (!this.probe) return true;
    try {
      const ok = await withTimeout(this.probe(url, platform), PROBE_TIMEOUT_MS, 'audio probe');
      if (!ok) {
        this.log(`probe rejected: [${platform}] ${url.slice(0, 100)}${directError ? ` (${directError})` : ''}`);
      }
      return ok;
    } catch (err) {
      this.log(`probe error: ${errMsg(err)}`);
      return false;
    }
  }

  /** Returns a new Track with fallbackUrl filled (frontend <audio> onerror retry). */
  async enrichFallback(track: Track): Promise<Track> {
    const result = await this.resolveFallback(track);
    if (!result) return { ...track, fallbackUrl: '' };
    return {
      ...track,
      originalUrl: result.fallback ? track.originalUrl : result.url,
      fallbackUrl: result.fallback ? result.url : track.fallbackUrl,
    };
  }
}
