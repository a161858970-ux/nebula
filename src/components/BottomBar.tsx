import { useRef, useState, type WheelEvent } from 'react';
import { audioPlayer, formatTime, type PlayMode } from '../lib/audio/AudioPlayer';
import { useAudioPlayer } from '../lib/audio/useAudioPlayer';

interface BottomBarProps {
  translateOn: boolean;
  qualities: { level: string; label: string }[];
  quality: string;
  mode: PlayMode;
  onToggleTranslate: () => void;
  onSelectQuality: (level: string) => void;
  onCycleMode: () => void;
  onOpenNowPlaying: () => void;
  onOpenComments: () => void;
  onOpenSongDetail: () => void;
  onOpenArtist: (artistName: string) => void;
}

const MODE_ICON = {
  sequential: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M17 5v14h-2V7H8v12H6V5h11zM4 11h9v2H4v-2z" transform="translate(0 0) scale(-1 1) translate(-24 0)" />
    </svg>
  ),
  'repeat-one': (
    <span className="mode-repeat-one">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
        <path d="M17 5v14h-2V7H8v12H6V5h11zM4 11h9v2H4v-2z" transform="translate(0 0) scale(-1 1) translate(-24 0)" />
      </svg>
      <em>1</em>
    </span>
  ),
  random: (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M5 7h3.2l7.5 10H19a1 1 0 0 1 0 2h-3.2L8.3 9H5a1 1 0 0 1 0-2zm0 10h3.2L13 10.6l1.4 1.9L9.6 19H5a1 1 0 0 1 0-2zM19 5h-3.2L10.6 11l-1.4-1.9L14.4 5H19a1 1 0 0 1 0 2z" />
    </svg>
  ),
};

const SOURCE_LABEL: Record<string, string> = {
  qq: 'QQ 音乐',
  netease: '网易云音乐',
  kugou: '酷狗音乐',
  demo: '演示歌单',
};

function IconComments() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M4 4h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm2 4v1h12V8H6zm0 4v1h8v-1H6z" />
    </svg>
  );
}

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
  const timerRef = useRef<number | null>(null);
  const pct = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;
  const seekFrom = (clientX: number) => {
    const el = ref.current;
    if (!el || duration <= 0) return;
    const rect = el.getBoundingClientRect();
    onSeek(((clientX - rect.left) / rect.width) * duration);
  };
  const schedule = () => {
    if (timerRef.current !== null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      seekFrom(lastXRef.current);
    }, 80);
  };
  const flush = () => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
      seekFrom(lastXRef.current);
    }
  };
  return (
    <div
      ref={ref}
      className={`progress-track${dragging ? ' is-dragging' : ''}${disabled ? ' is-disabled' : ''}`}
      onPointerDown={(e) => {
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
        lastXRef.current = e.clientX;
        seekFrom(e.clientX);
      }}
      onPointerMove={(e) => {
        if (dragging) {
          lastXRef.current = e.clientX;
          schedule();
        }
      }}
      onPointerUp={flush}
      onPointerCancel={flush}
    >
      <div className="progress-fill" style={{ width: `${pct}%` }} />
      <div className="progress-thumb" style={{ left: `${pct}%` }} />
    </div>
  );
}

