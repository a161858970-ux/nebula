# Music Nebula — 项目总览与开发手册

> 可视化 3D 音乐播放器（桌面版 Electron + 前端 3D 卡片星云墙）。
> 本文档与 `HANDOFF.md`、`CHANGE_LOG.md`、`NOTES.md`、`UI_SPEC.md`、`LYRICS_SYSTEM.md` 配套维护：每次代码变更必须同步追加变更日志；跨模型/跨 agent 接手先读 `HANDOFF.md`。

## 1. 项目定位

一个全屏 3D 音乐卡片墙播放器：

- 主界面是带透视感的 3D 舞台，数千张音乐卡片按“中心密、四周稀”伪随机散落，形成音乐星云。
- 鱼眼透视：离视口中心越近的卡片越大越亮，越远越小且带模糊；中心卡片可放大至 1.8x~2.2x，边缘衰减至 0.4x~0.6x。
- 无限平移画布（类 Google Earth / Figma）：拖拽或滚轮可漫游，视口外卡片通过虚拟化裁剪（只渲染视口 + 缓冲区内的卡片）。
- 底部悬浮播放控制条（Glassmorphism），全局 AudioPlayer 单例驱动播放/暂停/上下曲/进度/收藏。
- 支持网易云 / QQ 音乐 / Spotify / 酷狗 / 汽水多平台账号登录，登录后自动拉取"我的歌单"；左侧歌单导入 Dock（小球 → 胶囊 → 窗口）支持账号歌单与手动链接导入。
- 歌单、音源、歌词、评论通过统一 Adapter 接入；音源失败自动跨平台兜底（SongResolver）。
- 歌曲详情 / 歌手主页 / 评论页面已接入（底部条与歌名/歌手点击进入）。

## 2. 技术栈与结构

React 18 + TypeScript + Vite（单文件构建）+ Electron 43 + esbuild（主进程打包）。

```
music-nebula/
├─ src/
│  ├─ main/                    # 主进程 / Node 后端逻辑（纯 TS，可独立于 Electron 运行）
│  │  ├─ adapters/             # 平台适配器：netease / qq / kugou / spotify + 字段映射 mappers
│  │  ├─ encrypt/ncmCrypto.ts  # 网易云 weapi / eapi 加密（AES/RSA/MD5，登录与后续加密接口共用）
│  │  ├─ login/                # 多平台登录适配器（neteaseLogin / qqLogin / index）
│  │  ├─ parsers/              # LRC 歌词解析、双语时间轴归并
│  │  ├─ services/             # SongResolver（音源兜底）、LyricService
│  │  ├─ cookieStore.ts        # 按平台隔离 + 原子写入持久化
│  │  ├─ http.ts               # 统一请求层：Referer/UA 伪造 + Cookie 注入 + JSON/表单
│  │  ├─ ipc.ts                # IPC 处理器（playlist / login / cookie / lyric / comment）
│  │  └─ index.ts              # 后端统一出口（esbuild 打包为 dist-main/index.cjs）
│  ├─ components/              # LoginPanel 等前端组件
│  ├─ lib/                     # 前端核心：layout（布局）/ fisheye / panEngine / audio / playlist
│  └─ App.tsx 等
├─ electron/
│  ├─ main.cjs                 # Electron 主进程：窗口、网络拦截（防盗链）、登录接线
│  └─ preload.cjs              # contextBridge 暴露 nebulaAPI
├─ scripts/
│  ├─ backend-smoke.mjs        # 后端冒烟测试（解析/映射/加密/兜底/IPC）
│  ├─ qa.cjs                   # 前端自动化 QA（无头 Chrome：密度/鱼眼/平移/播放/容错）
│  ├─ desktop-check.mjs        # 桌面版启动前环境自检
│  └─ desktop-play-smoke.mjs   # 桌面版播放链路冒烟（需 Playwright）
├─ dist/                       # 桌面版前端构建产物
├─ dist-main/                  # 主进程打包产物
└─ outputs/music-nebula/       # QA/预览产物（pnpm build 输出 + preview.png 等）
```

## 3. 常用命令（Windows PowerShell）

```powershell
$env:pnpm_config_verify_deps_before_run='false'   # pnpm 环境必带

pnpm build            # tsc 类型检查 + vite 构建 -> outputs/music-nebula/index.html
pnpm build:main       # 仅打包主进程 -> dist-main/index.cjs
pnpm build:desktop    # 完整桌面构建（dist + dist-main）
pnpm desktop          # 环境自检后启动 Electron 桌面版
pnpm qa:backend       # 后端冒烟测试（自动先 build:main）
pnpm qa               # 前端自动化 QA（无头 Chrome，需本机 Chrome）
pnpm qa:desktop-play  # 桌面播放链路冒烟
```

> Node 运行时：`C:\Users\LIU\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`

## 4. 关键架构决策（改动前必读）

### 4.1 布局 / 视觉（前端）

- 无限画布按网格 + 伪随机扰动分布卡片；视口虚拟化只挂载可视区 + 缓冲区的卡片（可见卡片 15~25 张）。
- 鱼眼曲线由 `src/lib/fisheye.ts` 控制：中心大、边缘小 + 模糊 + z-index 随距离提升；悬浮卡片转正（rotateZ→0）、放大、置顶。
- 背景系统支持内置动态/静态背景 + 用户自定义上传，选择持久化到 localStorage。

### 4.2 登录（重要！易踩坑）

- **网易云登录必须走 eapi 加密接口**（`POST https://interface.music.163.com/eapi/login/qrcode/unikey` 等，参数 `type=3`），旧明文接口 `music.163.com/api/login/qrcode/*` 已废弃：扫码确认后返回“请切换其他登录方式或升级新版本再试”。
- eapi 请求需携带设备 Cookie（osver / deviceId / WNMCID / appver 等）与客户端 UA，见 `src/main/encrypt/ncmCrypto.ts`。
- 扫码流程：`createQr()` 返回 `{ unikey, payload }` → 前端本地生成二维码 → `pollLogin(unikey)` 轮询（801 等待 / 802 已扫待确认 / 803 成功）。
- 登录成功后 cookie 存入 `CookieStore`（按平台隔离，明文 JSON，位于 `app.getPath('userData')`）。
- QQ 扫码为实验性（ptlogin2）；Spotify 走 OAuth（需 `SPOTIFY_CLIENT_ID`）；酷狗/汽水无公开登录接口（标注不可用）。

### 4.3 音源 / 防盗链

- Electron 主进程用 `webRequest.onBeforeSendHeaders` 对音乐平台域名注入 Referer/Origin/UA，并放开 CORS 响应头。
- 音源失败链路：主平台取 URL → 失败则 SongResolver 用歌名+歌手跨平台搜索兜底 → 前端 `<audio>` onerror 触发 skipNext + 卡片置灰。

### 4.4 测试约定

- 任何后端改动：`pnpm qa:backend` 必须通过；加密类改动需同步在 `backend-smoke.mjs` 补充断言。
- 任何前端交互改动：`pnpm qa` 必须通过（有严格阈值断言）。
- 每次改动后同步更新 `docs/CHANGE_LOG.md`（见第 5 节）。

## 5. 文档维护约定

1. 每次会话/每次改动完成时，向 `docs/CHANGE_LOG.md` 追加一条记录（日期、目标、改动、验证、遗留）。
2. 若出现新的踩坑经验或平台接口变动，同步更新 `docs/NOTES.md`。
3. 架构级变化（新模块、新目录、新依赖）同步更新本文件第 2/3 节。
