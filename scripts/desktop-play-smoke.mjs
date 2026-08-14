/* 桌面播放链路端到端模拟：
 * 用真实网易云适配器 + 真实 CDN 直链，注入 window.nebulaAPI，
 * 在无头 Chrome 中验证「导入 → 点击卡片 → <audio> 真实推进」。
 * 前置：pnpm build:main && pnpm build（浏览器产物到 outputs/）
 */
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { CookieStore, HttpClient, createAdapters, SongResolver } = require('../dist-main/index.cjs');
const { chromium } = require('C:/Users/LIU/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const HTML = 'file:///C:/Users/LIU/Documents/Codex/2026-08-10/wo/outputs/music-nebula/index.html';

async function main() {
  const cookies = new CookieStore();
  const http = new HttpClient(cookies);
  const adapters = createAdapters(http, cookies);
  const resolver = new SongResolver(adapters, () => {});

  // 真实数据：网易云热歌榜前 8 首，逐首解析直链
  const pl = await adapters.netease.fetchPlaylist('3778678');
  const tracks = [];
  for (const t of pl.tracks.slice(0, 8)) {
    const url = await adapters.netease.fetchSongUrl(t.sourceId);
    tracks.push({
      id: t.id,
      title: t.title,
      artist: t.artist,
      album: t.album,
      cover: t.cover,
      duration: t.duration,
      platform: t.platform,
      sourceId: t.sourceId,
      originalUrl: url?.url ?? '',
      fallbackUrl: '',
      quality: url?.quality,
    });
  }
  console.log(
    `真实数据准备完成: ${tracks.length} 首，有直链 ${tracks.filter((t) => t.originalUrl).length} 首`,
  );

  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: [] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.addInitScript(
    ({ tracks }) => {
      let fakeLoggedIn = false;
      window.nebulaAPI = {
        importPlaylist: async () => ({
          ok: true,
          data: { platformName: 'netease', name: '桌面模拟歌单', cover: '', tracks },
        }),
        resolveSong: async (track) => {
          const t = tracks.find((x) => x.sourceId === track.sourceId);
          return {
            ok: true,
            data: t?.originalUrl
              ? { url: t.originalUrl, fallback: false, platform: 'netease', sourceId: t.sourceId }
              : null,
          };
        },
        fallbackSong: async () => ({ ok: true, data: null }),
        fetchLyric: async () => ({ ok: true, data: null }),
        fetchComments: async () => ({ ok: true, data: null }),
        loginQr: async () => ({
          ok: true,
          data: { unikey: 'mock-unikey', payload: 'https://music.163.com/login?codekey=mock-unikey' },
        }),
        loginPoll: async () => ({ ok: true, data: { ok: false, message: '等待扫码…' } }),
        loginPlatforms: async () => ({
          ok: true,
          data: [
            { platform: 'netease', name: '网易云音乐', kind: 'qr', unavailableReason: null },
            { platform: 'qq', name: 'QQ 音乐', kind: 'qr', unavailableReason: null },
            { platform: 'spotify', name: 'Spotify', kind: 'oauth', unavailableReason: null },
            { platform: 'kugou', name: '酷狗音乐', kind: 'unavailable', unavailableReason: '接口未开放' },
            { platform: 'qishui', name: '汽水音乐', kind: 'unavailable', unavailableReason: '接口未开放' },
          ],
        }),
        loginQrFor: async () => ({
          ok: true,
          data: { unikey: 'mock-unikey', payload: 'https://music.163.com/login?codekey=mock-unikey' },
        }),
        loginPollFor: async () => {
          fakeLoggedIn = true;
          return { ok: true, data: { ok: true, message: '登录成功：测试用户' } };
        },
        loginAccount: async () => ({
          ok: true,
          data: fakeLoggedIn ? { loggedIn: true, userId: '1', nickname: '测试用户' } : { loggedIn: false },
        }),
        loginPlaylists: async () => ({
          ok: true,
          data: [
            { id: '1001', name: '我的收藏', cover: '', trackCount: 42 },
            { id: '1002', name: '通勤歌单', cover: '', trackCount: 18 },
          ],
        }),
        importPlaylistId: async (platform) => ({
          ok: true,
          data: { platformName: platform, name: 'mock', cover: '', tracks },
        }),
        spotifyLoginStart: async () => ({ ok: true, data: false }),
        spotifyLoginStatus: async () => ({ ok: true, data: false }),
        setCookie: async () => ({ ok: true, data: true }),
        getCookie: async () => ({ ok: true, data: null }),
        clearCookie: async () => ({ ok: true, data: true }),
      };
    },
    { tracks },
  );

  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(HTML, { waitUntil: 'load' });
  await page.waitForTimeout(1200);

  // 1) 导入
  await page.getByRole('button', { name: '导入' }).click();
  await page.locator('.import-panel .import-bar input').fill('https://music.163.com/#/playlist?id=3778678');
  await page.locator('.import-panel .import-btn').click();
  await page.waitForFunction(() => window.__nebula.total === 8, null, { timeout: 15000 });
  await page.waitForFunction(
    () => window.__nebula.revealed() >= 8 && document.querySelectorAll('.music-card').length >= 6,
    null,
    { timeout: 15000 },
  );
  console.log('导入完成，挂载卡片:', await page.evaluate(() => document.querySelectorAll('.music-card').length));

  // 2) 找一个「有直链且可见」的卡片点击
  const target = await page.evaluate(() => {
    const songs = window.__nebula.songsData();
    for (const el of document.querySelectorAll('.music-card')) {
      const id = Number(el.getAttribute('data-song-id'));
      const s = songs[id];
      if (!s || !s.audio) continue;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (cx > 20 && cx < innerWidth - 20 && cy > 20 && cy < innerHeight - 20) {
        return { x: cx, y: cy, title: s.title, id };
      }
    }
    return null;
  });
  if (!target) {
    console.error('✘ 未找到有直链且可见的卡片');
    process.exit(1);
  }
  console.log('点击播放:', target.title);
  await page.mouse.click(target.x, target.y);
  await page.waitForFunction(
    (id) => window.__nebula.player.getState().song?.id === id,
    target.id,
    { timeout: 8000 },
  );
  await page.waitForTimeout(3000);

  const st = await page.evaluate(() => {
    const s = window.__nebula.player.getState();
    return {
      songId: s.song?.id,
      title: s.song?.title,
      playing: s.playing,
      currentTime: s.currentTime,
      duration: s.duration,
      error: s.error,
      failed: s.failed,
    };
  });
  const failedCards = await page.evaluate(() => document.querySelectorAll('.music-card.is-failed').length);
  console.log('播放状态:', JSON.stringify(st));
  console.log('置灰卡片数:', failedCards);

  // 点击卡片会打开二级播放窗口：先 Esc 关闭，避免遮挡后续操作
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // 3) 断言：真实音源必须推进，且未跳歌
  if (!st.playing || st.currentTime < 0.5 || st.error) {
    console.error('✘ 真实音源未能推进播放:', JSON.stringify(st));
    process.exit(1);
  }
  if (st.songId !== target.id) {
    console.error(`✘ 发生了跳歌: ${target.id} → ${st.songId}`);
    process.exit(1);
  }
  if (errors.length) {
    console.error('✘ 页面错误:', errors.join('\n'));
    process.exit(1);
  }
  console.log('✔ 桌面播放链路（导入 → 解析 → <audio> 真实推进）通过');

  // 4) 登录面板 + 我的歌单（模拟）
  const loginBtn = page.locator('.hud-actions button', { hasText: '登录' });
  if (await loginBtn.count()) {
    await loginBtn.first().click();
    await page.waitForSelector('.login-panel');
    const panel = await page.evaluate(() => {
      const img = document.querySelector('.login-qr');
      return {
        panel: !!document.querySelector('.login-panel'),
        tabs: document.querySelectorAll('.login-tab').length,
        qr: !!img,
        qrSrc: (img?.getAttribute('src') || '').slice(0, 22),
      };
    });
    console.log('登录面板:', JSON.stringify(panel));
    if (!panel.panel || panel.tabs < 4 || !panel.qr || !panel.qrSrc.startsWith('data:image/png')) {
      console.error('✘ 登录面板未正常渲染二维码/平台标签');
      process.exit(1);
    }
    // mock 轮询立即成功 → 自动加载我的歌单
    await page.waitForSelector('.login-playlist', { timeout: 8000 });
    const playlists = await page.evaluate(() => ({
      count: document.querySelectorAll('.login-playlist').length,
      first: document.querySelector('.login-playlist-name')?.textContent ?? '',
    }));
    console.log('我的歌单:', JSON.stringify(playlists));
    if (playlists.count < 2 || !playlists.first) {
      console.error('✘ 我的歌单未列出');
      process.exit(1);
    }
    await page.locator('.login-playlist').first().click();
    await page.waitForFunction(
      () => document.querySelector('.import-status')?.textContent?.includes('已导入'),
      null,
      { timeout: 15000 },
    );
    console.log('✔ 登录面板渲染 + 我的歌单导入通过');
  } else {
    console.log('登录按钮不存在（跳过）');
  }
  await browser.close();
}

main().catch((e) => {
  console.error('桌面播放链路失败:', e);
  process.exit(1);
});
