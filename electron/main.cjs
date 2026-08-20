const { app, BrowserWindow, session, ipcMain, shell, dialog, protocol } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { pathToFileURL } = require('url');

// 后端统一出口（esbuild 打包产物，见 package.json build:main）
const {
  registerIpcHandlers,
  CookieStore,
  setCookieDataDir,
  HttpClient,
  createAdapters,
  SongResolver,
  LyricService,
  NeteaseLogin,
  QqLogin,
  KugouLogin,
  QqRightsService,
  createKugouLoginAdapter,
  qishuiLoginAdapter,
  AudioProxy,
  LyricCache,
  WallpaperLibrary,
  probeAudioUrl,
  normalizeCookieHeader,
  validatePlatformCookie,
} = require('../dist-main/index.cjs');

// wallpaper:// 自定义协议（壁纸预览/媒体服务，支持 Range）
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'wallpaper',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const DEV_URL = process.env.VITE_DEV_SERVER_URL;
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';
/** 主窗口引用（供子窗口回传背景设置）。 */
let mainWindow = null;

/** Spotify OAuth（PKCE）：本地回调端口收 code → 换 token 存 CookieStore。 */
function createSpotifyOAuth(cookies) {
  let busy = false;
  return {
    status: () => !!cookies.get('spotify')?.cookies,
    start: () =>
      new Promise((resolve) => {
        if (busy) return resolve(false);
        if (!SPOTIFY_CLIENT_ID) {
          console.error('[Spotify] 请设置环境变量 SPOTIFY_CLIENT_ID（免费在 developer.spotify.com 注册）');
          resolve(false);
          return;
        }
        busy = true;
        const verifier = crypto.randomBytes(32).toString('base64url');
        const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
        const port = 43891;
        const redirectUri = `http://localhost:${port}/callback`;
        const server = http.createServer(async (req, res) => {
          const url = new URL(req.url, `http://localhost:${port}`);
          if (url.pathname !== '/callback' || !url.searchParams.get('code')) return;
          const code = url.searchParams.get('code');
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<script>window.close()</script><p style="font-family:sans-serif">登录成功，可关闭窗口</p>');
          server.close();
          try {
            const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: redirectUri,
                client_id: SPOTIFY_CLIENT_ID,
                code_verifier: verifier,
              }).toString(),
            });
            const tok = await tokenRes.json();
            if (tok.access_token) {
              cookies.set('spotify', tok.access_token, tok.refresh_token ?? '', 'Spotify');
              resolve(true);
            } else {
              resolve(false);
            }
          } catch {
            resolve(false);
          } finally {
            busy = false;
          }
        });
        server.listen(port, () => {
          const authUrl =
            `https://accounts.spotify.com/authorize?client_id=${SPOTIFY_CLIENT_ID}` +
            `&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}` +
            `&scope=${encodeURIComponent('playlist-read-private playlist-read-collaborative user-library-read')}` +
            `&code_challenge_method=S256&code_challenge=${challenge}`;
          const win = new BrowserWindow({
            width: 520,
            height: 720,
            title: 'Spotify 登录',
            webPreferences: { contextIsolation: true, nodeIntegration: false },
          });
          win.loadURL(authUrl);
          win.on('closed', () => {
            server.close();
            busy = false;
            resolve(false);
          });
        });
      }),
  };
}

/**
 * QQ 音乐官方登录：旧版 ptqrshow 二维码接口已被 403 封禁（网易云 QR 不受影响），
 * 改用官方登录页（独立 partition）扫码，登录后自动读取该 partition 的 Cookie
 * 做 normalize + 校验（uin + 播放票据），成功即落库并关闭窗口。
 */
