/** 导入流程状态（docs/ARCHITECTURE.md：跨域共享类型，hooks/组件均从 lib 取）。 */
export type ImportStatus = 'idle' | 'parsing' | 'done' | 'warn' | 'error';

/** 歌单身份（LibraryService 不持有；类型归 lib 供 playlists/import 领域共享）。 */
export interface PlaylistMeta {
  platform: string;
  id: string;
  name: string;
  cover: string;
}
