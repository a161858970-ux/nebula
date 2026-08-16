import type { Track } from '../catalog';

export type PlayMode = 'sequential' | 'repeat-one' | 'random';

export interface AudioPlayerState {
  song: Track | null;
  playing: boolean;
  loading: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  muted: boolean;
  /** 当前曲目音频加载失败（用于 UI 置灰）。 */
  failed: boolean;
  /** 最近一次播放失败原因（供底部播放条提示）。 */
  error: string | null;
  /** 当前歌曲可用的音质档位。*/
  qualities: { level: string; label: string; needsVip?: boolean; needsSvip?: boolean }[];
  /** 当前音质档位。*/
  quality: string;
  /** 播放模式：顺序 / 单曲循环 / 随机。 */
  mode: PlayMode;
}

type Listener = () => void;

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * 全局单例 HTML5 Audio 播放器。
 * - 事件驱动：订阅者可实时拿到 playing / currentTime / duration / 错误等状态；
 * - 自动队列：playSong(track, queue) 后 next/prev 在队列内循环；
 * - 容错：音频加载失败自动跳过下一首（连续失败达到队列长度则停止）。
 */
class AudioPlayer {
  readonly el: HTMLAudioElement;
  private listeners = new Set<Listener>();
  private queue: Track[] = [];
  /** 当前播放顺序（queue 下标序列）：顺序模式为恒等序，随机模式为 Fisher-Yates 洗牌序。 */
  private order: number[] = [];
  /** 在 order 中的当前位置。 */
  private pos = -1;
  private mode: PlayMode = 'sequential';
  private failStreak = 0;
  private consecutiveSkips = 0;
  private retriedSongId: number | null = null;
  private trialEndedId: number | null = null;
  private stallTimer: number | null = null;
  /** 临时单曲（网络搜索点播）备份：播放结束后自动接回原队列。 */
  private transientBackup: { queue: Track[]; order: number[]; pos: number } | null = null;

  /**
   * 音源失败重试器（由 App 注入）：
   * 主平台取流失败 / <audio> onerror 时，先尝试兜底检索再决定是否跳歌。
   */
  retryResolver?: (track: Track, reason: 'empty' | 'error') => Promise<Track | null>;
  /** 空音源快速解析器（next/prev/ended 遇未解析歌曲时走主平台取链，避免搜索兜底拖慢切歌）。 */
  emptyResolver?: (track: Track, reason: 'empty') => Promise<Track | null>;

  state: AudioPlayerState = {
    song: null,
    playing: false,
    loading: false,
    currentTime: 0,
    duration: 0,
    volume: 0.9,
    muted: false,
    failed: false,
    error: null,
    qualities: [],
    quality: '',
    mode: 'sequential',
  };

