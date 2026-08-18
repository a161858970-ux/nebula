import { useCallback, useRef, useState } from 'react';
import { audioPlayer } from '../../lib/audio/AudioPlayer';
import { libraryService } from '../../lib/library';
import type { Track } from '../../lib/catalog';
import type { PlaylistMeta } from '../../lib/playlistTypes';

export type { PlaylistMeta };

/**
 * 歌单生命周期 / 播放队列（docs/ARCHITECTURE.md §2）：
 * 当前歌单身份 + 队列播放入口；歌曲数据来自 LibraryService（不持有 songs）。
 */
export function usePlaylist() {
  const [currentPlaylist, setCurrentPlaylist] = useState<PlaylistMeta | null>(null);
  const songsRef = useRef<Track[]>([]);
  songsRef.current = libraryService.getState().songs;

  const setCurrent = useCallback((meta: PlaylistMeta) => setCurrentPlaylist(meta), []);

  const playFromList = useCallback((index: number) => {
    const song = songsRef.current[index];
    if (song) audioPlayer.playSong(song, songsRef.current);
  }, []);

  const playFromStart = useCallback(() => {
    const list = songsRef.current;
    if (list.length) audioPlayer.playSong(list[0]!, list);
  }, []);

  const insertNext = useCallback((track: Track) => {
    audioPlayer.insertNext(track);
  }, []);

  return { currentPlaylist, setCurrent, playFromList, playFromStart, insertNext };
}