/** 向上展开的悬浮面板（统一交互）。 */
function UpPanel({ label, title, children, disabled }: {
  label: React.ReactNode;
  title?: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="up-panel">
      <button className="ctrl-btn" title={title} disabled={disabled}>
        {label}
      </button>
      <div className="up-pop" onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function BottomBar({
  translateOn,
  qualities,
  quality,
  mode,
  onToggleTranslate,
  onSelectQuality,
  onCycleMode,
  onOpenNowPlaying,
  onOpenComments,
  onOpenSongDetail,
  onOpenArtist,
}: BottomBarProps) {
  const state = useAudioPlayer();
  const hasSong = !!state.song;
  const coverStyle = state.song?.cover
    ? { backgroundImage: `url(${state.song.cover})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : {
        background: `linear-gradient(135deg, hsl(${state.song?.hue1 ?? 220} 70% 58%), hsl(${state.song?.hue2 ?? 280} 72% 34%))`,
      };
  const qualityLabel =
    qualities.find((o) => o.level === quality)?.label ?? (quality ? quality : '音质');

  const onWheelVolume = (e: WheelEvent<HTMLElement>): void => {
    if (!hasSong) return;
    const delta = e.deltaY > 0 ? -0.06 : 0.06;
    const next = Math.min(1, Math.max(0, (state.muted ? 0 : state.volume) + delta));
    audioPlayer.setVolume(next);
    if (next > 0 && state.muted) audioPlayer.toggleMute();
  };

  return (
    <footer
      className={`bottom-bar${state.loading ? ' is-loading' : ''}`}
      onWheel={onWheelVolume}
    >
      <div className="bar-progress">
        <ProgressBar
          current={state.currentTime}
          duration={state.duration}
          disabled={!hasSong}
          onSeek={(t) => audioPlayer.seek(t)}
        />
        <div className="bar-time">
          {formatTime(state.currentTime)} / {formatTime(state.duration)}
          {state.error && <span className="now-error">⚠ {state.error}</span>}
        </div>
      </div>

      <div className="bar-row">
        <button className="now-cover" style={coverStyle} aria-label="打开播放窗口" disabled={!hasSong} onClick={onOpenNowPlaying} />
        <div className="now-meta">
          <button className="now-title" disabled={!hasSong} onClick={onOpenSongDetail} title="查看歌曲详情">
            {state.song?.title ?? '未在播放'}
          </button>
          <button
            className="now-artist"
            disabled={!hasSong || !state.song?.artist}
            onClick={() => state.song && onOpenArtist(state.song.artist)}
            title="查看歌手"
          >
            {state.song
              ? `${state.song.artist} · ${SOURCE_LABEL[state.song.source] ?? state.song.source}`
              : '点击星云卡片开始播放'}
          </button>
        </div>

        <div className="bar-center">
          <button className="ctrl-btn" aria-label="上一首" disabled={!hasSong} onClick={() => audioPlayer.prev()}>
            ⏮
          </button>
          <button
            className="play-btn"
            aria-label={state.playing ? '暂停' : '播放'}
            disabled={!hasSong}
            onClick={() => audioPlayer.toggle()}
          >
            {state.playing ? '❚❚' : '▶'}
          </button>
          <button className="ctrl-btn" aria-label="下一首" disabled={!hasSong} onClick={() => audioPlayer.next()}>
            ⏭
          </button>
        </div>

        <div className="bar-tools">
          <button className="ctrl-btn" aria-label="评论" title="查看评论" disabled={!hasSong} onClick={onOpenComments}>
            <IconComments />
          </button>
          <button
            className={`ctrl-btn mode-btn${mode !== 'sequential' ? ' is-active' : ''}`}
            aria-label="播放模式"
            title="切换播放模式"
            disabled={!hasSong}
            onClick={onCycleMode}
          >
            {MODE_ICON[mode]}
          </button>
          <UpPanel label={<span className="quality-badge">{qualityLabel.length > 4 ? qualityLabel.slice(0, 4) + '…' : qualityLabel}</span>} title="音质">
            <div className="up-pop-title">音质</div>
            {qualities.map((o) => (
              <button
                key={o.level}
                className={`quality-item${o.level === quality ? ' is-current' : ''}`}
                onClick={() => onSelectQuality(o.level)}
              >
                {o.label}
              </button>
            ))}
          </UpPanel>
          <UpPanel label={<span>译</span>} title="歌词翻译">
            <div className="up-pop-title">歌词翻译</div>
            <button className={`quality-item${translateOn ? ' is-current' : ''}`} onClick={onToggleTranslate}>
              {translateOn ? '开启' : '关闭'}
            </button>
          </UpPanel>
          <UpPanel label={<span>🔊</span>} title="音量（滚轮调节）">
            <div className="up-pop-title">音量</div>
            <input
              className="vol-slider"
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={state.muted ? 0 : state.volume}
              onChange={(e) => {
                const v = Number(e.target.value);
                audioPlayer.setVolume(v);
                if (v > 0 && state.muted) audioPlayer.toggleMute();
              }}
            />
            <div className="vol-hint">鼠标滚轮可调音量</div>
          </UpPanel>
        </div>
      </div>
    </footer>
  );
}
