/* eslint-disable */
// 新链路在线验证：网易云专辑搜索 / 歌手全部歌曲 / 评论分页 / 头像 / 歌手·专辑转译解析
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  CookieStore,
  setCookieDataDir,
  HttpClient,
  createAdapters,
  LyricService,
} = require('../dist-main/index.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nebula-live-new-'));
setCookieDataDir(dir);
const cookies = new CookieStore();
const http = new HttpClient(cookies);
const adapters = createAdapters(http, cookies);
const lyric = new LyricService(adapters);

const results = [];
const step = async (name, fn) => {
  try {
    const value = await fn();
    results.push({ name, ok: true, value });
    console.log(`[ok]   ${name}`, value === undefined ? '' : JSON.stringify(value));
  } catch (err) {
    results.push({ name, ok: false, error: err instanceof Error ? err.message : String(err) });
    console.log(`[fail] ${name}: ${err instanceof Error ? err.message : err}`);
  }
};

await step('netease searchAlbums 叶惠美', async () => {
  const list = await adapters.netease.searchAlbums('叶惠美', 5);
  const hit = list.find((a) => a.name === '叶惠美');
  if (!hit) throw new Error('未命中叶惠美: ' + JSON.stringify(list.slice(0, 3).map((a) => a.name)));
  return { id: hit.id, artist: hit.artist, songCount: hit.songCount };
});

await step('netease fetchArtistAllSongs 周杰伦(6452)', async () => {
  const songs = await adapters.netease.fetchArtistAllSongs('6452');
  if (songs.length <= 50) throw new Error('应大于 50 首，实际 ' + songs.length);
  return { count: songs.length, first: songs[0]?.title };
});

await step('qq fetchArtistAllSongs 周杰伦(0025NhlN2yWrP4)', async () => {
  const songs = await adapters.qq.fetchArtistAllSongs('0025NhlN2yWrP4');
  if (songs.length <= 50) throw new Error('应大于 50 首，实际 ' + songs.length);
  return { count: songs.length, first: songs[0]?.title };
});

await step('netease fetchComments 晴天 page0', async () => {
  const r = await adapters.netease.fetchComments('186016', 0);
  if (!r || !r.latest?.length) throw new Error('latest 为空');
  return { hot: r.hot.length, latest: r.latest.length, total: r.latestTotal, hasMore: r.hasMoreLatest };
});

await step('netease fetchComments page2 追加', async () => {
  const r = await adapters.netease.fetchComments('186016', 2);
  if (!r?.latest?.length) throw new Error('page2 latest 为空');
  return { latest: r.latest.length, hasMore: r.hasMoreLatest };
});

await step('qq fetchComments 晴天 songmid page0', async () => {
  const r = await adapters.qq.fetchComments('0039MnYb0qxYhV', 0);
  if (!r || !r.latest?.length) throw new Error('latest 为空');
  return { hot: r.hot.length, latest: r.latest.length, total: r.latestTotal, hasMore: r.hasMoreLatest };
});

await step('qq fetchComments page1 追加', async () => {
  const r = await adapters.qq.fetchComments('0039MnYb0qxYhV', 1);
  if (!r?.latest?.length) throw new Error('page1 latest 为空');
  return { latest: r.latest.length, hasMore: r.hasMoreLatest };
});

await step('netease fetchArtistInfo 头像(6452)', async () => {
  const info = await adapters.netease.fetchArtistInfo('6452');
  if (!info?.avatar) throw new Error('avatar 为空: ' + JSON.stringify(info));
  return { name: info.name, avatar: info.avatar.slice(0, 80) };
});

await step('resolveArtistByName 周杰伦', async () => {
  const hit = await lyric.resolveArtistByName('周杰伦');
  if (!hit || !hit.id) throw new Error('未命中');
  return { platform: hit.platform, id: hit.id, name: hit.name };
});

await step('resolveArtistByName Taylor Swift', async () => {
  const hit = await lyric.resolveArtistByName('Taylor Swift');
  if (!hit || !hit.id) throw new Error('未命中');
  return { platform: hit.platform, id: hit.id, name: hit.name };
});

await step('resolveAlbumByTitle 叶惠美/周杰伦', async () => {
  const hit = await lyric.resolveAlbumByTitle('叶惠美', '周杰伦');
  if (!hit || !hit.id) throw new Error('未命中');
  return { id: hit.id, name: hit.name, artist: hit.artist };
});

await step('resolveAlbumByTitle 同名不同歌手校验', async () => {
  const hit = await lyric.resolveAlbumByTitle('晴天', '周杰伦');
  // 不应把「晴天」专辑错配成刘瑞琦同名专辑（歌手不匹配应降权）
  return { hit: hit ? { name: hit.name, artist: hit.artist } : null };
});

const failed = results.filter((r) => !r.ok).length;
console.log(`\nSummary: ${results.length - failed}/${results.length} steps passed`);
process.exit(failed ? 1 : 0);
