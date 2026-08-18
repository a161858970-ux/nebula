import { useCallback, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { audioPlayer } from '../../lib/audio/AudioPlayer';
import { libraryService } from '../../lib/library';
import { hasDesktopAPI, toBackendTrack, toFrontendTrack, type DesktopTrack } from '../../lib/playlist/ipcClient';
import type { Track } from '../../lib/catalog';

export interface InfoModalState {
  kind: 'comments' | 'song' | 'artist';
  track?: Track;
  platform?: string;
  artistId?: string;
  artistName?: string;
}

export interface ContextMenuState {
  x: number;
  y: number;
  track: Track;
}

/**
 * 浮层领域（docs/ARCHITECTURE.md §2）：
 * 右键菜单 / 信息弹层（评论·详情·歌手）/ 二级播放窗 / 模式 toast。
 * 只依赖 service（audioPlayer / LibraryService / IPC），不依赖其他 hook。
 */
export function useOverlays() {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuRef = useRef<ContextMenuState | null>(null);
  contextMenuRef.current = contextMenu;
  const [infoModal, setInfoModal] = useState<InfoModalState | null>(null);
  const [nowPlayingOpen, setNowPlayingOpen] = useState(false);
  const [modeToast, setModeToast] = useState('');

  const openContextMenu = useCallback((e: MouseEvent, track: Track) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, track });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const openCommentsModal = useCallback(() => {
    const song = audioPlayer.getState().song;
    if (!song) return;
    setInfoModal({ kind: 'comments', track: song });
  }, []);

  const openSongDetailModal = useCallback(() => {
    const song = audioPlayer.getState().song;
    if (!song) return;
    setInfoModal({ kind: 'song', track: song });
  }, []);

  /** 底部条点击歌手名：先取详情拿歌手 id；多个/匹配不到时退回详情页。 */
  const openArtistByName = useCallback((name: string) => {
    const song = audioPlayer.getState().song;
    if (!song || !hasDesktopAPI()) return;
    window.nebulaAPI!
      .songDetail(toBackendTrack(song))
      .then((res) => {
        if (!res.ok || !res.data) {
          setInfoModal({ kind: 'song', track: song });
          return;
        }
        const parts = name
          .split(/[\/、&,，]/)
          .map((s) => s.trim())
          .filter(Boolean);
        const match = res.data.artists.filter((a) =>
          parts.some((p) => p === a.name || p.includes(a.name) || a.name.includes(p)),
        );
        if (match.length === 1) {
          setInfoModal({
            kind: 'artist',
            platform: res.data.platform,
            artistId: match[0]!.id,
            artistName: match[0]!.name,
          });
        } else {
          setInfoModal({ kind: 'song', track: song });
        }
      })
      .catch(() => setInfoModal({ kind: 'song', track: song }));
  }, []);

  const openArtistFromChip = useCallback((platform: string, artistId: string, name: string) => {
    setInfoModal({ kind: 'artist', platform, artistId, artistName: name });
  }, []);

  /** 歌手页点播：追加到当前曲库队列播放（不打断歌单本身）。 */
  const playArtistTrack = useCallback((t: DesktopTrack) => {
    const songs = libraryService.getState().songs;
    const front = toFrontendTrack(t, songs.length);
    audioPlayer.playSong(front, [...songs, front]);
    setNowPlayingOpen(false);
  }, []);

  return {
    contextMenu,
    contextMenuRef,
    infoModal,
    nowPlayingOpen,
    modeToast,
    openContextMenu,
    closeContextMenu,
    openCommentsModal,
    openSongDetailModal,
    openArtistByName,
    openArtistFromChip,
    playArtistTrack,
    setNowPlayingOpen,
    setModeToast,
    setInfoModal,
  };
}
