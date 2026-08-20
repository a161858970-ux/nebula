import type { Track } from '../types';

/**
 * 纯函数字段映射：把各平台原始 JSON 中的不同字段统一转换为标准 Track。
 * 独立成模块便于单测；任何字段缺失都返回 null 而不是抛错。
 */

export function mapNeteaseTrack(raw: Record<string, any> | undefined | null): Track | null {
  try {
    if (!raw || raw.id == null || !raw.name) return null;
    const ar: Array<{ name?: string }> = raw.ar ?? raw.artists ?? [];
    const al: { name?: string; picUrl?: string } = raw.al ?? raw.album ?? {};
    let cover = al.picUrl ?? '';
    if (cover) {
      cover = cover.replace(/^http:/, 'https:');
      cover += cover.includes('?') ? '&' : '?';
      cover += 'param=500y500';
    }
    const duration =
      typeof raw.dt === 'number'
        ? Math.round(raw.dt / 1000)
        : typeof raw.duration === 'number'
          ? Math.round(raw.duration / 1000)
          : 0;
    return {
      id: `netease:${raw.id}`,
      title: raw.name,
      artist: ar[0]?.name ?? '未知歌手',
      artists: ar.map((a) => a.name ?? '').filter(Boolean),
      album: al.name ?? '',
      cover,
      duration,
      platform: 'netease',
      sourceId: String(raw.id),
      originalUrl: '',
      fallbackUrl: '',
    };
  } catch {
    return null;
  }
}

export function mapQQTrack(raw: Record<string, any> | undefined | null): Track | null {
  try {
    if (!raw || raw.songmid == null || !raw.songname) return null;
    const singer: Array<{ name?: string }> = raw.singer ?? [];
    const albummid: string = raw.albummid ?? '';
    return {
      id: `qq:${raw.songmid}`,
      title: raw.songname,
      artist: singer[0]?.name ?? '未知歌手',
      artists: singer.map((s) => s.name ?? '').filter(Boolean),
      album: raw.albumname ?? '',
      cover: albummid ? `https://y.gtimg.cn/music/photo_new/T002R500x500M000${albummid}.jpg` : '',
      duration: typeof raw.interval === 'number' ? raw.interval : 0,
      platform: 'qq',
      sourceId: String(raw.songmid),
      originalUrl: '',
      fallbackUrl: '',
    };
  } catch {
    return null;
  }
}

export function mapKugouTrack(raw: Record<string, any> | undefined | null): Track | null {
  try {
    if (!raw || !raw.FileHash || !raw.SongName) return null;
    return {
      id: `kugou:${raw.FileHash}`,
      title: raw.SongName,
      artist: raw.SingerName ?? '未知歌手',
      artists: (raw.SingerName ?? '').split(',').map((s: string) => s.trim()).filter(Boolean),
      album: raw.AlbumName ?? '',
      cover: '',
      duration: typeof raw.Duration === 'number' ? raw.Duration : 0,
      platform: 'kugou',
      sourceId: String(raw.FileHash),
      originalUrl: '',
      fallbackUrl: '',
      extra: {
        albumId: raw.AlbumID,
        hqHash: raw.HQFileHash || '',
        sqHash: raw.SQFileHash || '',
        resHash: raw.ResFileHash || '',
        mixSongId: raw.MixSongID || '',
        privilege: typeof raw.Privilege === 'number' ? raw.Privilege : 0,
      },
    };
  } catch {
    return null;
  }
}

/** 酷狗 mobilecdn 歌单接口字段映射（hash/songname/singername/album_id）。 */
export function mapKugouMobileTrack(raw: Record<string, any> | undefined | null): Track | null {
  try {
    if (!raw || !raw.hash || !raw.songname) return null;
    return {
      id: `kugou:${raw.hash}`,
      title: raw.songname,
      artist: raw.singername ?? '未知歌手',
      artists: (raw.singername ?? '')
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean),
      album: raw.album_name ?? '',
      cover: '',
      duration: Number(raw.duration) || 0,
      platform: 'kugou',
      sourceId: String(raw.hash),
      originalUrl: '',
      fallbackUrl: '',
      extra: { albumId: raw.album_id },
    };
  } catch {
    return null;
  }
}

/** 归一化检索文本：小写、去符号，用于标题匹配。 */
export function normalizeQuery(s: string): string {
  return s
    .toLowerCase()
    .replace(/[（(【\[].*?[）)】\]]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 时长相似度（秒，允许 ±3s 或 5% 误差，取 0~1）。 */
export function durationSimilarity(a: number, b: number): number {
  if (!(a > 0) || !(b > 0)) return 1;
  const diff = Math.abs(a - b);
  if (diff <= 3) return 1;
  const ratio = diff / Math.max(a, b);
  return Math.max(0, 1 - ratio * 3);
}

/** 标题相似度：完全一致 1，互相包含 0.85，否则 0。 */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeQuery(a);
  const nb = normalizeQuery(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.85;
  return 0;
}
