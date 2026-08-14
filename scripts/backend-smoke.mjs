/* 后端冒烟测试：运行 `pnpm build:main && node scripts/backend-smoke.mjs` */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  parseLrc,
  mergeLyric,
  mapNeteaseTrack,
  mapQQTrack,
  mapKugouTrack,
  matchScore,
  SongResolver,
  CookieStore,
  setCookieDataDir,
  resolveAdapterByUrl,
  registerIpcHandlers,
  eapiEncrypt,
  eapiDecryptResponse,
  weapiEncrypt,
  buildEapiRequest,
  createNcmEapiContext,
  normalizeCookieHeader,
  validatePlatformCookie,
  looksLikeAudio,
  parseQqRights,
} = require('../dist-main/index.cjs');

let failed = 0;
const pending = [];
const check = (name, fn) => {
  try {
    fn();
    console.log('✔', name);
  } catch (e) {
    failed++;
    console.error('✘', name, '-', e.message);
  }
};
const checkAsync = (name, fn) => {
  const p = (async () => {
  try {
    await fn();
    console.log('✔', name);
  } catch (e) {
    failed++;
    console.error('✘', name, '-', e.message);
  }
  })();
  pending.push(p);
  return p;
};

// ---------- 0) 网易云 weapi/eapi 加密 ----------
check('eapi 加密（MD5 签名 + AES-ECB）', () => {
  const { params } = eapiEncrypt('/api/login/qrcode/unikey', { type: 3 });
  assert.match(params, /^[0-9A-F]+$/, 'eapi params 应为大写 Hex');
  assert.ok(params.length > 0);
  // e_r=true 时服务端返回 JSON 直接 AES-ECB 加密的 Hex，可被 eapiDecryptResponse 还原
  const crypto = require('node:crypto');
  const body = JSON.stringify({ code: 200, unikey: 'test-key' });
  const cipher = crypto.createCipheriv('aes-128-ecb', Buffer.from('e82ckenh8dichen8', 'utf8'), null);
  const encrypted = Buffer.concat([cipher.update(body, 'utf8'), cipher.final()]).toString('hex').toUpperCase();
  const decrypted = eapiDecryptResponse(encrypted);
  assert.strictEqual(decrypted.unikey, 'test-key');
});

check('weapi 输出 params + 256 位 encSecKey', () => {
  const r = weapiEncrypt({ type: 3 });
  assert.ok(r.params.length > 0);
  assert.match(r.encSecKey, /^[0-9a-f]{256}$/, 'encSecKey 应为 256 位 hex');
});

check('buildEapiRequest 生成合法表单与设备 Cookie', () => {
  const req = buildEapiRequest('/api/login/qrcode/unikey', { type: 3 }, createNcmEapiContext());
  assert.match(req.url, /^https:\/\/interface\.music\.163\.com\/eapi\/login\/qrcode\/unikey$/);
  assert.ok(req.body.startsWith('params='));
  assert.match(req.headers.Cookie, /osver=.*deviceId=/);
  assert.match(req.headers['User-Agent'], /NeteaseMusicDesktop/);
});

check('normalizeCookieHeader 去属性/去重', () => {
  const n = normalizeCookieHeader(
    'MUSIC_U=abc; Max-Age=3600; Domain=music.163.com; MUSIC_U=xyz; __csrf=1; Path=/; HttpOnly',
  );
  assert.strictEqual(n, 'MUSIC_U=xyz; __csrf=1');
});

check('validatePlatformCookie：网易云必须含 MUSIC_U', () => {
  assert.strictEqual(validatePlatformCookie('netease', 'MUSIC_U=abc').ok, true);
  assert.strictEqual(validatePlatformCookie('netease', '__csrf=1').ok, false);
});

check('validatePlatformCookie：QQ 必须含 uin + 播放票据', () => {
  assert.strictEqual(validatePlatformCookie('qq', 'uin=12345; music_key=abc').ok, true);
  assert.strictEqual(validatePlatformCookie('qq', 'uin=12345').ok, false);
  assert.strictEqual(validatePlatformCookie('qq', 'music_key=abc').ok, false);
});

