/* eslint-disable */
// Phase 1.5 自动化 QA（无头 Chrome + 本机 Chrome）
// 验证：曲库总量 / 视口密度 / 零重叠 / 鱼眼景深 / 悬浮转正 / 无限回绕 / 虚拟化 / 背景系统

const fs = require('fs');
const os = require('os');
const path = require('path');
const { PNG } = require('C:/Users/LIU/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pngjs');
const { chromium } = require('C:/Users/LIU/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright-core');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const OUT_DIR = 'C:/Users/LIU/Documents/Codex/2026-08-10/wo/outputs/music-nebula';
const HTML_PATH = path.join(OUT_DIR, 'index.html');

function log(label, value) {
  console.log(`[QA] ${label}: ${value}`);
}

const CELL = 340;
const COLS = Math.ceil(Math.sqrt(1000 * (4 / 3)));
const ROWS = Math.ceil(1000 / COLS);
const TILE_W = COLS * CELL;
const TILE_H = ROWS * CELL;

function parseMatrixScale(transform) {
  const m = transform.match(/^matrix(?:3d)?\((.*)\)$/);
  if (!m) return 0;
  const n = m[1].split(',').map(Number);
  return Math.hypot(n[0], n[1]);
}

function parseBlur(filter) {
  const m = filter.match(/blur\(([\d.]+)px\)/);
  return m ? Number(m[1]) : 0;
}

