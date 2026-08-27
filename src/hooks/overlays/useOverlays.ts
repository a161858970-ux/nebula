import { useCallback, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { audioPlayer } from '../../lib/audio/AudioPlayer';
import { libraryService } from '../../lib/library';
import { hasDesktopAPI, toBackendTrack, toFrontendTrack, type DesktopTrack } from '../../lib/playlist/ipcClient';
import type { Track } from '../../lib/catalog';

export interface InfoModalState {
  kind: 'comments' | 'song' | 'artist' | 'album';
  track?: Track;
  platform?: string;
  artistId?: string;
  artistName?: string;
  albumId?: string;
  albumName?: string;
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

  /** 底部条点击歌手名：先取详情拿歌手 id；详情缺失/匹配不到时按名字转译路由到网易云/QQ 歌手。 */
  const openArtistByName = useCallback((name: string) => {
    const song = audioPlayer.getState().song;
    if (!song || !hasDesktopAPI()) return;
    const fallbackToNameRoute = () => {
      window.nebulaAPI!
        .resolveArtistByName(name)
        .then((r) => {
          if (r.ok && r.data) {
            setInfoModal({ kind: 'artist', platform: r.data.platform, artistId: r.data.id, artistName: r.data.name });
          } else {
            setInfoModal({ kind: 'song', track: song });
          }
        })
        .catch(() => setInfoModal({ kind: 'song', track: song }));
    };
    window.nebulaAPI!
      .songDetail(toBackendTrack(song))
      .then((res) => {
        if (!res.ok || !res.data) {
          fallbackToNameRoute();
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
          fallbackToNameRoute();
        }
      })
      .catch(fallbackToNameRoute);
  }, []);

  /**
   * 专辑点击 → 专辑详情弹层。netease/qq 带 id 直接打开；
   * 其他平台（酷狗/汽水/Spotify）或 id 缺失时按「专辑名 + 歌手名」转译到网易云专辑。
   */
  const openAlbum = useCallback((platform: string, albumId: string, albumName: string, artistName?: string) => {
    if (albumId && (platform === 'netease' || platform === 'qq')) {
      setInfoModal({ kind: 'album', platform, albumId, albumName });
      return;
    }
    if (!hasDesktopAPI()) return;
    window.nebulaAPI!
      .resolveAlbumByTitle(albumName, artistName)
      .then((res) => {
        if (res.ok && res.data) {
          setInfoModal({
            kind: 'album',
            platform: res.data.platform,
            albumId: res.data.id,
            albumName: res.data.name,
          });
        } else {
          setModeToast(`未找到专辑《${albumName}》`);
        }
      })
      .catch(() => setModeToast(`未找到专辑《${albumName}》`));
  }, []);

  /**
   * 歌手 chip 点击：netease/qq 带 id 直接打开；其他平台（酷狗/汽水/Spotify）
   * 或 id 缺失时按歌手名转译到网易云/QQ 歌手页。
   */
  const openArtistFromChip = useCallback((platform: string, artistId: string, name: string) => {
    if (artistId && (platform === 'netease' || platform === 'qq')) {
      setInfoModal({ kind: 'artist', platform, artistId, artistName: name });
      return;
    }
    if (!hasDesktopAPI()) return;
    window.nebulaAPI!
      .resolveArtistByName(name)
      .then((res) => {
        if (res.ok && res.data) {
          setInfoModal({
            kind: 'artist',
            platform: res.data.platform,
            artistId: res.data.id,
            artistName: res.data.name,
          });
        } else {
          setModeToast(`未找到歌手「${name}」`);
        }
      })
      .catch(() => setModeToast(`未找到歌手「${name}」`));
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
    openAlbum,
    playArtistTrack,
    setNowPlayingOpen,
    setModeToast,
    setInfoModal,
  };
}
