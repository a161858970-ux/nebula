import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { audioPlayer, formatTime, type PlayMode } from '../lib/audio/AudioPlayer';
import { useAudioPlayer } from '../lib/audio/useAudioPlayer';

interface BottomBarProps {
  liked: boolean;
  translateOn: boolean;
  qualities: { level: string; label: string; needsVip?: boolean; needsSvip?: boolean }[];
  quality: string;
  mode: PlayMode;
  onToggleLike: () => void;
  onToggleTranslate: () => void;
  onSelectQuality: (level: string) => void;
  onCycleMode: () => void;
  onOpenNowPlaying: () => void;
}

const SOURCE_LABEL: Record<string, string> = {
  qq: 'QQ 音乐',
  netease: '网易云音乐',
  kugou: '酷狗音乐',
  demo: '演示歌单',
};

/* ---------- 图标 ---------- */

const IconPrev = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
    <path d="M6 5h2v14H6V5zm3.2 7 8.3 6.2V5.8L9.2 12z" />
  </svg>
);

const IconNext = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
    <path d="M16 5h2v14h-2V5zm-8.2 7 8.3-6.2v12.4L7.8 12z" />
  </svg>
);

const IconPlay = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
    <path d="M8 5v14l11-7z" />
  </svg>
);

const IconPause = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
    <path d="M7 5h3.5v14H7V5zm6.5 0H17v14h-3.5V5z" />
  </svg>
);

const IconHeart = ({ filled }: { filled: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill={filled ? 'currentColor' : 'none'}
    stroke="currentColor"
    strokeWidth="2"
    aria-hidden="true"
  >
    <path d="M12 21s-7.5-4.7-10-9.3C.6 8.4 2.6 5 6 5c2 0 3.3 1 4 2 .7-1 2-2 4-2 3.4 0 5.4 3.4 4 6.7C19.5 16.3 12 21 12 21z" />
  </svg>
);

const IconVolume = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
    <path d="M3 9v6h4l5 4V5L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z" />
  </svg>
);

const IconMore = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
    <circle cx="5" cy="12" r="1.8" />
    <circle cx="12" cy="12" r="1.8" />
    <circle cx="19" cy="12" r="1.8" />
  </svg>
);

/* ---------- 可拖拽进度条 ---------- */

interface ProgressBarProps {
  current: number;
  duration: number;
  disabled: boolean;
  onSeek: (t: number) => void;
}

function ProgressBar({ current, duration, disabled, onSeek }: ProgressBarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const lastXRef = useRef(0);
  const seekTimerRef = useRef<number | null>(null);
  const pct = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;

  const seekFrom = (clientX: number) => {
    const el = ref.current;
    if (!el || duration <= 0) return;
    const rect = el.getBoundingClientRect();
    onSeek(((clientX - rect.left) / rect.width) * duration);
  };

  // 拖拽 seek 节流（约 80ms 一次），避免拖动时高频 set currentTime 造成明显卡顿
  const scheduleSeek = () => {
    if (seekTimerRef.current !== null) return;
    seekTimerRef.current = window.setTimeout(() => {
      seekTimerRef.current = null;
      seekFrom(lastXRef.current);
    }, 80);
  };
  const flushSeek = () => {
    if (seekTimerRef.current !== null) {
      window.clearTimeout(seekTimerRef.current);
      seekTimerRef.current = null;
      seekFrom(lastXRef.current);
    }
  };

  return (
    <div
      ref={ref}
      className={`progress-track${dragging ? ' is-dragging' : ''}${disabled ? ' is-disabled' : ''}`}
      onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => {
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        lastXRef.current = e.clientX;
        seekFrom(e.clientX);
      }}
      onPointerMove={(e: ReactPointerEvent<HTMLDivElement>) => {
        if (dragging) {
          lastXRef.current = e.clientX;
          scheduleSeek();
        }
      }}
      onPointerUp={() => {
        flushSeek();
        setDragging(false);
      }}
      onPointerCancel={() => {
        flushSeek();
        setDragging(false);
      }}
    >
      <div className="progress-fill" style={{ width: `${pct}%` }} />
      <div className="progress-thumb" style={{ left: `${pct}%` }} />
    </div>
  );
}

/* ---------- 音质选择（点击外部自动关闭） ---------- */

interface QualityMenuProps {
  options: { level: string; label: string; needsVip?: boolean; needsSvip?: boolean }[];
  current: string;
  disabled: boolean;
  onSelect: (level: string) => void;
}