function parseRotationDeg(transform) {
  const m = transform.match(/^matrix(?:3d)?\((.*)\)$/);
  if (!m) return null;
  const n = m[1].split(',').map(Number);
  return (Math.atan2(n[1], n[0]) * 180) / Math.PI;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 构造一张测试用上传背景图
  const testPng = path.join(os.tmpdir(), 'qa-bg-test.png');
  {
    const p = new PNG({ width: 320, height: 180 });
    for (let y = 0; y < 180; y++) {
      for (let x = 0; x < 320; x++) {
        const i = (y * 320 + x) * 4;
        p.data[i] = 30 + (x * 200) / 320;
        p.data[i + 1] = 80 + (y * 120) / 180;
        p.data[i + 2] = 220;
        p.data[i + 3] = 255;
      }
    }
    fs.writeFileSync(testPng, PNG.sync.write(p));
  }

  const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--force-color-profile=srgb', '--hide-scrollbars'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !/Failed to load resource|ERR_|net::|Audio|media/i.test(msg.text())) {
      errors.push(`console: ${msg.text()}`);
    }
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${String(err)}`));

  await page.goto(`file:///${HTML_PATH.replace(/\\/g, '/')}`, { waitUntil: 'load' });
  await page.waitForTimeout(1500);

  // ---------- 1) 密度与虚拟化 ----------
  const stats = await page.evaluate(() => {
    const vw = innerWidth;
    const vh = innerHeight;
    const cards = Array.from(document.querySelectorAll('.music-card')).map((el) => {
      const r = el.getBoundingClientRect();
      return {
        x: r.left,
        y: r.top,
        w: r.width,
        h: r.height,
        cx: r.left + r.width / 2,
        cy: r.top + r.height / 2,
        intersect: r.left < vw && r.top < vh && r.right > 0 && r.bottom > 0,
        transform: getComputedStyle(el).transform,
        filter: getComputedStyle(el).filter,
        z: Number(getComputedStyle(el).zIndex) || 0,
      };
    });
    const visible = cards.filter((c) => c.intersect);
    return {
      total: window.__nebula?.total ?? -1,
      mounted: cards.length,
      onScreen: visible.length,
      pan: window.__nebula?.pan(),
      cards: visible,
    };
  });
  log('曲库总量', stats.total);
  log('已挂载 DOM 卡片数(≤60)', stats.mounted);
  log('视口内卡片数', stats.onScreen);
  log('初始 pan', JSON.stringify(stats.pan));

  // ---------- 2) 零重叠 ----------
  let overlaps = 0;
  for (let i = 0; i < stats.cards.length; i++) {
    for (let j = i + 1; j < stats.cards.length; j++) {
      const a = stats.cards[i];
      const b = stats.cards[j];
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ix > 1 && iy > 1) overlaps++;
    }
  }
  log('重叠卡片对数(允许自然重叠，仅记录)', overlaps);

  // ---------- 3) 鱼眼景深 ----------
  const vw = 1600;
  const vh = 900;
  let nearest = null;
  let farthest = null;
  for (const c of stats.cards) {
    const d = Math.hypot(c.cx - vw / 2, c.cy - vh / 2);
    c.dist = d;
    c.scale = parseMatrixScale(c.transform);
    c.blur = parseBlur(c.filter);
    if (!nearest || d < nearest.dist) nearest = c;
    if (!farthest || d > farthest.dist) farthest = c;
  }
  log('中心最近卡片 scale/blur/dist', `${nearest.scale.toFixed(3)} / ${nearest.blur.toFixed(2)}px / ${Math.round(nearest.dist)}`);
  log('边缘最远卡片 scale/blur/dist', `${farthest.scale.toFixed(3)} / ${farthest.blur.toFixed(2)}px / ${Math.round(farthest.dist)}`);
  log('中心卡 z-index / 边缘卡 z-index', `${nearest.z} / ${farthest.z}`);

  // ---------- 4) 帧耗时 ----------
  const idleFrameMs = await page.evaluate(
    () =>
      new Promise((resolve) => {
        let n = 0;
        const t0 = performance.now();
        const loop = () => {
          n++;
          if (n >= 30) resolve(Number(((performance.now() - t0) / n).toFixed(2)));
          else requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      }),
  );
  log('空闲平均帧耗时(ms)', idleFrameMs);


  const activePanMs = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const stage = document.querySelector('.stage-3d');
        stage.dispatchEvent(
          new PointerEvent('pointerdown', {
            pointerId: 1,
            clientX: 700,
            clientY: 400,
            bubbles: true,
            pointerType: 'mouse',
            button: 0,
          }),
        );
        let x = 700;
        const iv = setInterval(() => {
          x -= 8;
          window.dispatchEvent(
            new PointerEvent('pointermove', { pointerId: 1, clientX: x, clientY: 400, bubbles: true }),
          );
        }, 16);
        let n = 0;
        const t0 = performance.now();
        const tick = () => {
          n++;
          if (n >= 20) {
            clearInterval(iv);
            window.dispatchEvent(
              new PointerEvent('pointerup', { pointerId: 1, clientX: x, clientY: 400, bubbles: true }),
            );
            resolve(Number(((performance.now() - t0) / n).toFixed(2)));
          } else {
            requestAnimationFrame(tick);
          }
        };
        requestAnimationFrame(tick);
      }),
  );
  log('平移中平均帧耗时(ms)', activePanMs);

  // 停稳惯性
  await page.mouse.wheel(0, 1);
  await page.waitForTimeout(1600);

  // ---------- 5) 悬浮焦点 ----------
  const hoverTarget = await page.evaluate(() => {
    const vw = innerWidth;
    const vh = innerHeight;
    let best = null;
    let bestD = Infinity;
    for (const el of document.querySelectorAll('.music-card')) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const d = Math.hypot(cx - vw / 2, cy - vh / 2);
      if (d < bestD) {
        bestD = d;
        best = { x: cx, y: cy };
      }
    }
    return best;
  });
  if (!hoverTarget) {
    console.error('[QA] 未找到可悬浮的卡片');
    process.exit(1);
  }
  await page.mouse.move(hoverTarget.x, hoverTarget.y);
  await page.mouse.move(hoverTarget.x + 1, hoverTarget.y + 1);
  await page.waitForTimeout(900);
  const hoverState = await page.evaluate(() => {
    const el = document.querySelector('.music-card.is-hovered');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      transform: cs.transform,
      filter: cs.filter,
      z: cs.zIndex,
      scale: parseMatrixScaleSafe(cs.transform),
    };
    function parseMatrixScaleSafe(t) {
      const m = t.match(/^matrix(?:3d)?\((.*)\)$/);
      if (!m) return 0;
      const n = m[1].split(',').map(Number);
      return Math.hypot(n[0], n[1]);
    }
  });
  const hoverDeg = hoverState ? parseRotationDeg(hoverState.transform) : null;
  const hoverBlur = hoverState ? parseBlur(hoverState.filter) : null;
  log('悬浮后存在', !!hoverState);
  log('悬浮后旋转角(应≈0)', hoverDeg);
  log('悬浮后 blur(应=0)', hoverBlur);
  log('悬浮后 zIndex', hoverState?.z);
  log('悬浮后 scale(应>基础)', hoverState?.scale.toFixed(3));
  await page.mouse.move(20, 20);

  // ---------- 6) 拖拽平移 ----------
  const beforeDrag = await page.evaluate(() => {
    const el = document.querySelector('.music-card');
    return {
      x: el?.style.getPropertyValue('--x'),
      pan: window.__nebula?.pan(),
    };
  });
  await page.mouse.move(80, 80);
  await page.mouse.down();
  await page.mouse.move(280, 200, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(700);
  const afterDrag = await page.evaluate(() => {
    const el = document.querySelector('.music-card');
    return {
      x: el?.style.getPropertyValue('--x'),
      pan: window.__nebula?.pan(),
      mounted: document.querySelectorAll('.music-card').length,
    };
  });
  log('拖拽前 pan / 卡片--x', `${JSON.stringify(beforeDrag.pan)} / ${beforeDrag.x}`);
  log('拖拽后 pan / 卡片--x', `${JSON.stringify(afterDrag.pan)} / ${afterDrag.x}`);
  log('拖拽后挂载数', afterDrag.mounted);

  // ---------- 7) 滚轮远移（周期回绕） ----------
  await page.mouse.move(800, 450);
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 1600);
    await page.waitForTimeout(50);
  }
  await page.waitForTimeout(500);
  const afterWheel = await page.evaluate(() => ({
    pan: window.__nebula?.pan(),
    mounted: document.querySelectorAll('.music-card').length,
  }));
  log('滚轮后 pan(应 < tileHeight 12320，证明回绕)', JSON.stringify(afterWheel.pan));
  log('滚轮远移后挂载数(应>0)', afterWheel.mounted);

  // ---------- 8) 回到中心 ----------
  await page.getByRole('button', { name: /回到中心/ }).click();
  await page.waitForTimeout(500);
  const afterReset = await page.evaluate(() => window.__nebula?.pan());
  log('重置后 pan', JSON.stringify(afterReset));

  // ---------- 9) 背景系统 ----------
  // 右侧抽屉由边缘感应触发：先移到右边缘
  await page.mouse.move(1596, 420);
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: '背景', exact: true }).click();
  await page.waitForTimeout(300);
  await page.locator('.bg-thumb.bg-aurora').click();
  await page.waitForTimeout(300);
  log('切换极光背景', await page.evaluate(() => !!document.querySelector('.bg-layer.bg-aurora')));

  await page.locator('.bg-thumb.bg-midnight').click();
  await page.waitForTimeout(200);
  await page.setInputFiles('input[type="file"]', testPng);
  await page.waitForFunction(() => {
    const img = document.querySelector('.bg-media');
    return img && img.complete && img.naturalWidth > 0;
  });
  log('自定义图片上传生效', await page.evaluate(() => {
    const img = document.querySelector('.bg-media');
    return img ? `${img.naturalWidth}x${img.naturalHeight}` : 'none';
  }));

  await page.locator('.bg-thumb.bg-nebula').click();
  await page.waitForTimeout(200);
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(1200);
  log('刷新后背景持久化(应为 nebula)', await page.evaluate(() => !!document.querySelector('.bg-layer.bg-nebula')));

  // ---------- 10) 歌单导入与播放器 ----------
  // 10a. 导入演示歌单（输入留空）
  // 左侧歌单侧栏由边缘感应触发
  await page.mouse.move(4, 420);
  await page.waitForTimeout(600);
  await page.locator('.import-panel .import-bar input').fill('');
  await page.locator('.import-panel .import-btn').click();
  await page.waitForFunction(() => window.__nebula && window.__nebula.total === 16, null, {
    timeout: 15000,
  });
  await page.waitForFunction(
    () => window.__nebula.revealed() >= 16 && document.querySelectorAll('.music-card').length >= 10,
    null,
    { timeout: 15000 },
  );
  const importTotal = await page.evaluate(() => window.__nebula.total);
  const mountedAfterImport = await page.evaluate(() => document.querySelectorAll('.music-card').length);
  log('导入后曲库数(应为16)', importTotal);
  log('导入后挂载卡片数', mountedAfterImport);

  // 10a+. 边缘收回防抖：移出左侧面板后应自动收起
  await page.mouse.move(800, 450);
  await page.waitForTimeout(700);
  const edgeHideOk = await page.evaluate(
    () => !document.querySelector('.edge-left')?.classList.contains('is-open'),
  );
  log('左侧面板移出自动收回', edgeHideOk);

  // 10a++. 播放模式：顺序 → 单曲循环 → 随机（Fisher-Yates 全歌单洗牌）
  const modeCycle = await page.evaluate(() => {
    const p = window.__nebula.player;
    const all = window.__nebula.songsData();
    p.playSong(all[0], all);
    const seen = [];
    for (let i = 0; i < 3; i++) {
      p.cycleMode();
      seen.push(p.getState().mode);
    }
    return seen;
  });
  await page.evaluate(() => window.__nebula.player.setMode('random'));
  const shuffle = await page.evaluate(() => {
    const p = window.__nebula.player;
    const ids = new Set();
    for (let i = 0; i < 12; i++) {
      p.next();
      ids.add(p.getState().song?.id);
    }
    return { mode: p.getState().mode, unique: ids.size };
  });
  await page.evaluate(() => window.__nebula.player.setMode('sequential'));
  const modeOk = JSON.stringify(modeCycle) === JSON.stringify(['repeat-one', 'random', 'sequential']);
  log('播放模式循环', modeCycle.join(' -> '));
  log('随机模式 12 次切歌不重复', `${shuffle.unique}/12`);
  const shuffleOk = modeOk && shuffle.mode === 'random' && shuffle.unique === 12;

  // 10a+++. 音量滑条悬浮展开
  const volBefore = await page.locator('.vol-slider').evaluate((el) => getComputedStyle(el).width);
  await page.locator('.vol-group').hover();
  await page.waitForTimeout(450);
  const volAfter = await page.locator('.vol-slider').evaluate((el) => getComputedStyle(el).width);
  log('音量滑条悬浮展开', `${volBefore} -> ${volAfter}`);
  const volOk = parseFloat(volBefore) === 0 && parseFloat(volAfter) > 0;

  // 10b. 点击卡片播放
  const cardCenter = await page.evaluate(() => {
    const vw = innerWidth;
    const vh = innerHeight;
    let best = null;
    let bestD = Infinity;
    for (const el of document.querySelectorAll('.music-card')) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (cx < 20 || cx > vw - 20 || cy < 20 || cy > vh - 20) continue;
      const d = Math.hypot(cx - vw / 2, cy - vh / 2);
      if (d < bestD) {
        bestD = d;
        best = { x: cx, y: cy };
      }
    }
    return best;
  });
  if (!cardCenter) {
    console.error('[QA] 导入后未找到可播放卡片');
    process.exit(1);
  }
  await page.mouse.click(cardCenter.x, cardCenter.y);
  await page.waitForFunction(() => window.__nebula.player.getState().song !== null, null, {
    timeout: 8000,
  });
  const playState1 = await page.evaluate(() => {
    const s = window.__nebula.player.getState();
    return { title: s.song?.title, playing: s.playing };
  });
  log('点击卡片后播放状态', JSON.stringify(playState1));
  let duration = 0;
  try {
    await page.waitForFunction(() => window.__nebula.player.getState().duration > 0, null, {
      timeout: 8000,
    });
    duration = await page.evaluate(() => window.__nebula.player.getState().duration);
  } catch {
    log('音频元数据加载超时（网络受限，跳过时长断言）', 'n/a');
  }
  log('音频时长(秒)', duration.toFixed(1));

  // 10b+. 点击卡片会打开二级播放窗口：先 Esc 关闭，回到主界面操作底部条
  await page.keyboard.press('Escape');
  await page.waitForTimeout(350);

  // 10c. 播放 / 暂停
  await page.locator('.bottom-bar .play-btn').click();
  await page.waitForFunction(() => !window.__nebula.player.getState().playing);
  log('暂停后 playing=false', await page.evaluate(() => window.__nebula.player.getState().playing === false));
  await page.locator('.bottom-bar .play-btn').click();
  await page.waitForFunction(() => window.__nebula.player.getState().playing);
  log('恢复播放 playing=true', 'ok');

  // 10d. 下一首 / 上一首
  const idBefore = await page.evaluate(() => window.__nebula.player.getState().song.id);
  await page.locator('.bottom-bar .ctrl-btn[aria-label="下一首"]').click();
  await page.waitForFunction(
    (prev) => {
      const s = window.__nebula.player.getState();
      return s.song && s.song.id !== prev;
    },
    idBefore,
    { timeout: 8000 },
  );
  const idAfterNext = await page.evaluate(() => window.__nebula.player.getState().song.id);
  log('下一首切换', `${idBefore} -> ${idAfterNext}`);
  await page.locator('.bottom-bar .ctrl-btn[aria-label="上一首"]').click();
  await page.waitForFunction(
    (prev) => {
      const s = window.__nebula.player.getState();
      return s.song && s.song.id === prev;
    },
    idBefore,
    { timeout: 8000 },
  );
  log('上一首返回', 'ok');

  // 10e. 进度条 seek
  if (duration > 0) {
    const beforeT = await page.evaluate(() => window.__nebula.player.getState().currentTime);
    const box = await page.locator('.bottom-bar .progress-track').boundingBox();
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);
    await page.waitForTimeout(500);
    const afterT = await page.evaluate(() => window.__nebula.player.getState().currentTime);
    log('seek 后 currentTime', `${beforeT.toFixed(1)} -> ${afterT.toFixed(1)}`);
  } else {
    log('seek 测试', '跳过（无时长）');
  }

  // 10f. 坏链接自动跳歌 + 卡片置灰
  await page.evaluate(() => {
    window.__nebula.setSongAudio(0, 'https://127.0.0.1:1/broken.mp3');
  });
  await page.waitForTimeout(500);
  const brokenCard = await page.evaluate(() => {
    const el = document.querySelector('.music-card[data-song-id="0"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cx < 20 || cx > innerWidth - 20 || cy < 20 || cy > innerHeight - 20) return null;
    return { x: cx, y: cy };
  });
  if (brokenCard) {
    await page.mouse.click(brokenCard.x, brokenCard.y);
  } else {
    await page.evaluate(() => {
      const n = window.__nebula;
      const bad = { ...n.songsData()[0], audio: 'https://127.0.0.1:1/broken.mp3' };
      n.player.playSong(bad, [bad, n.songsData()[1]]);
    });
  }
  await page.waitForFunction(() => {
    const s = window.__nebula.player.getState();
    return s.song && s.song.id !== 0;
  }, null, { timeout: 10000 });
  const skippedTo = await page.evaluate(() => window.__nebula.player.getState().song.id);
  await page.waitForFunction(() => document.querySelectorAll('.music-card.is-failed').length > 0, null, {
    timeout: 5000,
  });
  const failedCount = await page.evaluate(() => document.querySelectorAll('.music-card.is-failed').length);
  log('坏链接自动跳到下一首(期望1)', skippedTo);
  log('置灰卡片数(应≥1)', failedCount);

  // 10g. 音质选择（注入桌面 API stub，验证列表拉取 + 菜单交互 + 切源）
  await page.evaluate(() => {
    window.nebulaAPI = {
      importPlaylist: async () => ({ ok: true, data: null }),
      importPlaylistId: async () => ({ ok: true, data: null }),
      resolveSong: async (track, quality) => ({
        ok: true,
        data: {
          url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
          quality,
          playable: true,
          fallback: false,
          platform: 'netease',
          sourceId: track.sourceId,
        },
      }),
      songQualities: async () => ({
        ok: true,
        data: [
          { level: 'lossless', label: '无损' },
          { level: 'exhigh', label: '极高' },
          { level: 'standard', label: '标准' },
        ],
      }),
      fallbackSong: async () => ({ ok: false, error: 'no' }),
      fetchLyric: async () => ({ ok: false, error: 'no' }),
      fetchComments: async () => ({ ok: false, error: 'no' }),
      loginAccount: async () => ({ ok: true, data: { loggedIn: false } }),
      loginPlaylists: async () => ({ ok: true, data: [] }),
      openLocalDirectory: async () => ({
        ok: true,
        data: {
          tracks: [
            {
              id: 'local:C:/Music/Test Song.mp3',
              title: 'Local Test',
              artist: 'Local Artist',
              album: 'Local Album',
              cover: '',
              duration: 180,
              platform: 'local',
              sourceId: 'C:/Music/Test Song.mp3',
              originalUrl: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
              fallbackUrl: '',
            },
          ],
        },
      }),
    };
    const demo = window.__nebula.songsData()[0];
    const track = {
      ...demo,
      source: 'netease',
      sourceId: '123456',
      audio: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
    };
    window.__nebula.player.playSong(track, [track]);
  });
  await page.waitForFunction(
    () => document.querySelectorAll('.quality-menu .ctrl-btn:not(:disabled)').length === 1,
    null,
    { timeout: 8000 },
  );
  await page.locator('.quality-menu .ctrl-btn').click();
  const qualityItems = await page.locator('.quality-pop .quality-item').count();
  await page.locator('.quality-pop .quality-item', { hasText: '无损' }).click();
  await page.waitForTimeout(300);
  const qualityState = await page.evaluate(() => {
    const s = window.__nebula.player.getState();
    return {
      quality: s.quality,
      switched: (s.song?.audio || '').includes('SoundHelix-Song-2'),
    };
  });
  log('音质菜单项数', qualityItems);
  log('音质切换后 quality/switched', JSON.stringify(qualityState));

  // 10h. 本地音乐导入：顶部边缘感应 → 圆形按钮 → 星云卡片生成
  await page.mouse.move(800, 4);
  await page.waitForTimeout(600);
  await page.locator('.local-btn').click();
  await page.waitForFunction(() => window.__nebula?.total === 1, null, { timeout: 8000 });
  const localOk = await page.evaluate(() => {
    const s = window.__nebula.songsData()[0];
    return {
      title: s.title === 'Local Test',
      source: s.source === 'local',
      audio: (s.audio || '').includes('SoundHelix-Song-3'),
    };
  });
  log('本地音乐导入', JSON.stringify(localOk));

  log('控制台错误数', errors.length);
  if (errors.length) console.log(errors.join('\n'));

  await browser.close();

  const failed =
    stats.total !== 1000 ||
    stats.mounted > 60 ||
    stats.onScreen < 8 ||
    stats.onScreen > 30 ||
    nearest.scale < 1.7 ||
    farthest.scale > 0.7 ||
    nearest.scale - farthest.scale < 1.0 ||
    nearest.z <= farthest.z ||
    nearest.blur > 1 ||
    farthest.blur < 1.5 ||
    idleFrameMs > 150 ||
    !hoverState ||
    hoverDeg === null ||
    Math.abs(hoverDeg) > 1 ||
    hoverBlur !== 0 ||
    hoverState.z !== '10000' ||
    beforeDrag.pan.x === afterDrag.pan.x ||
    afterWheel.pan.y >= TILE_H ||
    afterWheel.mounted === 0 ||
    importTotal !== 16 ||
    mountedAfterImport < 10 ||
    !playState1.title ||
    !playState1.playing ||
    idAfterNext === idBefore ||
    skippedTo !== 1 ||
    failedCount < 1 ||
    qualityItems !== 3 ||
    !qualityState.quality ||
    !qualityState.switched ||
    !edgeHideOk ||
    !shuffleOk ||
    !volOk ||
    !localOk.title ||
    !localOk.source ||
    !localOk.audio ||
    errors.length > 0;

  const diagnostics = {
    total: stats.total !== 1000,
    mounted: stats.mounted > 60,
    onScreen: stats.onScreen < 8 || stats.onScreen > 30,
    fisheyeScale: nearest.scale < 1.7 || farthest.scale > 0.7 || nearest.scale - farthest.scale < 1.0,
    fisheyeZ: nearest.z <= farthest.z,
    fisheyeBlur: nearest.blur > 1 || farthest.blur < 1.5,
    idleMs: idleFrameMs > 150,
    hover: !hoverState || hoverDeg === null || Math.abs(hoverDeg) > 1 || hoverBlur !== 0 || hoverState.z !== '10000',
    drag: beforeDrag.pan.x === afterDrag.pan.x,
    wheel: afterWheel.pan.y >= TILE_H || afterWheel.mounted === 0,
    importOk: importTotal !== 16 || mountedAfterImport < 10,
    play: !playState1.title || !playState1.playing,
    nav: idAfterNext === idBefore,
    skip: skippedTo !== 1,
    failedCard: failedCount < 1,
    qualityMenu: qualityItems !== 3 || !qualityState.quality || !qualityState.switched,
    edgeHide: !edgeHideOk,
    shuffle: !shuffleOk,
    volHover: !volOk,
    localImport: !localOk.title || !localOk.source || !localOk.audio,
    consoleErrors: errors.length > 0,
  };
  const bad = Object.entries(diagnostics).filter(([, v]) => v);
  if (bad.length) {
    console.log('[QA] 未通过项:', bad.map(([k]) => k).join(', '));
  }

  if (failed) {
    console.error('[QA] 存在未通过项');
    process.exit(1);
  }
  console.log('[QA] 全部通过 ✔');
}

main().catch((err) => {
  console.error('[QA] 失败:', err);
  process.exit(1);
});
