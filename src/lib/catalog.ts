import type { RNG } from './rng';
import { int, pick } from './rng';
import { sampleAudioFor } from './audio/sampleUrls';

const TITLE_A = [
  'Midnight', 'Neon', 'Crystal', 'Velvet', 'Solar', 'Lunar', 'Chrome',
  'Silk', 'Cosmic', 'Electric', 'Golden', 'Frozen', 'Wild', 'Soft',
  'Urban', 'Hollow', 'Liquid', 'Starlit', 'Paper', 'Glass',
] as const;

const TITLE_B = [
  'Dreams', 'Horizon', 'Mirage', 'Signal', 'Bloom', 'Echo', 'Pulse',
  'Drift', 'Glow', 'Motion', 'Waves', 'Flame', 'Rain', 'City',
  'Garden', 'Static', 'Haze', 'Orbit', 'Vapor', 'Nocturne',
] as const;

const ARTIST_A = [
  'Aurora', 'Nova', 'Kai', 'Mira', 'Luna', 'Rex', 'Iris', 'Noir',
  'Juno', 'Vale', 'Onyx', 'Zephyr', 'Sable', 'Lyra', 'Echo',
] as const;

const ARTIST_B = [
  'Waves', 'Systems', 'District', 'Tape', 'Club', 'Lab', 'Sky',
  'Union', 'Pulse', 'Field', 'Collective', 'Orchestra', 'Radio', 'Grid',
] as const;

const STYLES = [
  'Dream Pop', 'Synthwave', 'Ambient', 'Lo-Fi', 'Future Bass', 'Neo Soul',
  'Vaporwave', 'Chillhop', 'Progressive House', 'Cinematic', 'Jazz Fusion',
] as const;

export interface Track {
  id: number;
  title: string;
  artist: string;
  style: string;
  hue1: number;
  hue2: number;
  /** 音频直链（MP3 CDN）。 */
  audio: string;
  /** 来源：qq / netease / demo 等。 */
  source: string;
  /** 平台内歌曲 ID（桌面端解析后回填）。 */
  sourceId?: string;
  album?: string;
  cover?: string;
  duration?: number;
  /** 是否为试听片段（freeTrialInfo）。 */
  trial?: boolean;
  /** 试听片段结束时间（毫秒）。 */
  trialEndTime?: number;
  /** Current quality tier (netease level / qq flac|320k|128k). */
  quality?: string;
}

/** 伪随机生成整片“星云”的歌单（封面配色、标题、艺人全部确定性生成，零网络依赖）。 */
export function generateTracks(
  rng: RNG,
  count: number,
  source: string = 'demo',
  audioOffset: number = 0,
): Track[] {
  const tracks: Track[] = [];
  for (let i = 0; i < count; i++) {
    const hue1 = int(rng, 0, 359);
    const hue2 = (hue1 + int(rng, 40, 140)) % 360;
    tracks.push({
      id: i,
      title: `${pick(rng, TITLE_A)} ${pick(rng, TITLE_B)}`,
      artist: `${pick(rng, ARTIST_A)} ${pick(rng, ARTIST_B)}`,
      style: pick(rng, STYLES),
      hue1,
      hue2,
      audio: sampleAudioFor(i + audioOffset),
      source,
    });
  }
  return tracks;
}
