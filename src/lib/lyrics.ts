export interface LyricWordUI {
  /** Single word / char text. */
  text: string;
  /** Absolute start ms on the song timeline. */
  startMs: number;
  /** Word duration ms. */
  duration: number;
}

export interface LyricLineUI {
  timeMs: number;
  text: string;
  translation?: string;
  /** Line duration ms (from YRC/QRC or inferred from the next line). */
  duration?: number;
  /** Word-level timings; absent → whole-line highlight fallback. */
  words?: LyricWordUI[];
}

/** 二分查找当前播放进度对应的歌词行下标。 */
export function currentLyricIndex(lines: LyricLineUI[], timeMs: number): number {
  if (!lines.length) return -1;
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lines[mid]!.timeMs <= timeMs) lo = mid;
    else hi = mid - 1;
  }
  return lines[lo]!.timeMs <= timeMs ? lo : -1;
}

/** 行级 LRC 时间标签 [mm:ss.xxx]。 */
const LRC_TAG = /\[(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
/** YRC 风格行标签 [startMs,durMs]。 */
const MS_TAG = /^\[(\d+)(?:,(\d+))?\]/;
/** 字级词块 (startMs,durMs,flag)text。 */
const WORD_GROUP = /\((\d+),(\d+)(?:,(\d+))?\)([^()[\]]*)/g;

function lrcTagToMs(min: string, sec: string, frac?: string): number {
  let ms = frac ? Number(frac) : 0;
  if (frac?.length === 1) ms *= 100;
  else if (frac?.length === 2) ms *= 10;
  return Number(min) * 60000 + Number(sec) * 1000 + ms;
}

/**
 * 字级歌词统一解析器：兼容三种输入
 * 1) 网易云 YRC：`[12580,3470](12580,250,0)难(12830,300,0)以…`
 * 2) QQ QRC：`[00:13.54](0,0,0)我(105,160,0)想…`（相对偏移，正则不完美但可跑）
 * 3) 网易云新版 JSON-Lines：每行 `{"t":ms,"c":[{"tx":"字","t":偏移,"d":时长}]}`
 */
export function parseYrcText(raw: string): Array<{ timeMs: number; duration: number; words: LyricWordUI[] }> {
  if (!raw) return [];
  const out: Array<{ timeMs: number; duration: number; words: LyricWordUI[] }> = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith('{')) {
      try {
        const obj = JSON.parse(t) as { t?: number; c?: Array<{ tx?: string; t?: number; d?: number }> };
        if (typeof obj.t !== 'number') continue;
        const chunks = obj.c ?? [];
        const words: LyricWordUI[] = [];
        let offset = 0;
        for (const c of chunks) {
          const text = (c.tx ?? '').replace(/[♪♫♬♩𝄞𝄢♭♮]/g, '').trim();
          if (!text) continue;
          if (typeof c.t === 'number') offset = c.t;
          words.push({ text, startMs: obj.t + offset, duration: c.d ?? 0 });
          if (typeof c.d === 'number') offset += c.d;
        }
        if (words.length) out.push({ timeMs: obj.t, duration: 0, words });
        continue;
      } catch {
        /* fall through to text parsing */
      }
    }
    let lineStart: number | null = null;
    let lineDur = 0;
    const msTag = t.match(MS_TAG);
    if (msTag) {
      lineStart = Number(msTag[1]);
      lineDur = msTag[2] ? Number(msTag[2]) : 0;
    } else {
      LRC_TAG.lastIndex = 0;
      const lrcTag = LRC_TAG.exec(t);
      if (lrcTag) lineStart = lrcTagToMs(lrcTag[1]!, lrcTag[2]!, lrcTag[3]);
    }
    WORD_GROUP.lastIndex = 0;
    const words: LyricWordUI[] = [];
    let m: RegExpExecArray | null;
    while ((m = WORD_GROUP.exec(t)) !== null) {
      const text = (m[4] ?? '').replace(/[♪♫♬♩𝄞𝄢♭♮]/g, '').trim();
      if (!text) continue;
      const ws = Number(m[1]);
      const wd = Number(m[2]);
      // YRC 字时间戳是绝对毫秒；QRC 是相对行首偏移 → 启发式归一
      const start = lineStart != null && ws < lineStart ? lineStart + ws : ws;
      words.push({ text, startMs: start, duration: wd });
    }
    if (!words.length) {
      if (lineStart == null) continue;
      // 无逐字数据：整行当单个词
      const text = t
        .replace(/\[\d{1,2}:\d{1,2}(?:[.:]\d{1,3})?\]/g, '')
        .replace(/[♪♫♬♩𝄞𝄢♭♮]/g, '')
        .trim();
      if (!text) continue;
      words.push({ text, startMs: lineStart, duration: lineDur || 4000 });
    }
    if (lineStart == null) lineStart = words[0]!.startMs;
    out.push({ timeMs: lineStart, duration: lineDur, words });
  }
  out.sort((a, b) => a.timeMs - b.timeMs);
  // 补齐缺失的行时长（取下一行起点差，封顶 12s）
  for (let i = 0; i < out.length; i++) {
    if (out[i]!.duration > 0) continue;
    const next = out[i + 1]?.timeMs;
    const dur = next != null ? Math.min(12000, Math.max(1200, next - out[i]!.timeMs)) : 6000;
    out[i]!.duration = dur;
  }
  return out;
}