  constructor() {
    this.el = new Audio();
    this.el.preload = 'metadata';
    this.el.volume = 0.9;
    this.el.addEventListener('timeupdate', this.onTimeUpdate);
    this.el.addEventListener('loadedmetadata', this.onMeta);
    this.el.addEventListener('durationchange', this.onMeta);
    this.el.addEventListener('play', this.onPlay);
    this.el.addEventListener('playing', this.onPlaying);
    this.el.addEventListener('pause', this.onPause);
    this.el.addEventListener('waiting', this.onWaiting);
    this.el.addEventListener('ended', this.onEnded);
    this.el.addEventListener('error', this.onError);
    this.el.addEventListener('volumechange', this.onVolume);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  getState(): AudioPlayerState {
    return { ...this.state };
  }

  /** 播放指定歌曲；可选传入整个队列用于上一首/下一首。 */
  playSong(track: Track, queue?: Track[]): void {
    this.transientBackup = null;
    if (queue && queue.length) {
      this.queue = queue;
    }
    if (!this.queue.length) {
      this.queue = [track];
    }
    const trackIdx = this.queue.findIndex((t) => t.id === track.id);
    const startIdx = trackIdx < 0 ? 0 : trackIdx;
    if (this.mode === 'random') {
      this.order = this.buildRandomOrder(false);
      const at = this.order.indexOf(startIdx);
      if (at > 0) {
        this.order.splice(at, 1);
        this.order.unshift(startIdx);
      }
      this.pos = 0;
    } else {
      this.order = this.buildIdentityOrder();
      this.pos = this.order.indexOf(startIdx);
      if (this.pos < 0) this.pos = 0;
    }
    this.failStreak = 0;
    this.retriedSongId = null;
    this.trialEndedId = null;
    this.consecutiveSkips = 0;
    this.loadAtOrder(this.pos);
  }

  /**
   * 播放单曲（网络搜索点播等）：不替换当前播放队列、不影响 Z2 卡片；
   * 该曲播放结束后（或用户切下一首时）自动接回原队列继续。
   */
  playTransient(track: Track): void {
    if (!this.queue.length || !this.state.song) {
      this.playSong(track, [track]);
      return;
    }
    this.transientBackup = { queue: this.queue, order: [...this.order], pos: this.pos };
    this.queue = [track];
    this.order = [0];
    this.pos = 0;
    this.failStreak = 0;
    this.consecutiveSkips = 0;
    this.retriedSongId = null;
    this.trialEndedId = null;
    this.loadAtOrder(0);
  }

  /** 恢复上次会话：设置当前歌曲与队列，但不自动播放、不加载音源。 */
  restore(track: Track, queue?: Track[]): void {
    if (queue && queue.length) {
      this.queue = queue;
    }
    if (!this.queue.length) this.queue = [track];
    this.order = this.buildIdentityOrder();
    const idx = this.queue.findIndex((t) => t.id === track.id);
    this.pos = idx < 0 ? 0 : idx;
    this.state.song = this.queue[this.pos] ?? track;
    this.state.currentTime = 0;
    this.state.duration = this.state.song.duration ?? 0;
    this.state.playing = false;
    this.state.loading = false;
    this.state.failed = false;
    this.state.error = null;
    this.emit();
  }

  /** 把歌曲插入到“下一首”播放位置（不打断当前播放）。 */
  insertNext(track: Track): void {
    if (!this.queue.length) {
      this.queue = [track];
      this.order = [0];
      this.pos = 0;
      this.state.song = track;
      this.emit();
      return;
    }
    let idx = this.queue.findIndex((t) => t.id === track.id);
    if (idx < 0) {
      idx = this.queue.length;
      this.queue.push(track);
    }
    const existingAt = this.order.indexOf(idx);
    if (existingAt >= 0) this.order.splice(existingAt, 1);
    const curAt = this.order.indexOf(this.pos);
    this.order.splice(curAt + 1, 0, idx);
    this.emit();
  }

  toggle(): void {
    if (!this.state.song) return;
    if (this.el.paused) {
      this.el.play().catch(() => {
        /* error 事件会处理 */
      });
    } else {
      this.el.pause();
    }
  }

  next(): void {
    if (this.transientBackup) {
      const b = this.transientBackup;
      this.transientBackup = null;
      this.queue = b.queue;
      this.order = b.order;
      this.pos = b.pos;
    }
    if (!this.queue.length) return;
    if (this.queue.length === 1) {
      this.el.currentTime = 0;
      this.el.play().catch(() => {});
      return;
    }
    this.pos++;
    if (this.pos >= this.order.length) {
      if (this.mode === 'random') {
        // 全歌单播完一轮后再洗牌，保证整轮内不重复
        this.order = this.buildRandomOrder(false);
      }
      this.pos = 0;
    }
    this.loadAtOrder(this.pos);
  }

  prev(): void {
    if (!this.queue.length) return;
    if (this.queue.length === 1) {
      this.el.currentTime = 0;
      this.el.play().catch(() => {});
      return;
    }
    this.pos = (this.pos - 1 + this.order.length) % this.order.length;
    this.loadAtOrder(this.pos);
  }

  seek(time: number): void {
    const d = this.state.duration;
    if (!(d > 0)) return;
    this.el.currentTime = Math.min(d, Math.max(0, time));
  }

  setVolume(v: number): void {
    this.el.volume = Math.min(1, Math.max(0, v));
  }

  toggleMute(): void {
    this.el.muted = !this.el.muted;
  }

  setMode(mode: PlayMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    if (this.queue.length && this.state.song) {
      const cur = this.pos >= 0 && this.pos < this.order.length ? this.order[this.pos] : 0;
      if (mode === 'random') {
        this.order = this.buildRandomOrder(true);
        this.pos = 0;
      } else {
        this.order = this.buildIdentityOrder();
        this.pos = this.order.indexOf(cur);
        if (this.pos < 0) this.pos = 0;
      }
    }
    this.state.mode = mode;
    this.emit();
  }

  /** 顺序播放 → 单曲循环 → 全局随机 循环切换。 */
  cycleMode(): void {
    const next: Record<PlayMode, PlayMode> = {
      sequential: 'repeat-one',
      'repeat-one': 'random',
      random: 'sequential',
    };
    this.setMode(next[this.mode]);
  }

  private buildIdentityOrder(): number[] {
    return this.queue.map((_, i) => i);
  }

  /** Fisher-Yates 洗牌；keepCurrent 时把当前曲目固定到队首。 */
  private buildRandomOrder(keepCurrent: boolean): number[] {
    const n = this.queue.length;
    const idx = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    if (keepCurrent && this.pos >= 0 && this.pos < this.order.length) {
      const cur = this.order[this.pos];
      const at = idx.indexOf(cur);
      if (at > 0) {
        idx.splice(at, 1);
        idx.unshift(cur);
      }
    }
    return idx;
  }

  private loadAtOrder(p: number): void {
    if (p < 0 || p >= this.order.length) return;
    this.pos = p;
    this.loadAt(this.order[p]);
  }

  setQualities(list: { level: string; label: string; needsVip?: boolean; needsSvip?: boolean }[]): void {
    this.state.qualities = list;
    this.emit();
  }

  /** 不中断播放地切换音源（音质切换用），保留当前进度与播放状态。 */
  switchSource(url: string, opts?: { quality?: string; keepTime?: boolean }): void {
    if (!this.state.song) return;
    const keep = opts?.keepTime !== false ? this.el.currentTime || 0 : 0;
    const wasPlaying = !this.el.paused;
    this.state.song = { ...this.state.song, audio: url, quality: opts?.quality ?? this.state.song.quality };
    this.state.quality = opts?.quality ?? this.state.quality;
    this.state.loading = true;
    this.state.failed = false;
    this.state.error = null;
    this.retriedSongId = null;
    this.trialEndedId = null;
    this.emit();
    this.armStallTimer();
    this.el.src = url;
    this.el.currentTime = keep;
    if (wasPlaying) {
      const p = this.el.play();
      p?.catch(() => {
        /* error 事件会再处理 */
      });
    }
  }

  /** 手动设置提示信息（如音质切换失败）。 */
  setError(msg: string | null): void {
    this.state.error = msg;
    this.emit();
  }

  /** 停止并清空播放状态（导入新歌单时调用）。 */
  stop(): void {
    this.clearStallTimer();
    this.el.pause();
    this.el.removeAttribute('src');
    this.el.load();
    this.queue = [];
    this.order = [];
    this.pos = -1;
    this.failStreak = 0;
    this.state = {
      song: null,
      playing: false,
      loading: false,
      currentTime: 0,
      duration: 0,
      volume: this.el.volume,
      muted: this.el.muted,
      failed: false,
      error: null,
      qualities: [],
      quality: '',
      mode: this.mode,
    };
    this.emit();
  }

  private loadAt(i: number): void {
    if (i < 0 || i >= this.queue.length) return;
    const track = this.queue[i]!;
    this.state.song = track;
    this.state.currentTime = 0;
    this.state.duration = 0;
    this.trialEndedId = null;
    this.state.qualities = [];
    this.state.quality = track.quality ?? '';
    if (!track.audio) {
      // 无直链：先走一次兜底解析
      this.state.failed = false;
      this.state.error = `正在解析《${track.title}》音源…`;
      this.emit();
      this.tryResolveEmpty(track);
      return;
    }
    this.state.failed = false;
    this.state.loading = true;
    this.state.error = null;
    this.emit();
    this.armStallTimer();
    this.el.src = track.audio;
    this.el.currentTime = 0;
    const p = this.el.play();
    if (p) {
      p.catch(() => {
        /* error 事件会触发容错跳歌 */
      });
    }
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private onTimeUpdate = (): void => {
    this.state.currentTime = this.el.currentTime || 0;
    const song = this.state.song;
    if (
      song?.trialEndTime &&
      this.state.playing &&
      song.id !== this.trialEndedId &&
      this.state.currentTime * 1000 >= song.trialEndTime
    ) {
      // 试听边界：干净停止，不触发 error/重试循环
      this.trialEndedId = song.id;
      this.el.pause();
      this.state.playing = false;
      this.state.error = '试听片段已结束（完整播放需更高会员权益或登录）';
      this.emit();
      return;
    }
    this.emit();
  };

  private onMeta = (): void => {
    if (Number.isFinite(this.el.duration)) this.state.duration = this.el.duration;
    this.emit();
  };

  private onPlay = (): void => {
    this.state.playing = true;
    this.emit();
  };

  private onPlaying = (): void => {
    this.trialEndedId = null;
    this.state.loading = false;
    this.state.failed = false;
    this.state.playing = true;
    this.failStreak = 0;
    this.consecutiveSkips = 0;
    this.state.error = null;
    this.retriedSongId = null;
    this.clearStallTimer();
    this.emit();
  };

  private onPause = (): void => {
    this.state.playing = false;
    this.emit();
  };

  private onWaiting = (): void => {
    this.state.loading = true;
    this.emit();
  };

  private onEnded = (): void => {
    this.state.playing = false;
    this.emit();
    if (this.mode === 'repeat-one' && !this.transientBackup) {
      this.el.currentTime = 0;
      const p = this.el.play();
      p?.catch(() => {
        /* error 事件会再处理 */
      });
      return;
    }
    this.next();
  };

  /** 空音源：先走快路径 emptyResolver（主平台取链），失败再走 retryResolver（兜底搜索）。 */
  private tryResolveEmpty(track: Track): void {
    const resolver = this.emptyResolver ?? this.retryResolver;
    if (!resolver) {
      this.skipAfterFail();
      return;
    }
    this.state.loading = true;
    this.emit();
    resolver(track, 'empty')
      .then((resolved) => {
        const url = resolved?.audio;
        if (!resolved || !url) {
          this.skipAfterFail();
          return;
        }
        this.state.song = resolved;
        this.state.quality = resolved.quality ?? this.state.quality;
        this.state.failed = false;
        this.state.loading = true;
        this.state.error = null;
        this.retriedSongId = null;
        this.trialEndedId = null;
        this.emit();
        this.armStallTimer();
        this.el.src = url;
        this.el.currentTime = 0;
        const p = this.el.play();
        p?.catch(() => {
          /* error 事件会再次处理 */
        });
      })
      .catch(() => this.skipAfterFail());
  }

  private onVolume = (): void => {
    this.state.volume = this.el.volume;
    this.state.muted = this.el.muted;
    this.emit();
  };

  /** 加载失败：置灰标记 → 自动尝试下一首；连续失败达队列长度则停止。 */
  private onError = (): void => {
    this.clearStallTimer();
    const track = this.state.song;
    if (track) {
      this.state.failed = true;
      this.state.loading = false;
      this.state.playing = false;
      this.state.error = `「${track.title}」加载失败（${this.el.error?.message ?? '未知错误'}），正在尝试兜底…`;
      console.warn('[AudioPlayer] 音频加载失败:', track.title, track.audio, this.el.error);
      this.emit();
      this.tryRetry(track, 'error');
      return;
    }
    this.skipAfterFail();
  };

  /** 有兜底解析器时先重试一次；失败/无解析器再跳歌。 */
  private tryRetry(track: Track, reason: 'empty' | 'error'): void {
    if (!this.retryResolver || this.retriedSongId === track.id) {
      this.skipAfterFail();
      return;
    }
    this.retriedSongId = track.id;
    this.state.loading = true;
    this.emit();
    this.retryResolver(track, reason)
      .then((resolved) => {
        const url = resolved?.audio;
        if (!resolved || !url) {
          this.skipAfterFail();
          return;
        }
        this.state.song = resolved;
        this.state.quality = resolved.quality ?? this.state.quality;
        this.state.failed = false;
        this.state.loading = true;
        this.state.error = null;
        this.emit();
        this.armStallTimer();
        this.el.src = url;
        this.el.currentTime = 0;
        const p = this.el.play();
        p?.catch(() => {
          /* error 事件会再次处理 */
        });
      })
      .catch(() => this.skipAfterFail());
  }

  private skipAfterFail(): void {
    this.clearStallTimer();
    this.state.failed = true;
    this.state.loading = false;
    this.state.playing = false;
    this.emit();

    this.failStreak++;
    this.consecutiveSkips++;
    if (
      this.consecutiveSkips >= 6 ||
      this.failStreak >= Math.max(1, this.queue.length)
    ) {
      this.state.loading = false;
      this.state.error =
        this.consecutiveSkips >= 6
          ? '连续多首无法播放（无可用音源），已停止自动跳歌，请换一首试试'
          : `连续 ${this.failStreak} 首播放失败，已停止自动跳歌`;
      this.emit();
      return;
    }
    window.setTimeout(() => {
      if (this.el.error || !this.el.src) this.next();
    }, 350);
  };

  /** 加载挂起保护：CDN 死链/卡网时 error 事件可能不来，超时按失败处理。 */
  private armStallTimer(): void {
    this.clearStallTimer();
    this.stallTimer = window.setTimeout(() => {
      this.stallTimer = null;
      if (!this.state.loading || this.state.playing) return;
      const track = this.state.song;
      this.state.failed = true;
      this.state.loading = false;
      this.state.playing = false;
      this.state.error = `「${track?.title ?? '当前曲目'}」加载超时，正在尝试兜底…`;
      console.warn('[AudioPlayer] 加载超时:', track?.title, this.el.currentSrc);
      this.emit();
      if (track) this.tryRetry(track, 'error');
      else this.skipAfterFail();
    }, 9000);
  }

  private clearStallTimer(): void {
    if (this.stallTimer !== null) {
      window.clearTimeout(this.stallTimer);
      this.stallTimer = null;
    }
  };
}

export const audioPlayer = new AudioPlayer();
