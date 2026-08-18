/** 舞台帧总线：PanController 每帧写入，歌词层/卡片渲染消费（对象引用恒定，字段原地更新）。 */
export interface FrameBus {
  x: number;
  y: number;
  zoom: number;
  vw: number;
  vh: number;
}

/** 视口外挂载缓冲。 */
export const CULL_BUFFER = 300;