/**
 * 把后端返回的 yrc/qrc 字级数据与 LRC 行合并。
 * 以逐字行为骨架（部分歌曲正文只在 yrc 里，lrc 只有元数据），
 * LRC 负责补充文本/翻译，未被 yrc 覆盖的行原样保留。
 */
export function mergeWordLyrics(lines: LyricLineUI[], rawYrc: string): LyricLineUI[] {
  if (!rawYrc || !lines.length) return lines;
  const wordLines = parseYrcText(rawYrc);
  if (!wordLines.length) return lines;
  const norm = (s: string): string =>
    s
      .toLowerCase()
      .replace(/[\s，。！？、,.!?'"·\-—–()（）]/g, '');
  const joinWords = (words: LyricWordUI[]): string => {
    const latin = words.every((w) => /^[A-Za-z0-9'’\- ]+$/.test(w.text));
    return latin ? words.map((w) => w.text).join(' ') : words.map((w) => w.text).join('');
  };
  const out: LyricLineUI[] = [];
  for (const wl of wordLines) {
    // 只挂到有正文的行，翻译独行（text 为空）不接收逐字，避免翻译被放大显示
    let match = lines.find((l) => l.text && Math.abs(l.timeMs - wl.timeMs) <= 80);
    if (!match) {
      // 跨源补的 yrc 时间轴可能与 lrc 有偏差：放宽窗口并按正文比对，避免“粘连词一闪而过”
      const wtext = norm(joinWords(wl.words));
      if (wtext) {
        match = lines.find(
          (l) => Math.abs(l.timeMs - wl.timeMs) <= 1800 && norm(l.text) === wtext,
        );
      }
    }
    if (!match) {
      // 文本/时间都配不上（如 QQ/网易云不同歌词版本）：
      // 就近挂到最近正文行用其文本显示；无正文行则丢弃该逐字行
      const near = lines
        .filter((l) => l.text && Math.abs(l.timeMs - wl.timeMs) <= 2500)
        .sort((a, b) => Math.abs(a.timeMs - wl.timeMs) - Math.abs(b.timeMs - wl.timeMs))[0];
      if (!near) continue;
      match = near;
    }
    out.push({
      timeMs: match?.timeMs ?? wl.timeMs,
      text: match?.text ?? joinWords(wl.words),
      duration: wl.duration || match?.duration,
      translation: match?.translation,
      words: wl.words,
    });
  }
  for (const l of lines) {
    if (!out.some((o) => Math.abs(o.timeMs - l.timeMs) <= 80)) out.push(l);
  }
  return out.sort((a, b) => a.timeMs - b.timeMs);
}

/** 中/日文歌词“配料表”行（作词/作曲/编曲/演唱/词:/曲:/歌詞/訳詞…）。 */
const CREDIT_CN =
  /^(作词|作曲|编曲|作詞|作曲|歌詞|訳詞|制作人?|制作|演唱|原唱|翻唱|混音|录音|和声|合声|监制|出品|发行|企划|文案|封面|设计|导演|词曲|词|曲|吉他|贝斯|鼓手?|键盘|弦乐|母带|后期|编辑|版权|配唱|配乐|统筹|混录|母带处理|音乐制作|录音室|发行公司|版权方|词曲版权|录音版权|词曲唱)\s*[:：]/;
/** 英文/拼音歌词“配料表”行（Lyrics by / Composed by / OP: / SP:…）。 */
const CREDIT_EN =
  /^(lyrics?|composed|composer|produced|producer|written|writer|mixed|mastered|recorded|arranged|engineered|programmed|published|performed|vocals?|backing vocals?|executive producer|additional|guitar|bass|drums?|keyboards?|strings?|piano|chorus|background vocals?)\b(\s*by|\s*[:：])/i;
const CREDIT_OP_SP = /^(op|sp)\s*[:：]/i;
/** 纯音乐符号行（♪♫…）。 */
const NOTE_ONLY = /^[♪♫♬♩𝄞𝄢♭♮\s]+$/;
const NOTE_CHARS = /[♪♫♬♩𝄞𝄢♭♮]/g;

/**
 * 过滤歌词“配料表”（作词/作曲/编曲/演唱、Lyrics by/Composed by/OP/SP 等）
 * 与空行、纯音符行，保证 Z1 直接从歌词正文开始。
 */
export function filterCreditLines(lines: LyricLineUI[], title?: string, artist?: string): LyricLineUI[] {
  const out: LyricLineUI[] = [];
  let droppedHeader = 0;
  let sawText = false;
  for (const l of lines) {
    const text = (l.text ?? '').replace(NOTE_CHARS, '').trim();
    if (!text) {
      // 翻译独行（原文为空、仅有翻译）保留，供主歌词下方展示；开头的先丢弃
      if (l.translation && sawText) out.push({ ...l, text: '' });
      continue;
    }
    if (NOTE_ONLY.test(text)) continue;
    if (CREDIT_CN.test(text) || CREDIT_EN.test(text) || CREDIT_OP_SP.test(text)) continue;
    // 开头“歌名 - 歌手”标题行：仅清正文开始前的最多 2 行
    if (
      droppedHeader < 2 &&
      / - /.test(text) &&
      ((title && text.includes(title)) || (artist && text.includes(artist)))
    ) {
      droppedHeader++;
      continue;
    }
    sawText = true;
    out.push(text === l.text ? l : { ...l, text });
  }
  return out;
}
