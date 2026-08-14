import { mulberry32 } from '../rng';
import { generateTracks } from '../catalog';
import type { Track } from '../catalog';
import { SAMPLE_AUDIO, sampleAudioFor } from '../audio/sampleUrls';
import { hasDesktopAPI, toFrontendTrack } from './ipcClient';

export interface ResolvePlaylistResult {
  adapterName: string;
  songs: Track[];
  /** true = 浏览器模拟解析（无 Electron 主进程时的兜底数据）。 */
  simulated: boolean;
  note?: string;
}

export interface PlaylistAdapter {
  id: string;
  name: string;
  match: (input: string) => boolean;
  /** 模拟解析：真实 QQ/网易云接口需鉴权与跨域授权，这里按链接 ID 确定性生成可播歌曲。 */
  parse: (input: string) => Promise<Track[]>;
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** FNV-1a 字符串哈希：同一歌单链接永远解析出同一份歌单。 */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function extractId(input: string, patterns: RegExp[]): string {
  for (const re of patterns) {
    const m = input.match(re);
    if (m?.[1]) return m[1];
  }
  return String(hashStr(input));
}

/** 模拟生成歌单：数量 80~200 首，元数据与音频地址由链接 ID 确定性派生。 */
function simulatePlaylist(id: string, source: string): Track[] {
  const seed = hashStr(id);
  const rng = mulberry32(seed);
  const count = 80 + (seed % 121);
  // 音频池按链接 hash 错开起点，避免所有模拟歌单都从同一首测试音频开始
  return generateTracks(rng, count, source, seed % SAMPLE_AUDIO.length);
}

export const qqMusicAdapter: PlaylistAdapter = {
  id: 'qq',
  name: 'QQ 音乐',
  match: (input) => /(y\.qq\.com|music\.qq\.com|i\.y\.qq\.com)|playlist\//i.test(input),
  parse: async (input) => {
    await delay(700 + Math.random() * 500);
    const id = extractId(input, [/playlist\/(\d+)/i, /[?&](?:p|list|id)=(\d+)/i]);
    return simulatePlaylist(`qq:${id}`, 'qq');
  },
};

export const neteaseMusicAdapter: PlaylistAdapter = {
  id: 'netease',
  name: '网易云音乐',
  match: (input) => /music\.163\.com/.test(input),
  parse: async (input) => {
    await delay(700 + Math.random() * 500);
    const id = extractId(input, [/(?:playlist|songlist)[^0-9]*(\d+)/i, /[?&]id=(\d+)/i]);
    return simulatePlaylist(`netease:${id}`, 'netease');
  },
};

/** 演示歌单：复刻参考 demo 的 16 首歌，音频用免版权直链。 */
const DEMO_ROWS: [string, string][] = [
  ['Beyond (feat. somunia)', 'Dotnoi / Tom-i'],
  ['Rainbow', 'Couple N'],
  ['Evergreen', 'Teeya / Nyamu'],
  ['My Darling', 'FLAVOREALM / Dyako'],
  ['Midnight Starlight', 'Aero'],
  ['Cyber Neon', 'Kitsune'],
  ['Lapping Gamin', 'Vocaloid'],
  ['Tropical Love', 'Summer Vibe'],
  ['Resonance', 'HOME'],
  ['Blinding Lights', 'The Weeknd'],
  ['Starboy', 'The Weeknd'],
  ['Faded', 'Alan Walker'],
  ['Sunflower', 'Post Malone'],
  ['Something Like This', 'Daft Punk'],
  ['Resonance (Re-vibe)', 'HOME'],
  ['Neon City', 'Synthwave'],
];

export const DEMO_SONGS: Track[] = DEMO_ROWS.map(([title, artist], i) => ({
  id: i,
  title,
  artist,
  style: 'Demo',
  hue1: (i * 47) % 360,
  hue2: (i * 97 + 60) % 360,
  audio: sampleAudioFor(i),
  source: 'demo',
}));

export const demoAdapter: PlaylistAdapter = {
  id: 'demo',
  name: '演示歌单',
  match: () => true,
  parse: async () => {
    await delay(450 + Math.random() * 300);
    return DEMO_SONGS.map((s) => ({ ...s }));
  },
};

const ADAPTERS: PlaylistAdapter[] = [qqMusicAdapter, neteaseMusicAdapter, demoAdapter];

export async function resolvePlaylist(
  input: string,
): Promise<ResolvePlaylistResult> {
  const url = input.trim();

  // 桌面端（Electron）：优先走主进程真实适配器
  if (hasDesktopAPI()) {
    const res = await window.nebulaAPI!.importPlaylist(url);
    if (!res.ok) throw new Error(res.error);
    return {
      adapterName: res.data.platformName,
      songs: res.data.tracks.map((t, i) => toFrontendTrack(t, i)),
      simulated: false,
    };
  }

  // 浏览器降级：模拟解析（无主进程，无法请求平台接口）
  for (const adapter of ADAPTERS) {
    if (adapter.match(url)) {
      const songs = await adapter.parse(url);
      return {
        adapterName: adapter.name,
        songs,
        simulated: true,
        note: `浏览器模式为模拟数据（演示音频）；运行桌面版可解析真实「${adapter.name}」歌单`,
      };
    }
  }
  const songs = await demoAdapter.parse(url);
  return {
    adapterName: demoAdapter.name,
    songs,
    simulated: true,
    note: '无法识别的歌单链接，已加载演示歌单；请粘贴 网易云/QQ音乐 歌单链接，或运行桌面版',
  };
}
