/**
 * 免版权演示音频池（SoundHelix 提供的 CC 演示 MP3 直链）。
 * 真实生产环境可替换为任意 CDN 直链 / 对象存储地址。
 */
export const SAMPLE_AUDIO: readonly string[] = Array.from(
  { length: 16 },
  (_, i) => `https://www.soundhelix.com/examples/mp3/SoundHelix-Song-${i + 1}.mp3`,
);

export function sampleAudioFor(index: number): string {
  return SAMPLE_AUDIO[index % SAMPLE_AUDIO.length]!;
}
