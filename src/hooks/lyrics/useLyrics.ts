import { useCallback, useEffect, useRef, useState } from 'react';
import { audioPlayer } from '../../lib/audio/AudioPlayer';
import { hasDesktopAPI, toBackendTrack } from '../../lib/playlist/ipcClient';
import { filterCreditLines, mergeWordLyrics, type LyricLineUI } from '../../lib/lyrics';
import type { LyricVisualSettings } from '../../lib/lyricSettings';
import type { Track } from '../../lib/catalog';

/** 后端歌词结果（unknown）防御性归一化。 */
function normalizeLyricLines(data: unknown, title?: string, artist?: string): LyricLineUI[] {
  if (!data || typeof data !== 'object') return [];
  const lines = (data as { lines?: unknown }).lines;
  if (!Array.isArray(lines)) return [];
  const out: LyricLineUI[] = [];
  for (const raw of lines) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as { timeMs?: unknown; text?: unknown; translation?: unknown };
    if (typeof r.timeMs !== 'number' || typeof r.text !== 'string') continue;
    out.push({
      timeMs: r.timeMs,
      text: r.text,
      translation: typeof r.translation === 'string' && r.translation ? r.translation : undefined,
    });
  }
  if (!out.length) return out;
  // 逐字歌词：yrc 优先，QQ 的 qrc 直接映射进 yrc 统一解析
  const src = data as { yrc?: unknown; qrc?: unknown };
  const yrc = typeof src.yrc === 'string' ? src.yrc : '';
  const qrc = typeof src.qrc === 'string' ? src.qrc : '';
  return filterCreditLines(mergeWordLyrics(out, yrc || qrc), title, artist);
}

function loadLyricSettings(): LyricVisualSettings {
  const maxFont = Math.max(28, Math.round((typeof window !== 'undefined' ? window.innerHeight : 900) / 4));
  let fontSize = 24;
  let highlightStyle: LyricVisualSettings['highlightStyle'] = 'sweep';
  let layerMode: LyricVisualSettings['layerMode'] = 'under';
  let currentScale = 1.22;
  let wordRise = 4;
  let lyricLayout: LyricVisualSettings['lyricLayout'] = 'stacked';
  let lyricColorSource: LyricVisualSettings['lyricColorSource'] = 'cover';
  let customColor = '#3aa0ff';
  let bold = false;
  try {
    const s = typeof localStorage !== 'undefined' ? localStorage.getItem('music-nebula.lyric-settings') : null;
    if (s) {
      const p = JSON.parse(s) as Partial<LyricVisualSettings>;
      if (typeof p.fontSize === 'number' && p.fontSize >= 14 && p.fontSize <= maxFont) fontSize = p.fontSize;
      if (p.highlightStyle === 'sweep' || p.highlightStyle === 'float') highlightStyle = p.highlightStyle;
      if (p.layerMode === 'under' || p.layerMode === 'over') layerMode = p.layerMode;
      if (typeof p.currentScale === 'number' && p.currentScale >= 1 && p.currentScale <= 1.6) currentScale = p.currentScale;
      if (typeof p.wordRise === 'number' && p.wordRise >= 0 && p.wordRise <= 12) wordRise = p.wordRise;
      if (p.lyricLayout === 'stacked' || p.lyricLayout === 'offset') lyricLayout = p.lyricLayout;
      if (p.lyricColorSource === 'cover' || p.lyricColorSource === 'custom') lyricColorSource = p.lyricColorSource;
      if (typeof p.customColor === 'string' && /^#?[0-9a-f]{6}$/i.test(p.customColor)) customColor = p.customColor;
      if (p.bold === true) bold = true;
    }
  } catch {
    /* 用默认值 */
  }
  return { fontSize, highlightStyle, layerMode, currentScale, wordRise, lyricLayout, lyricColorSource, customColor, bold };
}

/**
 * 歌词领域（docs/ARCHITECTURE.md §2）：
 * 运行态（lyricLines 拉取/归一化，随切歌）+ 设置（lyricSettings 持久化）+ 翻译开关。
 * 只依赖 service（audioPlayer / IPC / lib/lyrics），不依赖其他 hook。
 */
export function useLyrics() {
  const [lyricLines, setLyricLines] = useState<LyricLineUI[]>([]);
  const [lyricSettings, setLyricSettings] = useState<LyricVisualSettings>(loadLyricSettings);
  const [lyricTranslationEnabled, setLyricTranslationEnabled] = useState(
    () => typeof localStorage === 'undefined' || localStorage.getItem('music-nebula.lyric-translate') !== '0',
  );

  // 随切歌拉取歌词：低频订阅（仅歌曲身份变化时触发）
  const songRef = useRef<Track | null>(null);
  useEffect(() => {
    const load = async (song: Track | null) => {
      if (!song) {
        setLyricLines([]);
        return;
      }
      if (!hasDesktopAPI() || !song.sourceId) {
        setLyricLines([]);
        return;
      }
      try {
        const res = await window.nebulaAPI!.fetchLyric(toBackendTrack(song));
        const lines = normalizeLyricLines(res.ok ? res.data : null, song.title, song.artist);
        setLyricLines(lines);
      } catch {
        setLyricLines([]);
      }
    };
    const check = () => {
      const s = audioPlayer.getState().song;
      if (s !== songRef.current) {
        songRef.current = s;
        void load(s);
      }
    };
    check();
    return audioPlayer.subscribe(check);
  }, []);

  const persistLyricSettings = useCallback((next: LyricVisualSettings) => {
    setLyricSettings(next);
    try {
      localStorage.setItem('music-nebula.lyric-settings', JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const patchSettings = useCallback(
    (patch: Partial<LyricVisualSettings>) => persistLyricSettings({ ...lyricSettings, ...patch }),
    [lyricSettings, persistLyricSettings],
  );

  const handleLyricFontSize = useCallback((n: number) => patchSettings({ fontSize: n }), [patchSettings]);
  const handleHighlightStyle = useCallback(
    (s: LyricVisualSettings['highlightStyle']) => patchSettings({ highlightStyle: s }),
    [patchSettings],
  );
  const handleLayerMode = useCallback(
    (m: LyricVisualSettings['layerMode']) => patchSettings({ layerMode: m }),
    [patchSettings],
  );
  const handleCurrentScale = useCallback((n: number) => patchSettings({ currentScale: n }), [patchSettings]);
  const handleWordRise = useCallback((n: number) => patchSettings({ wordRise: n }), [patchSettings]);
  const handleLyricLayout = useCallback(
    (m: LyricVisualSettings['lyricLayout']) => patchSettings({ lyricLayout: m }),
    [patchSettings],
  );
  const handleLyricColorSource = useCallback(
    (s: LyricVisualSettings['lyricColorSource']) => patchSettings({ lyricColorSource: s }),
    [patchSettings],
  );
  const handleCustomColor = useCallback((c: string) => patchSettings({ customColor: c }), [patchSettings]);
  const handleLyricBold = useCallback((b: boolean) => patchSettings({ bold: b }), [patchSettings]);

  const toggleTranslation = useCallback(() => {
    setLyricTranslationEnabled((v) => {
      const next = !v;
      try {
        localStorage.setItem('music-nebula.lyric-translate', next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  return {
    lyricLines,
    lyricSettings,
    lyricTranslationEnabled,
    handleLyricFontSize,
    handleHighlightStyle,
    handleLayerMode,
    handleCurrentScale,
    handleWordRise,
    handleLyricLayout,
    handleLyricColorSource,
    handleCustomColor,
    handleLyricBold,
    toggleTranslation,
  };
}
