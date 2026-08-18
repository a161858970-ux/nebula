import type { CoverSample, LyricPalette } from './coverColors';

/**
 * VisualAtmosphere 中间层（docs/ARCHITECTURE.md §2/§4）：
 * useBackground 只产出视觉数据，不直接修改歌词/玻璃；
 * 歌词配色由消费端（渲染时经 VisualAtmosphere context + 纯函数）推导。
 */
export interface VisualAtmosphere {
  /** 背景媒体采样出的歌词色板（未采样/失败为 null，消费端兜底银蓝）。 */
  palette: LyricPalette | null;
  /** 封面采样（封面填充模式 CSS 变量用）。 */
  sample: CoverSample | null;
}
