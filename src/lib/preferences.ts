/** 读取用户上次选择的音质档位（localStorage）。 */
export function preferredQuality(): string {
  try {
    return localStorage.getItem('music-nebula.quality') ?? '';
  } catch {
    return '';
  }
}