function createQqLoginWindow(cookies) {
  return new Promise(async (resolve) => {
    const partition = 'persist:qq-music-login';
    const ses = session.fromPartition(partition);
    // 关键修复：每次打开登录窗口前清空该分区的登录态，
    // 避免残留旧账号 Cookie 导致“自动登回旧账号”、无法换号登录。
    try {
      await ses.clearStorageData({ storages: ['cookies', 'localstorage'] });
    } catch (err) {
      console.warn('[QQ登录] 清理旧登录态失败:', err instanceof Error ? err.message : err);
    }
    const win = new BrowserWindow({
      width: 560,
      height: 800,
      backgroundColor: '#0b0c16',
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.setTitle('QQ 音乐登录（官方页面扫码）');
    win.loadURL('https://y.qq.com/');

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      resolve(result);
    };

    // 每 2s 读取一次 partition Cookie，出现 uin + 播放票据即视为登录成功
    const timer = setInterval(async () => {
      try {
        const list = await ses.cookies.get({});
        const raw = list.map((c) => `${c.name}=${c.value}`).join('; ');
        const normalized = normalizeCookieHeader(raw);
        const v = validatePlatformCookie('qq', normalized);
        if (v.ok) {
          cookies.set('qq', normalized, undefined, 'QQ 音乐');
          if (!win.isDestroyed()) win.close();
          finish({ ok: true, message: 'QQ 音乐登录成功' });
        }
      } catch {
        /* keep polling */
      }
    }, 2000);

    win.on('closed', () => finish({ ok: false, error: '登录窗口已关闭' }));
  });
}

function createKugouLoginWindow(cookies, kugouLogin) {
  return new Promise(async (resolve) => {
    const partition = 'persist:kugou-login';
    const ses = session.fromPartition(partition);
    try {
      await ses.clearStorageData({ storages: ['cookies', 'localstorage'] });
    } catch (err) {
      console.warn('[酷狗登录] 清理旧登录态失败:', err instanceof Error ? err.message : err);
    }
    const win = new BrowserWindow({
      width: 560,
      height: 800,
      backgroundColor: '#0b0c16',
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.setTitle('酷狗音乐登录（官方页面）');
    win.loadURL('https://www.kugou.com/');

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearInterval(timer);
      resolve(result);
    };

    // 方式1：监听 Set-Cookie 响应头，直接捕获登录 cookie
    const capturedCookies = new Map();
    ses.webRequest.onHeadersReceived({ urls: ['*://*.kugou.com/*'] }, (details, callback) => {
      const headers = details.responseHeaders || {};
      const setCookie = headers['set-cookie'] || headers['Set-Cookie'];
      if (setCookie && Array.isArray(setCookie)) {
        for (const sc of setCookie) {
          const name = sc.split('=')[0].trim();
          const value = sc.split('=')[1] ? sc.split('=')[1].split(';')[0].trim() : '';
          if (name && value) {
            capturedCookies.set(name, value);
          }
        }
        // 检查是否捕获到关键字段
        const hasUserid = capturedCookies.has('userid');
        const hasToken = capturedCookies.has('token');
        const hasKuGoo = capturedCookies.has('KuGoo');
        console.log('[酷狗登录] Set-Cookie 捕获:', Array.from(capturedCookies.keys()).join(', '));

        if (hasKuGoo || (hasUserid && hasToken)) {
          console.log('[酷狗登录] 通过 Set-Cookie 检测到登录态!');
          doLoginSuccess();
        }
      }
      callback({ cancel: false, responseHeaders: details.responseHeaders });
    });

    // 方式2：定时轮询 cookie store（备用）
    let pollCount = 0;
    const timer = setInterval(async () => {
      try {
        pollCount++;
        const list = await ses.cookies.get({});
        if (pollCount % 5 === 0) {
          console.log('[酷狗登录] 轮询 #' + pollCount + ' cookie 数量:', list.length, '字段:', list.map(c => c.name).join(', '));
        }

        // 合并两种来源的 cookie
        const allNames = new Set([...list.map(c => c.name), ...capturedCookies.keys()]);

        if (allNames.has('KuGoo') || (allNames.has('userid') && allNames.has('token'))) {
          console.log('[酷狗登录] 通过轮询检测到登录态!');
          doLoginSuccess();
        }
      } catch (err) {
        console.warn('[酷狗登录] 轮询异常:', err instanceof Error ? err.message : err);
      }
    }, 1500);

    async function doLoginSuccess() {
      // warmup 导航触发 token 签发
      try {
        await win.loadURL('https://www.kugou.com/newuc/user/uc/type=edit');
      } catch { /* ignore */ }
      await new Promise((r) => setTimeout(r, 2000));

      // 收集所有 cookie
      const list = await ses.cookies.get({});
      // Use ||| delimiter to safely join cookies (KuGoo value contains & separators)
      const storeCookies = list.map(c => `${c.name}=${c.value}`).join('|||');
      const storeNames = new Set(list.map(c => c.name));
      const capturedExtra = Array.from(capturedCookies.entries())
        .filter(([k]) => !storeNames.has(k))
        .map(([k, v]) => `${k}=${v}`).join('|||');
      const finalParts = [storeCookies, capturedExtra].filter(Boolean);
      const finalRaw = finalParts.join('|||');

      console.log('[酷狗登录] 保存 cookie 字段:', [...new Set([...list.map(c => c.name), ...capturedCookies.keys()])].join(', '));
      cookies.set('kugou', finalRaw, undefined, '酷狗音乐');
      if (!win.isDestroyed()) win.close();
      finish({ ok: true, message: '酷狗音乐登录成功' });
    }

    win.on('closed', () => finish({ ok: false, error: '登录窗口已关闭' }));
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0a0b15',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow = win;
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });

  if (DEV_URL) {
    win.loadURL(DEV_URL);
  } else {
    const indexHtml = path.join(__dirname, '../dist/index.html');
    if (fs.existsSync(indexHtml)) {
      win.loadFile(indexHtml);
    } else {
      win.loadURL(
        'data:text/html;charset=utf-8,' +
          encodeURIComponent(
            '<div style="font-family:sans-serif;background:#0a0b15;color:#fff;height:100vh;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px">' +
              '<h2>未找到构建产物 dist/index.html</h2>' +
              '<p>请先运行 <code>pnpm build:desktop</code> 后再启动 electron .</p>' +
              '</div>',
          ),
      );
    }
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

/**
 * 全局请求拦截：
 * 1) onBeforeSendHeaders —— 对音乐平台域名注入 Referer/Origin/UA，解决 <audio> 防盗链 403；
 * 2) onHeadersReceived —— 放开跨域响应头，防止音频被 CORS 拦截。
 */
function setupRequestInterception() {
  const ses = session.defaultSession;
  const inject = (urls, headers) => {
    ses.webRequest.onBeforeSendHeaders({ urls }, (details, callback) => {
      details.requestHeaders = { ...details.requestHeaders, ...headers };
      callback({ requestHeaders: details.requestHeaders });
    });
  };

  inject(['*://*.music.163.com/*', '*://music.163.com/*', '*://*.music.126.net/*'], {
    Referer: 'https://music.163.com/',
    Origin: 'https://music.163.com',
    'User-Agent': UA,
  });

  inject(['*://*.qq.com/*', '*://y.qq.com/*', '*://*.gtimg.cn/*', '*://*.qpic.cn/*'], {
    Referer: 'https://y.qq.com/',
    Origin: 'https://y.qq.com',
    'User-Agent': UA,
  });

  inject(['*://*.kugou.com/*', '*://*.kugou.com.cn/*', '*://*.kugou.net/*'], {
    Referer: 'https://www.kugou.com/',
    Origin: 'https://www.kugou.com',
    'User-Agent': UA,
  });

  ses.webRequest.onHeadersReceived(
    { urls: ['*://*.music.163.com/*', '*://*.music.126.net/*', '*://*.qq.com/*', '*://*.gtimg.cn/*', '*://*.kugou.com/*', '*://*.kugou.com.cn/*'] },
    (details, callback) => {
      const responseHeaders = { ...details.responseHeaders };
      responseHeaders['Access-Control-Allow-Origin'] = ['*'];
      responseHeaders['Access-Control-Allow-Credentials'] = ['true'];
      callback({ responseHeaders });
    },
  );
}

/**
 * 本地音乐导入：系统原生文件夹选择器 → 递归扫描 mp3/flac/m4a/aac/ogg/wav →
 * music-metadata 提取 ID3/FLAC/M4A 元数据（歌名/歌手/专辑/内置封面/时长）→ 返回标准 Track 列表。
 */
async function handleOpenLocalDirectory() {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    title: '选择本地音乐文件夹',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths.length) {
    return { ok: true, data: { tracks: [], canceled: true } };
  }
  const root = result.filePaths[0];
  const files = [];
  const walk = (dir, depth) => {
    if (depth > 3 || files.length >= 500) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const en of entries) {
      const p = path.join(dir, en.name);
      if (en.isDirectory()) {
        walk(p, depth + 1);
      } else if (/\.(mp3|flac|m4a|aac|ogg|wav)$/i.test(en.name)) {
        files.push(p);
        if (files.length >= 500) return;
      }
    }
  };
  walk(root, 0);
  files.sort((a, b) => a.localeCompare(b));
  if (!files.length) {
    return { ok: true, data: { tracks: [], canceled: false } };
  }

  let mm;
  try {
    mm = await import('music-metadata');
  } catch (err) {
    return { ok: false, error: `music-metadata 加载失败: ${err instanceof Error ? err.message : String(err)}` };
  }

  const tracks = [];
  for (const f of files) {
    try {
      const meta = await mm.parseFile(f, { duration: true });
      const pic = meta.common.picture?.[0];
      const cover = pic?.data?.length
        ? `data:${pic.format || 'image/jpeg'};base64,${pic.data.toString('base64')}`
        : '';
      tracks.push({
        id: `local:${f}`,
        title: meta.common.title || path.basename(f, path.extname(f)),
        artist: meta.common.artist || (meta.common.artists || []).join(', ') || '未知歌手',
        artists: meta.common.artists ?? [],
        album: meta.common.album ?? '',
        cover,
        duration: Math.round(meta.format.duration || 0),
        platform: 'local',
        sourceId: f,
        originalUrl: pathToFileURL(f).href,
        fallbackUrl: '',
      });
    } catch {
      /* 损坏/不支持的音频跳过 */
    }
  }
  return { ok: true, data: { tracks, canceled: false } };
}

app.whenReady().then(() => {
  // Cookie/Token 安全落在应用用户数据目录，按平台隔离持久化
  setCookieDataDir(app.getPath('userData'));

  const cookies = new CookieStore();
  const http = new HttpClient(cookies);
  const audioProxy = new AudioProxy(cookies);
  audioProxy.start();
  const adapters = createAdapters(http, cookies);
  const resolver = new SongResolver(
    adapters,
    (m) => console.warn('[SongResolver]', m),
    (url, platform) =>
      probeAudioUrl(url, { platform, cookie: cookies.getHeader(platform) }).then((r) => r.ok),
  );
  // 歌词磁盘缓存 + 自定义覆盖（存 userData，跨重启保留）
  const lyricCache = new LyricCache(app.getPath('userData'));
  const lyricService = new LyricService(adapters, lyricCache);
  const wallpaperLibrary = new WallpaperLibrary();
  protocol.handle('wallpaper', (request) => wallpaperLibrary.handle(request));
  const login = new NeteaseLogin(http, cookies);
  const qqLogin = new QqLogin(http, cookies, new QqRightsService(http));
  const kugouLogin = new KugouLogin(cookies);

  // 启动探活：已存 cookie 自动校验登录态，失败仅标记未登录，不抛异常
  login.probeLogin();
  const loginAdapters = {
    netease: {
      platform: 'netease',
      name: '网易云音乐',
      kind: 'qr',
      createQr: () => login.createQr(),
      pollLogin: (unikey) => login.pollLogin(unikey),
      getAccount: () => login.getAccount(),
      getMyPlaylists: () => login.getMyPlaylists(),
    },
    qq: {
      platform: 'qq',
      name: 'QQ 音乐',
      kind: 'qr',
      createQr: () => qqLogin.createQr(),
      pollLogin: (unikey) => qqLogin.pollLogin(unikey),
      getAccount: () => qqLogin.getAccount(),
      getMyPlaylists: () => qqLogin.getMyPlaylists(),
    },
    kugou: createKugouLoginAdapter({ getAccount: () => kugouLogin.getAccount(), getMyPlaylists: () => adapters.kugou.fetchMyPlaylists() }),
    qishui: qishuiLoginAdapter,
    spotify: {
      platform: 'spotify',
      name: 'Spotify',
      kind: 'oauth',
      getAccount: async () => {
        const rec = cookies.get('spotify');
        return rec?.cookies ? { userId: 'spotify', nickname: 'Spotify 用户' } : null;
      },
      getMyPlaylists: () => adapters.spotify.getMyPlaylists(),
    },
  };

  registerIpcHandlers(ipcMain, {
    adapters,
    resolver,
    lyricService,
    cookies,
    login,
    loginAdapters,
    audioProxy,
    spotifyOAuth: createSpotifyOAuth(cookies),
    qqLoginWindow: () => createQqLoginWindow(cookies),
    kugouLoginWindow: () => createKugouLoginWindow(cookies, kugouLogin),
    wallpaperLibrary,
    // 退出登录时同步清空 QQ 官方登录窗口独立分区的 Cookie，
    // 确保 CookieStore 与浏览器会话一并干净退出。
    onCookieClear: async (platform) => {
      if (platform !== 'qq') return;
      try {
        await session.fromPartition('persist:qq-music-login').clearStorageData({
          storages: ['cookies', 'localstorage'],
        });
      } catch (err) {
        console.warn('[QQ登录] 退出时清理分区 Cookie 失败:', err instanceof Error ? err.message : err);
      }
    },
  });
  ipcMain.handle('nebula:open-local-directory', handleOpenLocalDirectory);
  ipcMain.handle('nebula:open-external', (_event, payload) => {
    const url = String(payload?.url ?? '');
    if (/^[a-z][a-z0-9+.-]*:/i.test(url) && !/^(javascript|data):/i.test(url)) {
      return shell.openExternal(url);
    }
    return false;
  });
  // 壁纸库原生子窗口：尺寸随主窗口比例，带系统边框
  ipcMain.handle('nebula:wallpaper:open', async () => {
    if (!mainWindow) return { ok: false, error: '主窗口不存在' };
    const [mw, mh] = mainWindow.getSize();
    const win = new BrowserWindow({
      width: Math.max(720, Math.round(mw * 0.72)),
      height: Math.max(520, Math.round(mh * 0.68)),
      title: 'Wallpaper Engine 壁纸库',
      backgroundColor: '#0b0c16',
      parent: mainWindow,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    });
    const query = DEV_URL
      ? `${DEV_URL}${DEV_URL.includes('?') ? '&' : '?'}view=wallpaper`
      : path.join(__dirname, '../dist/index.html');
    if (DEV_URL) win.loadURL(query);
    else win.loadFile(query, { query: { view: 'wallpaper' } });
    return { ok: true };
  });
  ipcMain.on('nebula:wallpaper:applied', (_event, data) => {
    mainWindow?.webContents.send('nebula:wallpaper:applied', data);
  });
  setupRequestInterception();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
