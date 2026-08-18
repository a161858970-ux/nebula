import { useEffect, useState } from 'react';
import { libraryService } from '../../lib/library';
import type { Track } from '../../lib/catalog';

/** 曲库订阅适配层（docs/ARCHITECTURE.md §2）：纯 React 订阅，无业务逻辑。 */
export function useLibrary() {
  const [songs, setSongs] = useState<Track[]>(() => libraryService.getState().songs);
  useEffect(() => libraryService.subscribe(() => setSongs(libraryService.getState().songs)), []);
  return { songs };
}
