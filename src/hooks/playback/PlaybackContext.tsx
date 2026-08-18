import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { audioPlayer, type AudioPlayerState } from '../../lib/audio/AudioPlayer';

/** 低频播放状态（不含 currentTime/duration/progress）。 */
export interface PlaybackState {
  song: AudioPlayerState['song'];
  playing: boolean;
  mode: AudioPlayerState['mode'];
  quality: string;
  loading: boolean;
  failed: boolean;
  error: string | null;
  qualities: AudioPlayerState['qualities'];
}

function snapshot(s: AudioPlayerState): PlaybackState {
  return {
    song: s.song,
    playing: s.playing,
    mode: s.mode,
    quality: s.quality,
    loading: s.loading,
    failed: s.failed,
    error: s.error,
    qualities: s.qualities,
  };
}

function same(a: PlaybackState, b: PlaybackState): boolean {
  return (
    a.song === b.song &&
    a.playing === b.playing &&
    a.mode === b.mode &&
    a.quality === b.quality &&
    a.loading === b.loading &&
    a.failed === b.failed &&
    a.error === b.error &&
    a.qualities === b.qualities
  );
}

const PlaybackCtx = createContext<PlaybackState>(snapshot(audioPlayer.getState()));

/** 低频播放状态订阅（docs/ARCHITECTURE.md §4：忽略 tick，杜绝高频重渲染）。 */
export function usePlayback(): PlaybackState {
  return useContext(PlaybackCtx);
}

export function PlaybackProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PlaybackState>(() => snapshot(audioPlayer.getState()));
  useEffect(
    () =>
      audioPlayer.subscribe(() => {
        const s = snapshot(audioPlayer.getState());
        setState((prev) => (same(prev, s) ? prev : s));
      }),
    [],
  );
  return <PlaybackCtx.Provider value={state}>{children}</PlaybackCtx.Provider>;
}
