import type { Track } from './catalog';

export interface LibraryState {
  songs: Track[];
}

type Listener = () => void;

/**
 * 曲库服务（docs/ARCHITECTURE.md §2）：
 * 仅承载 track/catalog 数据，**不持有 currentPlaylist**（歌单生命周期归 usePlaylist）。
 * `applyImported` 是唯一外部导入入口。
 */
class LibraryService {
  private songs: Track[] = [];
  private listeners = new Set<Listener>();

  getState(): LibraryState {
    return { songs: this.songs };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  /** 唯一外部导入入口：整库替换为导入结果。 */
  applyImported(tracks: Track[]): void {
    this.songs = tracks;
    this.emit();
  }

  /** 会话恢复专用（语义与 applyImported 一致，命名表达用途）。 */
  restoreSongs(tracks: Track[]): void {
    this.songs = tracks;
    this.emit();
  }

  reset(): void {
    this.songs = [];
    this.emit();
  }
}

export const libraryService = new LibraryService();
