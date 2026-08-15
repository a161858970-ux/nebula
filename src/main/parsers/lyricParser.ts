import type { LyricLine } from '../types';

const TIME_TAG = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
const TAG_STRIP = /\[\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?\]/g;
/** 音乐符号（♪♫ 等），解析层直接剥离，杜绝在歌词/面板里出现。 */
const NOTE_CHARS = /[♪♫♬♩𝄞𝄢♭♮]/g;

function tagToMs(m: RegExpExecArray): number {
  const min = Number(m[1]);
  const sec = Number(m[2]);
  let ms = m[3] ? Number(m[3]) : 0;
  // 兼容一位（.5=500ms）、两位（.50=500ms）与三位（.500=500ms）毫秒
  if (m[3]?.length === 1) ms *= 100;
  else if (m[3]?.length === 2) ms *= 10;
  return min * 60000 + sec * 1000 + ms;
}

/**
 * 解析 LRC 文本 → 有序时间轴数组。
 * 支持 `[mm:ss.xx]`、`[mm:ss.xxx]` 与一行多时间标签（重复歌词）。
 */
export function parseLrc(raw: string): LyricLine[] {
  if (!raw) return [];
  const out: LyricLine[] = [];
  for (const line of raw.split(/\r?\n/)) {
    TIME_TAG.lastIndex = 0;
    const times: number[] = [];
    let m: RegExpExecArray | null;
    while ((m = TIME_TAG.exec(line)) !== null) {
      times.push(tagToMs(m));
    }
    if (!times.length) continue;
    const text = line.replace(TAG_STRIP, '').replace(NOTE_CHARS, '').trim();
    for (const t of times) out.push({ timeMs: t, text });
  }
  return out.sort((a, b) => a.timeMs - b.timeMs);
}

/**
 * 双语歌词对齐：把原文 `lrc` 与翻译 `tlyric` 按 timeMs 归并。
 * 同一时间轴：翻译挂到原文的 translation 字段；翻译独有时间轴：补空原文。
 */
export function mergeLyric(lrc: string, tlyric: string): LyricLine[] {
  const primary = parseLrc(lrc);
  const secondary = parseLrc(tlyric);
  const map = new Map<number, LyricLine>();
  for (const line of primary) map.set(line.timeMs, { ...line });
  for (const line of secondary) {
    const existing = map.get(line.timeMs);
    if (existing) {
      existing.translation = line.text;
    } else {
      map.set(line.timeMs, { timeMs: line.timeMs, text: '', translation: line.text });
    }
  }
  return [...map.values()].sort((a, b) => a.timeMs - b.timeMs);
}

/**
 * 网易云 lyric_new 的 `lrc` 可能返回新版 JSON-Lines 结构（每行一个
 * `{"t":ms,"c":[{"tx":"..."}]}`），这里归一化为普通 LRC 文本，
 * 让 parseLrc / mergeLyric 无需关心来源格式。普通 LRC 原样返回。
 */
export function normalizeJsonLrc(raw: string): string {
  if (!raw) return '';
  const lines = raw.split(/\r?\n/);
  const looksJson = lines.some((l) => l.trim().startsWith('{'));
  if (!looksJson) return raw;
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (!t.startsWith('{')) continue;
    try {
      const obj = JSON.parse(t) as { t?: number; c?: Array<{ tx?: string }> };
      if (typeof obj.t !== 'number') continue;
      const text = (obj.c ?? [])
        .map((c) => c.tx ?? '')
        .join('')
        .trim();
      const min = Math.floor(obj.t / 60000);
      const sec = Math.floor((obj.t % 60000) / 1000);
      const ms = obj.t % 1000;
      out.push(`[${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(ms).padStart(3, '0')}] ${text}`);
    } catch {
      /* skip malformed line */
    }
  }
  return out.join('\n');
}

/** 从 LRC 元数据提取制作团队（作词/作曲/编曲/制作人等）。 */
const CREDIT_META =
  /^\s*(作词|作曲|编曲|制作人?|制作|混音|录音|和声|监制|出品|词曲|词|曲|配唱|吉他|贝斯|鼓手|键盘|弦乐|母带|后期)\s*[:：]\s*(.+)$/;
const CREDIT_EN =
  /^\s*(Lyrics?|Composed|Produced|Written|Mixed|Mastered|Recorded|Arranged)\s+by\s*[:：]?\s*(.+)$/i;
const CREDIT_EN_ROLE: Record<string, string> = {
  lyrics: '作词',
  composed: '作曲',
  produced: '制作',
  written: '作词',
  mixed: '混音',
  mastered: '母带',
  recorded: '录音',
  arranged: '编曲',
};

export function creditsFromLrc(lrc: string): Array<{ role: string; name: string }> {
  const out: Array<{ role: string; name: string }> = [];
  if (!lrc) return out;
  for (const line of lrc.split(/\r?\n/)) {
    const text = line.replace(/\[\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?\]/g, '').trim();
    const m = CREDIT_META.exec(text);
    if (m && m[2]) out.push({ role: m[1]!, name: m[2].trim() });
    else {
      const en = CREDIT_EN.exec(text);
      if (en && en[2]) {
        out.push({ role: CREDIT_EN_ROLE[en[1]!.toLowerCase()] ?? en[1]!, name: en[2].trim() });
      }
    }
  }
  return out;
}
