/** 确定性伪随机数工具：同一 seed 永远生成同一片星云。 */

export type RNG = () => number;

/** mulberry32 —— 轻量、分布良好的 32 位种子 PRNG。 */
export function mulberry32(seed: number): RNG {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 标准正态分布采样（Box-Muller），用于“中心密、四周稀”的高斯散布。 */
export function gaussian(rng: RNG): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export const range = (rng: RNG, min: number, max: number): number =>
  min + (max - min) * rng();

export const int = (rng: RNG, min: number, max: number): number =>
  Math.floor(range(rng, min, max + 1));

export const pick = <T>(rng: RNG, arr: readonly T[]): T =>
  arr[Math.floor(rng() * arr.length)]!;
