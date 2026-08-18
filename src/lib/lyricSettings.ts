/** 歌词视觉设置（docs/ARCHITECTURE.md：共享类型，LyricsLayer 与 useLyrics 均从 lib 取）。 */
export interface LyricVisualSettings {
  fontSize: number;
  highlightStyle: 'sweep' | 'float';
  /** 悬浮层次：under = 卡片云之下（Z1）；over = 覆盖在卡片云之上。 */
  layerMode: 'under' | 'over';
  /** 当前句放大系数（可 DIY）。 */
  currentScale: number;
  /** 逐字已唱字上浮幅度 px（可 DIY）。 */
  wordRise: number;
  /** 三句布局：stacked = 依次在上；offset = 上下错落。 */
  lyricLayout: 'stacked' | 'offset';
  /** 歌词取色源：cover = 封面自动取色；custom = 自定义基色。 */
  lyricColorSource: 'cover' | 'custom';
  /** 自定义基色（hex）。 */
  customColor: string;
  /** 歌词加粗开关（Z1 穿梭歌词）。 */
  bold?: boolean;
}
