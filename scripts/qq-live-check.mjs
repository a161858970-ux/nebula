/*
 * QQ live account check (needs a real QQ Music cookie):
 *   node scripts/qq-live-check.mjs --cookie="uin=xxx; music_key=yyy; ..."
 *   or set env QQ_COOKIE, or place cookie text in qq-cookie.txt next to this script.
 *
 * Exercises: cookie validation -> getAccount -> search -> fetchSongUrl (flac/128k)
 * -> audio probe -> lyric -> my playlists. Exit 0 when every reachable step passes.
 */
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
  QqLogin,
  QqRightsService,
  validatePlatformCookie,
  normalizeCookieHeader,
  probeAudioUrl,
} = require('../dist-main/index.cjs');

const arg = process.argv.find((a) => a.startsWith('--cookie='));
const cookie = (arg ? arg.slice('--cookie='.length) : '') || process.env.QQ_COOKIE || '';
const fileCookie = cookie ? '' : (() => {
  try {
    return fs.readFileSync(path.join(import.meta.dirname, 'qq-cookie.txt'), 'utf-8').trim();
  } catch {
    return '';
  }
})();

const raw = cookie || fileCookie;
if (!raw) {
  console.error('No QQ cookie. Pass --cookie="...", env QQ_COOKIE, or qq-cookie.txt.');
  process.exit(2);
}

const normalized = normalizeCookieHeader(raw);
const validation = validatePlatformCookie('qq', normalized);
if (!validation.ok) {
  console.error('Cookie invalid:', validation.error);
  process.exit(1);
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nebula-qq-live-'));
setCookieDataDir(dir);
const cookies = new CookieStore();
cookies.set('qq', normalized, undefined, 'live-check');
const http = new HttpClient(cookies);
const adapters = createAdapters(http, cookies);
const login = new QqLogin(http, cookies, new QqRightsService(http));

const results = [];
const step = async (name, fn) => {
  try {
    const value = await fn();
    results.push({ name, ok: true, value });
    console.log(`[ok]   ${name}`);
  } catch (err) {
    results.push({ name, ok: false, error: err instanceof Error ? err.message : String(err) });
    console.log(`[fail] ${name}: ${err instanceof Error ? err.message : err}`);
  }
};

await step('cookie validation', () => validation);

await step('getAccount (profile + rights)', async () => {
  const account = await login.getAccount();
  if (!account || !account.loggedIn) throw new Error('getAccount returned not logged in');
  return account;
});

const searchTrack = await (async () => {
  const tracks = await adapters.qq.searchSongs('晴天 周杰伦', 5);
  if (!tracks.length) throw new Error('QQ search returned no results (network or API change)');
  return tracks[0];
})();

await step('searchSongs "晴天 周杰伦"', async () => searchTrack);

for (const quality of ['flac', '128k']) {
  await step(`fetchSongUrl quality=${quality}`, async () => {
    const song = await adapters.qq.fetchSongUrl(searchTrack.sourceId, undefined, quality);
    if (!song?.url) throw new Error(`no url for ${quality}: ${song?.error ?? 'unknown'}`);
    return { url: song.url.slice(0, 80), quality: song.quality };
  });

  await step(`audio probe quality=${quality}`, async () => {
    const song = await adapters.qq.fetchSongUrl(searchTrack.sourceId, undefined, quality);
    if (!song?.url) throw new Error('no url to probe');
    const probe = await probeAudioUrl(song.url, { platform: 'qq', cookie: normalized });
    if (!probe.ok) throw new Error(`probe rejected: ${probe.reason ?? probe.status ?? 'unknown'}`);
    return { status: probe.status, contentType: probe.contentType };
  });
}

await step('fetchLyric', async () => {
  const lyric = await adapters.qq.fetchLyric(searchTrack.sourceId);
  if (!lyric?.lines?.length) throw new Error('empty lyric');
  return { lines: lyric.lines.length };
});

await step('getMyPlaylists', async () => {
  const playlists = await login.getMyPlaylists();
  if (!playlists.length) throw new Error('getMyPlaylists returned 0 playlists (loginUin/hostuin/g_tk issue)');
  return {
    count: playlists.length,
    first: playlists.slice(0, 3).map((p) => `${p.name}(${p.trackCount})`),
  };
});

const failed = results.filter((r) => !r.ok).length;
console.log(`\nSummary: ${results.length - failed}/${results.length} steps passed`);
console.log('Account:', JSON.stringify(results.find((r) => r.name === 'getAccount (profile + rights)')?.value ?? null));
process.exit(failed ? 1 : 0);
