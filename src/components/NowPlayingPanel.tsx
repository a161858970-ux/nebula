import { useMemo, useState } from 'react';
import { useEffect } from 'react';
import type { WheelEvent as ReactWheelEvent } from 'react';
import { formatTime } from '../lib/audio/AudioPlayer';
import type { LyricLineUI } from '../lib/lyrics';
import { currentLyricIndex } from '../lib/lyrics';
import type { Track } from '../lib/catalog';

interface NowPlayingPanelProps {
  song: Track | null;
  playing: boolean;
  loading: boolean;
  currentTime: number;
  duration: number;
  liked: boolean;
  lines: LyricLineUI[];
  translateOn: boolean;
  onClose: () => void;
  onTogglePlay: () => void;
  onPrev: () => void;
  onNext: () => void;
  onToggleLike: () => void;
  onToggleTranslate: () => void;
  onSeek: (t: number) => void;
}

const SPLIT_WINDOW = 6;

/** 歌词上下分区：同一行在上下两区各出现一次，当前行双高亮；距焦点越远字号越小（视差）。 */
function LyricRegion({
  lines,
  currentTime,
  translateOn,
  shift,
  region,
}: {
  lines: LyricLineUI[];
  currentTime: number;
  translateOn: boolean;
  shift: number;
  region: 'top' | 'bottom';
}) {
  // playerState.currentTime 是秒，歌词 timeMs 是毫秒，这里统一换算
  const idx = useMemo(() => currentLyricIndex(lines, currentTime * 1000), [lines, currentTime]);
  // 上区：偏旧歌词（含当前行）；下区：偏新歌词（含当前行）——当前行在两个区域各出现一次
  const from = region === 'top' ? idx - SPLIT_WINDOW + shift : idx - 2 + shift;
  const to = region === 'top' ? idx + 2 + shift : idx + SPLIT_WINDOW + 1 + shift;
  const rows: Array<{ line: LyricLineUI; k: number; lineIdx: number }> = [];
  for (let i = Math.max(0, from); i < Math.min(lines.length, to); i++) {
    rows.push({ line: lines[i]!, k: i - idx, lineIdx: i });
  }

  return (
    <div className={`lp-lyrics-region is-${region}`}>
      {rows.length === 0 && <div className="lp-lyrics-empty">暂无歌词</div>}
      {rows.map(({ line, k, lineIdx }) => {
        const dist = Math.abs(k);
        const fontSize = Math.max(0.68, 1 - dist * 0.085);
        return (
          <div
            key={`${region}-${lineIdx}`}
            className={`lp-lyric-row${k === 0 ? ' is-active' : ''}`}
            style={{ fontSize: `${fontSize}em` }}
          >
            <span className="lp-lyric-text">{line.text}</span>
            {translateOn && line.translation && <span className="lp-lyric-tr">{line.translation}</span>}
          </div>
        );
      })}
    </div>
  );
}

/** Z4 二级播放窗口：覆盖全局，背景模糊；左侧旋转封面，右侧信息与控制；歌词上下分区。 */
export function NowPlayingPanel({
  song,
  playing,
  loading,
  currentTime,
  duration,
  liked,
  lines,
  translateOn,
  onClose,
  onTogglePlay,
  onPrev,
  onNext,
  onToggleLike,
  onToggleTranslate,
  onSeek,
}: NowPlayingPanelProps) {
  const [shift, setShift] = useState(0);
  const pct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  const coverBg = song
    ? `linear-gradient(135deg, hsl(${song.hue1} 70% 58%), hsl(${song.hue2} 72% 34%))`
    : 'linear-gradient(135deg, rgba(255,255,255,0.16), rgba(255,255,255,0.06))';

  const onWheelLyrics = (e: ReactWheelEvent<HTMLDivElement>) => {
    setShift((s) => Math.max(-SPLIT_WINDOW, Math.min(SPLIT_WINDOW, s + (e.deltaY > 0 ? 1 : -1))));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="now-playing-overlay"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="now-playing glass" onWheel={onWheelLyrics}>
        <button className="np-close" aria-label="关闭播放窗口" onClick={onClose}>
          ×
        </button>

        <LyricRegion lines={lines} currentTime={currentTime} translateOn={translateOn} shift={shift} region="top" />

        <div className="np-hero">
          <div className={`np-cover${playing ? ' is-spinning' : ''}`}>
            <div
              className="np-cover-img"
              style={
                song?.cover
                  ? { backgroundImage: `url(${song.cover})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                  : { background: coverBg }
              }
            />
            <span className="np-cover-hole" />
          </div>

          <div className="np-info">
            <div className="np-title">{song?.title ?? '未在播放'}</div>
            <div className="np-artist">{song?.artist ?? ''}</div>
            <div className="np-progress">
              <div className="progress-track" onClick={(e) => {
                const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
                if (duration > 0) onSeek(((e.clientX - r.left) / r.width) * duration);
              }}>
                <div className="progress-fill" style={{ width: `${pct}%` }} />
                <div className="progress-thumb" style={{ left: `${pct}%` }} />
              </div>
              <div className="np-time">
                {formatTime(currentTime)} / {formatTime(duration)}
              </div>
            </div>
            <div className="np-controls">
              <button className="ctrl-btn" aria-label="上一首" onClick={onPrev}>
                ‹‹
              </button>
              <button className="play-btn" aria-label={playing ? '暂停' : '播放'} onClick={onTogglePlay}>
                {playing ? '❚❚' : '▶'}
              </button>
              <button className="ctrl-btn" aria-label="下一首" onClick={onNext}>
                ››
              </button>
              <button className={`ctrl-btn${liked ? ' is-liked' : ''}`} aria-label="收藏" onClick={onToggleLike}>
                ♥
              </button>
              <button
                className={`ctrl-btn${translateOn ? ' is-active' : ''}`}
                aria-label="歌词翻译"
                title="外文歌词翻译开关"
                onClick={onToggleTranslate}
              >
                译
              </button>
            </div>
          </div>
        </div>

        <LyricRegion lines={lines} currentTime={currentTime} translateOn={translateOn} shift={shift} region="bottom" />
        {loading && <div className="np-loading">加载中…</div>}
      </div>
    </div>
  );
}
