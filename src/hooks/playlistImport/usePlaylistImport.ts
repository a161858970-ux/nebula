import { useCallback, useState } from 'react';
import type { Track } from '../../lib/catalog';
import { hasDesktopAPI, toFrontendTrack } from '../../lib/playlist/ipcClient';
import { resolvePlaylist } from '../../lib/playlist/adapters';
import type { ImportStatus, PlaylistMeta } from '../../lib/playlistTypes';

export interface ImportCommit {
  adapterName: string;
  tracks: Track[];
  simulated: boolean;
  note?: string;
  /** null 表示不更新当前歌单身份（如本地音乐，与既有行为一致）。 */
  meta: PlaylistMeta | null;
}

interface UsePlaylistImportOptions {
  /** 导入会话开始（清空旧视图/播放器状态），由 App 组合层提供。 */
  onSessionStart: () => void;
  /** 导入成功提交，由 App 组合层接线到 曲库 + 歌单身份 + 渐进揭示。 */
  onImported: (commit: ImportCommit) => void;
}

/**
 * 导入流程领域（docs/ARCHITECTURE.md §2）：
 * 手动链接 / 平台歌单 / 本地目录 三入口，只负责解析与状态，不拥有曲库。
 */
export function usePlaylistImport({ onSessionStart, onImported }: UsePlaylistImportOptions) {
  const [importStatus, setImportStatus] = useState<ImportStatus>('idle');
  const [importMessage, setImportMessage] = useState('');
  const [localBusy, setLocalBusy] = useState(false);

  const importUrl = useCallback(
    async (url: string) => {
      setImportStatus('parsing');
      setImportMessage('');
      onSessionStart();
      try {
        const { adapterName, songs, simulated, note } = await resolvePlaylist(url);
        onImported({
          adapterName,
          tracks: songs,
          simulated,
          note,
          meta: { platform: adapterName, id: 'manual', name: '手动链接导入', cover: '' },
        });
      } catch (err) {
        setImportStatus('error');
        setImportMessage(`歌单解析失败：${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [onSessionStart, onImported],
  );

  const importPlaylistId = useCallback(
    async (platform: string, id: string) => {
      if (!hasDesktopAPI()) return;
      setImportStatus('parsing');
      setImportMessage('');
      onSessionStart();
      try {
        const res = await window.nebulaAPI!.importPlaylistId(platform, id);
        if (!res.ok) throw new Error(res.error);
        onImported({
          adapterName: res.data.platformName,
          tracks: res.data.tracks.map((t, i) => toFrontendTrack(t, i)),
          simulated: false,
          meta: { platform: res.data.platformName, id, name: res.data.name, cover: res.data.cover },
        });
      } catch (err) {
        setImportStatus('error');
        setImportMessage(`歌单导入失败：${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [onSessionStart, onImported],
  );

  const openLocal = useCallback(async () => {
    if (!hasDesktopAPI()) return;
    setLocalBusy(true);
    try {
      const res = await window.nebulaAPI!.openLocalDirectory();
      if (res.ok && res.data?.tracks?.length) {
        setImportStatus('parsing');
        setImportMessage('');
        onSessionStart();
        onImported({
          adapterName: '本地音乐',
          tracks: res.data.tracks.map((t, i) => toFrontendTrack(t, i)),
          simulated: false,
          meta: null,
        });
      } else if (res.ok) {
        setImportStatus('warn');
        setImportMessage('所选文件夹未发现可导入的音频文件');
      } else {
        setImportStatus('warn');
        setImportMessage(res.error ?? '未选择文件夹');
      }
    } finally {
      setLocalBusy(false);
    }
  }, [onSessionStart, onImported]);

  /** 渐进揭示完成后的收尾（由 App 的 beginImport onDone 调用）。 */
  const complete = useCallback((status: ImportStatus, message: string) => {
    setImportStatus(status);
    setImportMessage(message);
  }, []);

  return { importStatus, importMessage, localBusy, importUrl, importPlaylistId, openLocal, complete };
}