// ---------- 1) LRC 解析与双语对齐 ----------
check('parseLrc 时间轴（mm:ss.x / mm:ss.xx / mm:ss.xxx）', () => {
  const lines = parseLrc('[00:12.34]Hello\n[01:02.5]World\n[00:30.123]Third');
  assert.strictEqual(lines.length, 3);
  assert.strictEqual(lines[0].timeMs, 12340);
  assert.strictEqual(lines[0].text, 'Hello');
  assert.strictEqual(lines[1].timeMs, 30123);
  assert.strictEqual(lines[1].text, 'Third');
  assert.strictEqual(lines[2].timeMs, 62500);
  assert.strictEqual(lines[2].text, 'World');
});

check('mergeLyric 双语按时间轴归并', () => {
  const merged = mergeLyric('[00:12.34]Hello\n[00:20.00]World', '[00:12.34]你好\n[00:30.00]世界');
  assert.strictEqual(merged.length, 3);
  assert.strictEqual(merged[0].translation, '你好');
  assert.strictEqual(merged[1].translation, undefined);
  assert.strictEqual(merged[2].text, '');
  assert.strictEqual(merged[2].translation, '世界');
  for (let i = 1; i < merged.length; i++) {
    assert.ok(merged[i - 1].timeMs <= merged[i].timeMs, '时间轴有序');
  }
});

// ---------- 2) 平台字段映射 ----------
check('mapNeteaseTrack（ar/al/dt → 标准结构）', () => {
  const t = mapNeteaseTrack({
    id: 123,
    name: 'Resonance',
    ar: [{ name: 'HOME' }],
    al: { name: 'Odyssey', picUrl: 'http://p1.music.126.net/xxx.jpg' },
    dt: 235000,
  });
  assert.strictEqual(t.title, 'Resonance');
  assert.strictEqual(t.artist, 'HOME');
  assert.strictEqual(t.album, 'Odyssey');
  assert.strictEqual(t.duration, 235);
  assert.strictEqual(t.sourceId, '123');
  assert.ok(t.cover.startsWith('https://'));
});

check('mapQQTrack（songname/singer/albummid → 标准结构）', () => {
  const t = mapQQTrack({
    songmid: '003abc',
    songname: 'Rainbow',
    singer: [{ name: 'Couple N' }],
    albumname: 'LP',
    albummid: '004xyz',
    interval: 214,
  });
  assert.strictEqual(t.title, 'Rainbow');
  assert.strictEqual(t.artist, 'Couple N');
  assert.strictEqual(t.duration, 214);
  assert.ok(t.cover.includes('004xyz'));
});

check('mapKugouTrack + 脏数据返回 null', () => {
  const t = mapKugouTrack({ FileHash: 'HASH1', SongName: 'X', SingerName: 'A,B', Duration: 180, AlbumID: '9' });
  assert.strictEqual(t.sourceId, 'HASH1');
  assert.deepStrictEqual(t.artists, ['A', 'B']);
  assert.strictEqual(mapNeteaseTrack(null), null);
  assert.strictEqual(mapQQTrack({}), null);
});

// ---------- 3) 兜底匹配打分 ----------
const toTrack = (o) => ({
  id: 'x:1',
  title: o.title,
  artist: o.artist,
  duration: o.duration,
  platform: 'netease',
  sourceId: '1',
  album: '',
  cover: '',
  originalUrl: '',
  fallbackUrl: '',
});
check('matchScore 命中/误报区分', () => {
  const target = toTrack({ title: 'Resonance', artist: 'HOME', duration: 235 });
  const good = matchScore(toTrack({ title: 'Resonance', artist: 'HOME', duration: 233 }), target);
  const bad = matchScore(toTrack({ title: 'Something Else', artist: 'Nope', duration: 100 }), target);
  assert.ok(good > 0.9, `命中分应高，实际 ${good}`);
  assert.ok(bad < 0.3, `误报分应低，实际 ${bad}`);
});

