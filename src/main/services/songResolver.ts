import type { AdapterMap } from '../adapters/index';
import type { PlatformAdapter, ResolveResult, Track } from '../types';
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

/**
 * Song source fallback dispatcher:
 * - resolve(): primary platform (single call, 10s timeout) -> probe URL -> fallback search;
 *   all failures return an explicit error (never silent empty string).
 * - enrichFallback(): fills fallbackUrl for the frontend <audio> onerror retry path.
 */
export class SongResolver {
  constructor(
    private adapters: AdapterMap,
    private log: (m: string) => void = (m) => console.warn('[SongResolver]', m),
    private probe?: UrlProbe,
  ) {}

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
        this.adapters[track.platform].fetchSongUrl(track.sourceId, undefined, quality),
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
    const fallbackResult = await this.resolveFallback(track);
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
  async resolveFallback(track: Track): Promise<ResolveResult | null> {
    const keyword = `${track.title} ${track.artist}`.trim();
    const sources: PlatformAdapter[] = [this.adapters.netease, this.adapters.kugou];
    for (const source of sources) {
      if (!source.searchSongs) continue;
      try {
        const candidates = await source.searchSongs(keyword, 15);
        const scored = candidates
          .map((c) => ({ candidate: c, score: matchScore(c, track) }))
          .filter((s) => s.score >= 0.55)
          .sort((a, b) => b.score - a.score);
        for (const { candidate } of scored.slice(0, 3)) {
          const albumId =
            typeof candidate.extra?.albumId === 'string' ? candidate.extra.albumId : undefined;
          const url = await withTimeout(
            source.fetchSongUrl(candidate.sourceId, albumId),
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