function QualityMenu({ options, current, disabled, onSelect }: QualityMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ref.current && !ref.current.contains(t)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const currentLabel = options.find((o) => o.level === current)?.label ?? (current ? current : '音质');

  return (
    <div className="quality-menu" ref={ref}>
      <button
        className="ctrl-btn"
        disabled={disabled || options.length === 0}
        title="音质"
        onClick={() => setOpen((v) => !v)}
      >
        {currentLabel.length > 4 ? `${currentLabel.slice(0, 4)}…` : currentLabel}
      </button>
      {open && (
        <div className="quality-pop">
          {options.map((o) => (
            <button
              key={o.level}
              className={`quality-item${o.level === current ? ' is-current' : ''}`}
              onClick={() => {
                onSelect(o.level);
                setOpen(false);
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- 底部播放条 ---------- */

export function BottomBar({
  liked,
  translateOn,
  qualities,
  quality,
  mode,
  onToggleLike,
  onToggleTranslate,
  onSelectQuality,
  onCycleMode,
  onOpenNowPlaying,
}: BottomBarProps) {
  const state = useAudioPlayer();
  const hasSong = !!state.song;
  const coverBg = state.song
    ? `linear-gradient(135deg, hsl(${state.song.hue1} 70% 58%), hsl(${state.song.hue2} 72% 34%))`
    : 'linear-gradient(135deg, rgba(255,255,255,0.16), rgba(255,255,255,0.06))';
  const coverStyle = state.song?.cover
    ? { backgroundImage: `url(${state.song.cover})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : { background: coverBg };

  return (
    <footer className={`bottom-bar${state.loading ? ' is-loading' : ''}`}>
      <button
        className="now-cover"
        style={coverStyle}
        aria-label="打开播放窗口"
        disabled={!hasSong}
        onClick={onOpenNowPlaying}
      />

      <div className="now-meta">
        <div className="now-title">{state.song?.title ?? '未在播放'}</div>
        <div className="now-artist">
          {state.song
            ? `${state.song.artist} · ${SOURCE_LABEL[state.song.source] ?? state.song.source}`
            : '点击星云卡片开始播放'}
        </div>
      </div>

      <div className="now-progress">
        <ProgressBar
          current={state.currentTime}
          duration={state.duration}
          disabled={!hasSong}
          onSeek={(t) => audioPlayer.seek(t)}
        />
        <div className="now-time">
          {formatTime(state.currentTime)} / {formatTime(state.duration)}
        </div>
        {state.error && <div className="now-error">⚠ {state.error}</div>}
      </div>

      <div className="now-controls">
        <button className="ctrl-btn" aria-label="上一首" disabled={!hasSong} onClick={() => audioPlayer.prev()}>
          <IconPrev />
        </button>
        <button
          className="play-btn"
          aria-label={state.playing ? '暂停' : '播放'}
          disabled={!hasSong}
          onClick={() => audioPlayer.toggle()}
        >
          {state.playing ? <IconPause /> : <IconPlay />}
        </button>
        <button className="ctrl-btn" aria-label="下一首" disabled={!hasSong} onClick={() => audioPlayer.next()}>
          <IconNext />
        </button>
        <button className={`ctrl-btn${liked ? ' is-liked' : ''}`} aria-label="收藏" disabled={!hasSong} onClick={onToggleLike}>
          <IconHeart filled={liked} />
        </button>
        <button
          className={`ctrl-btn${translateOn ? ' is-active' : ''}`}
          aria-label="歌词翻译"
          title="外文歌词翻译开关"
          onClick={onToggleTranslate}
        >
          译
        </button>
        <button
          className={`ctrl-btn mode-btn${mode === 'random' ? ' is-active' : ''}`}
          aria-label="播放模式"
          title="播放模式：顺序 → 单曲循环 → 随机"
          disabled={!hasSong}
          onClick={onCycleMode}
        >
          {mode === 'sequential' ? '顺序' : mode === 'repeat-one' ? '单曲' : '随机'}
        </button>
        <QualityMenu options={qualities} current={quality} disabled={!hasSong} onSelect={onSelectQuality} />
        <div className="vol-group">
          <button className="ctrl-btn" aria-label="静音" disabled={!hasSong} onClick={() => audioPlayer.toggleMute()}>
            <IconVolume />
          </button>
          <input
            className="vol-slider"
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={state.muted ? 0 : state.volume}
            disabled={!hasSong}
            aria-label="音量"
            onChange={(e) => {
              const v = Number(e.target.value);
              audioPlayer.setVolume(v);
              if (v > 0 && state.muted) audioPlayer.toggleMute();
            }}
          />
        </div>
        <button className="ctrl-btn" aria-label="更多设置" title="更多设置（后续版本）">
          <IconMore />
        </button>
      </div>
    </footer>
  );
}