// ---------- 4) SongResolver 降级调度（Fake 适配器） ----------
checkAsync('SongResolver 主平台失败 → 酷狗兜底命中', async () => {
  const fakeAdapters = {
    netease: { fetchSongUrl: async () => null },
    qq: { fetchSongUrl: async () => null },
    kugou: {
      searchSongs: async () => [
        toTrack({ title: 'Wrong Song', artist: 'Nope', duration: 120 }),
        toTrack({ title: 'Resonance', artist: 'HOME', duration: 234 }),
      ].map((t, i) => ({ ...t, id: `k:${i}`, platform: 'kugou', sourceId: `hash${i}`, extra: { albumId: 'album1' } })),
      fetchSongUrl: async (hash) =>
        hash === 'hash1' ? { url: 'https://cdn.example/real.mp3' } : null,
      fetchLyric: async () => null,
    },
  };
  const resolver = new SongResolver(fakeAdapters, () => {});
  const r = await resolver.resolve(
    toTrack({ title: 'Resonance', artist: 'HOME', duration: 235 }),
  );
  assert.ok(r, '应返回兜底结果');
  assert.strictEqual(r.url, 'https://cdn.example/real.mp3');
  assert.strictEqual(r.fallback, true);
  assert.strictEqual(r.sourceId, 'hash1');
});

checkAsync('SongResolver 全部失败返回明确错误（不抛错）', async () => {
  const fakeAdapters = {
    netease: { fetchSongUrl: async () => { throw new Error('接口故障'); } },
    qq: { fetchSongUrl: async () => null },
    kugou: {
      searchSongs: async () => [],
      fetchSongUrl: async () => null,
      fetchLyric: async () => null,
    },
  };
  const resolver = new SongResolver(fakeAdapters, () => {});
  const r = await resolver.resolve(toTrack({ title: 'X', artist: 'Y', duration: 0 }));
  assert.ok(r);
  assert.strictEqual(r.url, '');
  assert.strictEqual(r.playable, false);
  assert.match(r.error, /未获取到可播音源/);
});

// ---------- 5) Cookie 隔离与持久化 ----------
check('CookieStore 持久化/隔离/清理', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nebula-cookie-'));
  setCookieDataDir(dir);
  const store = new CookieStore();
  store.set('netease', 'MUSIC_U=abc; __csrf=123', 'token-x', '测试用户');
  const reloaded = new CookieStore();
  assert.strictEqual(reloaded.getHeader('netease'), 'MUSIC_U=abc; __csrf=123');
  assert.strictEqual(reloaded.get('netease').nickname, '测试用户');
  assert.strictEqual(reloaded.getHeader('qq'), undefined, '平台间隔离');
  reloaded.clear('netease');
  assert.strictEqual(new CookieStore().getHeader('netease'), undefined);
});

// ---------- 6) 歌单链接解析 ----------
check('resolveAdapterByUrl', () => {
  assert.deepStrictEqual(resolveAdapterByUrl('https://music.163.com/#/playlist?id=123456'), {
    platform: 'netease',
    id: '123456',
  });
  assert.deepStrictEqual(resolveAdapterByUrl('https://y.qq.com/n/ryqq/playlist/777'), {
    platform: 'qq',
    id: '777',
  });
  assert.strictEqual(resolveAdapterByUrl('https://example.com/foo'), null);
});

// ---------- 7) IPC 安全包装（接口故障 → {ok:false}） ----------
checkAsync('IPC try-catch 包装', async () => {
  const handlers = new Map();
  const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn) };
  const fakeAdapters = {
    netease: {
      fetchPlaylist: async () => {
        throw new Error('模拟接口故障');
      },
    },
    qq: {},
    kugou: {},
  };
  registerIpcHandlers(ipcMain, {
    adapters: fakeAdapters,
    resolver: {},
    lyricService: {},
    cookies: { set() {}, get() { return null; } },
    login: {},
    audioProxy: { urlFor: (u) => u },
  });
  const res = await handlers.get('nebula:import-playlist')(null, {
    url: 'https://music.163.com/#/playlist?id=1',
  });
  assert.strictEqual(res.ok, false);
  assert.match(res.error, /模拟接口故障/);
});

