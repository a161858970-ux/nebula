import { useEffect, useState } from 'react';
import { audioPlayer } from './AudioPlayer';
import type { AudioPlayerState } from './AudioPlayer';

/** React 订阅钩子：任何播放器状态变化都会触发使用方重渲染。 */
export function useAudioPlayer(): AudioPlayerState {
  const [state, setState] = useState<AudioPlayerState>(() => audioPlayer.getState());
  useEffect(() => audioPlayer.subscribe(() => setState(audioPlayer.getState())), []);
  return state;
}