// ---------- 8) Audio probe (magic bytes) ----------
check('looksLikeAudio magic bytes', () => {
  assert.strictEqual(looksLikeAudio(Buffer.from([0x49, 0x44, 0x33, 0x04])), true); // ID3
  assert.strictEqual(looksLikeAudio(Buffer.from('fLaC', 'latin1')), true);
  assert.strictEqual(
    looksLikeAudio(Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70])),
    true,
  ); // ftyp (mp4/m4a)
  assert.strictEqual(looksLikeAudio(Buffer.from('<!DOCTYPE html><html>')), false);
  assert.strictEqual(looksLikeAudio(Buffer.from('<html>'), 'text/html'), false);
});

// ---------- 9) QQ rights parsing ----------
check('parseQqRights strict keys (vip, no svip)', () => {
  const r = parseQqRights({
    user: { vip: { isVip: true, viptype: 8, svip: false, sviptype: 0, vipExpireTime: '1750000000000' } },
  });
  assert.strictEqual(r.isVip, true);
  assert.strictEqual(r.isSvip, false);
  assert.strictEqual(r.vipType, 8);
});

check('parseQqRights svip + seconds expiry', () => {
  const r = parseQqRights({ data: { issvip: 1, superviptype: 11, expiretime: 1900000000 } });
  assert.strictEqual(r.isSvip, true);
  assert.strictEqual(r.vipType, 11);
  assert.ok(r.expiresAt !== null && r.expiresAt > Date.now());
});

check('parseQqRights non-vip', () => {
  const r = parseQqRights({ user: { vip: { isVip: false, viptype: 0 } } });
  assert.strictEqual(r.isVip, false);
  assert.strictEqual(r.isSvip, false);
  assert.strictEqual(r.vipType, 0);
});

// ---------- 10) SongResolver: quality passthrough + probe filtering ----------
checkAsync('SongResolver passes quality preference to adapter', async () => {
  let seen;
  const fakeAdapters = {
    netease: {
      fetchSongUrl: async (_id, _album, quality) => {
        seen = quality;
        return { url: 'https://x/a.mp3' };
      },
    },
    qq: {},
    kugou: {},
  };
  const resolver = new SongResolver(fakeAdapters, () => {});
  const r = await resolver.resolve(toTrack({ title: 'X', artist: 'Y', duration: 0 }), 'lossless');
  assert.strictEqual(seen, 'lossless');
  assert.ok(r);
});

checkAsync('SongResolver probe rejection falls back to error', async () => {
  const fakeAdapters = {
    netease: { fetchSongUrl: async () => ({ url: 'https://dead.example/a.mp3' }) },
    qq: {},
    kugou: {
      searchSongs: async () => [],
      fetchSongUrl: async () => null,
      fetchLyric: async () => null,
    },
  };
  const resolver = new SongResolver(fakeAdapters, () => {}, async () => false);
  const r = await resolver.resolve(toTrack({ title: 'X', artist: 'Y', duration: 0 }));
  assert.ok(r);
  assert.strictEqual(r.url, '');
  assert.strictEqual(r.playable, false);
  assert.match(r.error, /探测|probe/);
});

// ---------- 11) IPC: quality list ----------
checkAsync('IPC nebula:song-qualities', async () => {
  const handlers = new Map();
  const ipcMain = { handle: (ch, fn) => handlers.set(ch, fn) };
  const fakeAdapters = {
    netease: { listQualities: async () => [{ level: 'lossless', label: '无损' }] },
    qq: {},
    kugou: {},
  };
  registerIpcHandlers(ipcMain, {
    adapters: fakeAdapters,
    resolver: {},
    lyricService: {},
    cookies: { set() {}, get() { return null; } },
    login: {},
    audioProxy: { urlFor: (u) => u },
  });
  const res = await handlers.get('nebula:song-qualities')(null, {
    track: { platform: 'netease', sourceId: '1' },
  });
  assert.strictEqual(res.ok, true);
  assert.strictEqual(res.data[0].level, 'lossless');
});

Promise.all(pending).then(() => {
  if (failed) {
    console.error(`后端冒烟测试失败 ${failed} 项`);
    process.exit(1);
  }
  console.log('后端冒烟测试全部通过 ✔');
});
