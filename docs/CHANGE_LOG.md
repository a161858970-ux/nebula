# Music Nebula 变更日志

> 维护约定：每次代码/文档改动后，在文件**顶部**（本说明之下）追加一条最新记录。
> 条目格式：`YYYY-MM-DD — 摘要`，内容包含：目标 / 改动点 / 验证方式 / 遗留与风险。

---

## 2026-08-19 — seek 歌词消失修复 + 英文歌词空格丢失修复

**目标**

1. 修复 seek（拖动进度条）后部分歌词行永久消失的 bug。
2. 修复 YRC/QRC 英文歌词偶尔变成无空格连续字母（如 wearetheworld）的 bug。

**改动**

1. **Bug1 - consumedRef seek 清理**（src/components/LyricsLayer.tsx）：
   - 原逻辑仅在回退 >1.5s 时清空 consumedRef，导致小幅 seek 后已飞出的句无法重新入场。
   - 新逻辑：任意方向 seek >200ms 即清除时间戳在新位置之后的 consumed 条目；回退 >1.5s 仍做完全清空。
   - 向前 seek 时不受影响（未来句本就不会在 consumed 中）。

2. **Bug2 - 英文歌词空格对齐**（src/lib/lyrics.ts + src/hooks/lyrics/useLyrics.ts）：
   - 新增 alignWordsToText()：在 mergeWordLyrics 之后调用，逐行检查 YRC word 拼接文本与 LRC text 是否一致（忽略空格）。
   - 不一致时（如 word 被拼为连续字符串而 LRC text 含空格），按 LRC text 的空格位置拆分 words，并按字符比例分配 YRC 时间戳。
   - 仅在拼接一致但空格位置不同时生效，CJK 逐字和正常 Latin 分词不受影响。
   - 架构预留：函数为纯转换层，后续新增歌词来源（酷狗/汽水/Spotify 等）只需在 mergeWordLyrics 后继续调用即可。

**验证**

- pnpm build（tsc + vite）通过。


## 2026-08-19 — float 模式 LRC 伪逐字拆分

**目标**

float 模式 + LRC 行级歌词时，上浮发光特效整行一起变、看不出逐字推进。修复后 float 模式为 LRC 行生成伪逐字拆分，sweep 模式和 YRC/QRC 完全不受影响。

**改动**

- `src/components/LyricsLayer.tsx`：
  - 新增 `pseudoWordsMap`（useMemo），仅 `highlightStyle === 'float'` 时生成；sweep 模式返回空 Map → 走原有 whole-line 回退路径，行为零变化。
  - 分词策略：CJK 逐字、Latin 按空格分词（空格不作独立 token），行时长由下一行 timeMs 差值推算。
  - 渲染区根据 `pseudoWordsMap` 决定创建逐字 span 或整行 span。
  - 动画帧 per-word 路径优先取 `line.words`（真实 YRC/QRC），其次取 `pseudoWordsMap`（伪逐字），`--wp`/`--feather` 逻辑不变。

**验证**

- `pnpm build`（tsc + vite）通过。
- `pnpm check:arch` 通过。
- `pnpm qa:backend` 全部通过。
- 四种组合行为：sweep+LRC / sweep+YRC / float+LRC / float+YRC 互不影响。


## 2026-08-19 — 迁移交接文档：HANDOFF + LYRICS_SYSTEM + 待办更新

**目标**

为跨模型 / 跨 agent harness 接手做准备：把散落在会话上下文中的协作偏好、歌词系统设计参数、已废弃决策沉淀为可独立交接的文档。

**改动**

- 新增 `docs/HANDOFF.md`：新接手者必读顺序、与用户协作的基本规则（重大改动先沟通 / 行为零变化 / UI 以现有实现为唯一真源 / git 提交+推送 / 不输出截图 png / 文档同步约定）、产品原则与当前状态速览。
- 新增 `docs/LYRICS_SYSTEM.md`：Z1 三身份带状系统设计规格（空间带参数、生命周期、逐字高亮、赋色层级、安全区与朝向、已废弃决策）；参数与 `LyricsLayer.tsx` 常量核对一致。
- `docs/NOTES.md`：勾掉已完成待办（歌词面板上下分区、左右 Dock 重构），新增液态玻璃主题待办；**明确废弃 Z1 大字号左→右长句提前入场方案（旧第 9/10 点，用户确认不需要）**，不再排期。
- `docs/PROJECT.md`：文档体系引用加入 HANDOFF / LYRICS_SYSTEM。

**验证**

- 纯文档改动，无代码构建；文档与代码常量交叉核对（LyricsLayer.tsx 的 MARGIN/MAIN_Y/NEXT_MAG/NEXTNEXT_MAG/X_OFF/VERTICAL_P/入场/离场参数）。

**遗留与风险**

- HANDOFF.md 中的协作规则为用户原话归纳，若后续协作方式变化需同步更新；歌词规格中"已废弃"条目请勿重新实现。

## 2026-08-18 — 架构收敛第 9 步收尾：StageCanvas 区块化

**改动**

- 新增 `src/components/StageCanvas.tsx`（Z2 区块）：stage-3d + 卡片虚拟化渲染收纯 props（memo 化），同层区块互不依赖。
- App.tsx：597 → 587 行，stage-3d JSX 收敛为 `<StageCanvas />` 组合接线。

**验证**

- pnpm build / check:arch / qa 全绿（虚拟化 / 拖拽 / 悬浮 / 导入链路不变）。

## 2026-08-18 — 架构收敛第 9 步：useStage（舞台领域收尾）

**改动**

- 新增 `src/hooks/stage/useStage.ts`：收敛 hoveredId / visibleIds / failedIds / likedIds / importing、卡片注册（registerEl + glassGlow）、悬浮态（右键菜单防抢占）、PanController 生命周期 + `__nebula` 调试口、虚拟化渲染数据（cards/metrics/effectiveCards/spatial）、渐进揭示（beginImport/resetImportState）、卡片点播、回到中心、喜欢切换、会话记忆恢复。
- 新增 `src/lib/stage.ts`（FrameBus + CULL_BUFFER 下沉，LyricsLayer 改为从 lib 取类型）与 `src/lib/preferences.ts`（preferredQuality 下沉，App 与 useStage 共用）。
- App.tsx：906 → 597 行；删除全部 stage 状态/refs/派生 memo/回调/effect，改为 `useStage({...})` 组合接线；searchCluster 与 useStage 共享 controllerRef/metricsRef/effectiveCardsRef（App 声明，useStage 渲染时写入）。
- useStage 只依赖 lib（audioPlayer / LibraryService / 布局 / 空间索引 / 搜索 / 玻璃发光），不依赖其他 hook；高频播放状态经 `currentSongId` 参数注入，避免跨领域 import。

**验证**

- pnpm build / check:arch / qa 全绿（虚拟化、拖拽、滚轮、渐进导入、卡片点播、失败置灰、音质菜单、本地导入全部通过）。

**遗留与风险**

- useStage 是大领域（Q6 确认后期可再拆：虚拟化 / 揭示 / 交互），目前保持单 hook 收敛。

## 2026-08-18 — 架构收敛第 8 步：三 Context 落地 + 区块化 + 叶子高频订阅

**改动**

- 新增 `src/hooks/playback/PlaybackContext.tsx`：`PlaybackProvider` 订阅 audioPlayer 单例，`same()` 引用对比只广播低频字段（song/playing/mode/quality/loading/failed/error/qualities），不含 currentTime/duration；挂载于 `main.tsx`（App 自身也消费，Provider 必须在 App 之上）。
- 新增 `src/hooks/interfaceSettings/InterfaceSettingsContext.tsx` 与 `src/hooks/background/VisualAtmosphereContext.tsx`：值由 App 组合层 `useMemo` 生成并下传。
- `LyricsLayer`：删 props（currentTime/playing/settings），内部 `useAudioPlayer()` 叶子订阅 + 两个 context；自行从 custom/atmosphere 推导色板并写 `--lyric-*` 变量（原 App「歌词配色桥」effect 移除，`--cover-*` 变量本就无消费方）。
- `NowPlayingPanel` / `OverlayStack`：删 song/playing/loading/currentTime/duration props，NowPlayingPanel 内部叶子订阅。
- `check-arch.mjs`：修 resolveTarget 扩展名解析（此前 BLOCKS 规则对无扩展名导入失效）；BLOCKS 移除 NowPlayingPanel/InfoModals（它们是 OverlayStack 组成面板）；AccountDock 类型导入改走 `lib/backgrounds` / `lib/lyricSettings`，删除组件内冗余 re-export。
- App.tsx：`useAudioPlayer()` → `usePlayback()`（低频）；删除歌词配色桥 effect 与 coverColors 相关 import；LyricsLayer/OverlayStack JSX props 收敛。

**验证**

- pnpm build / check:arch / qa 全绿（音质菜单链路经 QA 10g 验证，修复了 Provider 位置导致 songQualities 不触发的回归）。

**遗留与风险**

- App 仍持有 stage 领域状态（hovered/visible/failed/liked/渐进揭示/PanController），第 9 步 useStage 迁移。

## 2026-08-18 — 架构收敛第 7 步：useSearchCluster + useEdgePanels

**改动**

- 新增 `src/hooks/searchCluster/useSearchCluster.ts`：searchMatches + 聚簇定位 handlers；经组合层接收 stage refs（controllerRef/effectiveCardsRef/metricsRef），不依赖 usePlaylist。
- 新增 `src/hooks/edgePanels/useEdgePanels.ts`：edge 状态、热点触发、移出防抖、onMove 监听；经组合层接收 contextMenuRef（右键菜单打开时暂停隐藏）。
- App：移除 searchMatches 状态、applySearch/3 个搜索 handler、edge 状态/4 个 handler/onMove effect 与稳定回调；布局 refs 提前声明（null! 早期声明），搜索 hook 在其后调用，memo 保持依赖 searchMatches。

**验证**

- pnpm build / check:arch / qa 全绿（含搜索/边缘面板链路）。

## 2026-08-18 — 架构收敛第 6 步：useBackground（VisualAtmosphere 中间层）+ useInterfaceSettings

**改动**

- 新增 `src/lib/atmosphere.ts`：`VisualAtmosphere` 中间层类型（palette/sample），useBackground 只产出数据、不直接修改歌词/玻璃。
- 新增 `src/hooks/background/useBackground.ts`：拥有 bgSetting/bgCoverMode、壁纸应用订阅、环境光 CSS 变量（背景自有输出）与歌词色板采样（产出 atmosphere）；`CoverBgMode` 类型下沉 `lib/backgrounds.ts`。
- 新增 `src/hooks/interfaceSettings/useInterfaceSettings.ts`：沉浸开关（隐藏卡片/歌词层）+ 持久化。
- App：移除 bgSetting/bgCoverMode/uiHide* 四个状态、5 个 handler、三个采样/订阅 effect；新增「歌词配色桥」组合层 effect（从 atmosphere + custom 设置推导歌词 CSS 变量），行为等价。

**验证**

- pnpm build / check:arch / qa 全绿。

## 2026-08-18 — 架构收敛第 5 步：useLyrics

**改动**

- 新增 `src/hooks/lyrics/useLyrics.ts`：歌词运行态（lyricLines 拉取/归一化，低频订阅 audioPlayer 随切歌触发）+ 设置（lyricSettings 持久化 + 全部 handler）+ 翻译开关（更名 `lyricTranslationEnabled`）。
- `src/lib/lyricSettings.ts`：`LyricVisualSettings` 共享类型下沉，LyricsLayer 改为从 lib 取（hooks 不 import 组件）。
- App：lyricLines/lyricSettings/lyricTranslate 三个状态、歌词拉取 effect、翻译开关与 9 个歌词设置 handler、normalizeLyricLines 全部迁出；JSX 改用 hook 返回值。

**验证**

- pnpm build / check:arch / qa 全绿。

## 2026-08-18 — 架构收敛第 4 步：OverlayStack 抽取 + HUD memo 化

**改动**

- 新增 `src/components/OverlayStack.tsx`（Z4 浮层区块）：二级播放窗 / 壁纸窗口 / 信息弹层 / 模式 toast / 右键菜单合并为单一 memo 区块，App 的浮层 JSX 收敛为一行组件调用。
- TopBar / AccountDock / PlaylistDock / BottomBar 全部 `React.memo` 化；App 提供稳定回调（enter/leave 三面板、播放器 toggle/prev/next/seek、壁纸开关、弹层开关），`searchSlot` 用 `useMemo` 稳定化，消除内联箭头对 memo 的破坏。
- usePlaylistImport 的 onSessionStart/onImported 改为稳定 useCallback（组合层转发 ref），保证 importer 方法身份稳定。

**验证**

- pnpm build / check:arch / qa 全绿。

## 2026-08-18 — 架构收敛第 3 步：useOverlays

**改动**

- 新增 `src/hooks/overlays/useOverlays.ts`：右键菜单（含 contextMenuRef）/ 信息弹层（评论·详情·歌手）/ 二级播放窗 / 模式 toast 的状态与 handlers 全部迁出；只依赖 audioPlayer / LibraryService / IPC 服务。
- App：nowPlayingOpen / modeToast / contextMenu / infoModal 四个状态与 openContextMenu…playArtistTrack 六个 handler 移除；歌手页点播由组合层 `handlePlayArtistTrack = playArtistTrack + handleReset` 接线。

**验证**

- pnpm build / check:arch / qa 全绿。

## 2026-08-18 — 架构收敛第 2 步：LibraryService + useLibrary + usePlaylist + usePlaylistImport

**改动**

- 新增 `src/lib/library.ts`（LibraryService 单例：仅 track/catalog 数据，不持有 currentPlaylist；`applyImported` 唯一导入入口）+ `src/hooks/library/useLibrary.ts`（纯订阅适配层）。
- 新增 `src/hooks/playlist/usePlaylist.ts`（当前歌单身份 + 队列播放入口）与 `src/hooks/playlistImport/usePlaylistImport.ts`（手动/平台/本地三入口，只负责解析与状态）。
- `src/lib/playlistTypes.ts`：`ImportStatus` / `PlaylistMeta` 共享类型下沉，ImportBar 改为从 lib 取类型（满足 hooks 不得 import 组件、hooks 不得跨领域 import）。
- App：songs/currentPlaylist/importStatus/importMessage/localBusy 状态移除；曲库初始化用演示数据填充 LibraryService；导入走组合层接线（sessionStartRef/commitRef 打破 TDZ）；beginImport 改经 library.applyImported + importer.complete；会话记忆效果暂留 App（随 Stage 步迁移）。

**验证**

- pnpm build / check:arch / qa 全绿（含演示导入、本地导入、播放链路零回归）。

## 2026-08-18 — 架构收敛第 1 步：ARCHITECTURE.md + check-arch + useAccounts

**改动**

- 新增 `docs/ARCHITECTURE.md`（App.tsx 领域化收敛唯一真源）：领域清单（11 hooks + LibraryService/audioPlayer）、依赖 DAG、3 个 Context 形状、视图区块、Dependency Rules 7 条、插花式迁移路线 9 步。
- 新增 `scripts/check-arch.mjs`（机制化依赖守卫，接入 `pnpm check:arch` 并随 `pnpm qa` 运行）：lib→hooks/components、hooks 跨领域（白名单）、同层区块互依等规则。
- 迁移第 1 步：账号域抽出 `src/hooks/accounts/useAccounts.ts`（platforms/accounts/loginNonce/drawerPlatform + 探活/refresh/requestLogin）；App 只保留组合层 `handleGoLogin = requestLogin + showPanel`。

**验证**

- pnpm build / check:arch / qa 全绿（行为零变化）；后续步骤按 ARCHITECTURE.md 路线继续。

## 2026-08-17 — 顶部搜索全网搜索/点播 + 歌手卡片 + 查询保留

**改动**

- 后端：网易云/QQ 新增 `searchArtists`（网易云 type=100、QQ t=1）；LyricService 新增 `searchSongs`（网易云+QQ+酷狗并发、去重裁剪）与 `searchArtists`；IPC `nebula:search-songs` / `nebula:search-artists`；preload 暴露；ipcClient 补类型。
- 前端 SearchBar：输入防抖 350ms 发起全网搜索；结果排序 = 本歌单匹配优先 → 全网歌手卡（与歌曲卡同款，点击打开与底部条歌手名同款同逻辑的歌手页）→ 全网歌曲（点击点播）；网络结果带分隔线与计数。
- 点播语义：新增 AudioPlayer `playTransient`——仅播放该曲、不替换当前队列、不影响 Z2 卡片；该曲播放结束（或用户切下一首）时自动接回原歌单队列继续；单曲循环模式下临时曲不循环。
- 查询保留：收起/重开搜索框不再清空输入，仅点 × 或手动清除；Esc 只关闭不清理。

**验证**

- 无头 Chrome：下拉排序（本歌单→歌手→网络歌曲）正确、歌手卡打开歌手主页、点播后 next 接回歌单（id 1）、Esc 后重展开输入保留、× 清空生效；pnpm build / qa / qa:backend / build:desktop 全绿、零控制台错误。

## 2026-08-16 — 修复：回顶按钮被透明胶囊拦截 / Z1 歌词左出句尾早消与出场角度

**改动**

- 回到顶部会收起窗口：根因是开窗后胶囊透明化但仍保留 button 命中区（z-index 3 盖住吸顶头顶部一条），点击 ⬆ 实际命中胶囊触发收起。修复：开窗时胶囊本体 `pointer-events:none`（穿透到窗口内容），仅球头图标与箭头保留可点（用于关闭）；实测 `elementFromPoint` 命中按钮本身、真实点击后窗口保持打开且 scrollTop→0。
- Z1 歌词左出句尾早消：根因是回收判定用句首坐标 `sx < -MARGIN` 判越界，左出时句尾还在屏内即被删除。修复：按出场方向判整句越界（右出看句首、左出看句尾 `sx + 句宽 < -MARGIN`），且左出目标改为让句尾越过左边界（`exitX = -2*MARGIN - 句宽`），`exitT` 到时句尾也已完全出屏。
- Z1 当前句出场角度：出场向量整体旋转 ±1.5°–5° 随机小角度（左右概率判定不变，仍各 50%），不再是纯水平左右出。

**验证**

- 无头 Chrome：回顶 elementFromPoint 命中按钮、点击后窗口不收起且回顶生效；pnpm build / qa / build:desktop 全绿、零控制台错误。

## 2026-08-16 — 修复：歌词取色 radio 对齐 / 歌单吸顶与回顶 / 搜索折叠态文字渗出

**改动**

- 歌词取色 radio 整组右移：根因是「自定义」选项内容比四字选项窄，`width:fit-content` 使整组变窄、`margin-left:auto` 推右。修复：radio label 统一 `min-width: 71px`（四字宽），五组 radio 左缘全部对齐（实测 1415=1415）。
- 歌单展开吸顶偏下：根因是滚动容器（win-inner）的 `padding-top: calc(ball+12)` 参与 sticky 偏移（实测间隙 55px）。修复：胶囊占位区改为内容首部可滚动的 `win-pad` 垫片、滚动容器 `padding-top:0`，吸顶头真正贴顶（实测 gap 1px）。
- 回到顶部无效：原 ref 挂在非滚动容器 pl-detail 上。修复：ref 改挂真正的滚动容器 win-inner（当前打开行），点击后平滑回顶（实测 scrollTop→0）。
- 搜索折叠态文字渗出：根因是 motion 给 input 内联 `opacity:1` 盖过 CSS 的 `opacity:0`。修复：折叠态 input 加 `visibility:hidden`（不受内联 opacity 影响），未点击时纯净搜索图标。

**验证**

- 无头 Chrome 冒烟：radio 五组左缘一致、吸顶 gap 1px、回顶 scrollTop=0、折叠 input visibility=hidden；pnpm build / qa / build:desktop 全绿、零控制台错误。

## 2026-08-16 — 设置单选玻璃化 + 手动导入输入框 + 右 Dock 图标原位修复

**改动**

- 设置单选：歌词高亮风格 / 歌词布局 / 歌词取色 / 悬浮层次 / 界面主题 5 组改为 slimy-chipmunk-97 复刻的玻璃滑轨单选（双栏、`input ~ .glass-glider` 位移动画）；双银色（亮银 `#c0c0c0→#e0e0e0` / 冷钢银 `#a9b8d9→#cdd9f5`，同色系有差异）；「自定义」label 用 4ch 占位居中对齐（修掉位移歪斜）。
- 手动导入：改为 tidy-pig-67 复刻输入框（placeholder「歌单链接」，回车导入，无导入按钮）；无效链接在输入框下方小字提示「歌单链接无效」；移除手动球虚线边框。
- 右 Dock 修复：登录/设置图标在球态与胶囊态保持原位（球心=右端，padding-right 恒定不再清零）；球态隐藏 dots/badge（消除 Spotify 图标映射到头像上的问题）；登录窗口五家卡片整体居中（去掉 27px 左偏移）。

**验证**

- 无头 Chrome 冒烟：头像/设置图标球↔胶囊零位移、球态 dots 透明、登录卡片容器中心=窗口中心、radio 5 组双栏双银滑轨位移正确、手动输入框 placeholder/无按钮/无效提示生效；pnpm build / qa / build:desktop 全绿、零控制台错误。

## 2026-08-16 — Dock 代码级迁移：Prototype 即视觉真源（重做）

**背景**

- 上一版「参考原型改造」整合出错（旧 CSS/组件结构与原型冲突导致变形爆炸），已 `git revert` 回退。
- 本次改为**代码级迁移**：把用户已验证定稿的 `prototype/dock-prototype-v3.html` 作为唯一视觉真源，CSS 原样搬入、React 组件按原型 DOM 结构逐行移植，不重新设计。

**改动**

- 原型 `<style>` 整段原样追加至 styles.css 末尾（标注「Prototype v3 视觉真源，勿改」）；仅移除会污染全局的 `body` 规则与会被主项目歌单 hover 覆盖的 `.pl-song:hover`（歌曲列表 hover 按用户要求保持主项目原实现）。
- 运行环境差异适配（仅功能层面，不改视觉）：z-index 10→80（保证在画布之上）；边缘感应隐藏态（`:not(.is-open)` 隐藏/移出，应用内为边缘触发，原型常驻）；中和主项目全局 button 高光避免污染原型视觉；平台 logo/头像图片尺寸规则（原型用字母占位，应用用真实 logo，填充色效果保留）。
- PlaylistDock / AccountDock 按原型 DOM 重写：`.dock > .row > .pill + .win > .win-inner`，纯 CSS 单元素自膨胀（球=胶囊）、窗口覆盖胶囊无接缝、四角=胶囊边缘圆四分之一、箭头 ›→⌄→⌃、左 Dock 开窗垂直居中、登录五球各自膨胀成垂直胶囊、set-tabs/set-page 分页、silent-otter 开关；FLIP 置顶用原生 DOM（无 motion/JumpText）。
- 手动导入输入框放在手动球展开的窗口内（原型标注「输入框示意」的位置），导入按钮/状态复用 ImportBar。

**验证**

- 无头 Chrome 逐项对比原型 vs 主项目：closed/hover/open/loginDots/settingsArrow 全部一致（球 42px、胶囊 300px、开窗顶距=底距 81/819、圆角 21px、登录点列位、设置箭头贴左），零控制台错误；开关为同一 CSS 的大小号变体（比例一致、勾号独立动感一致）。
- pnpm build / qa / build:desktop 全绿；已提交并推送 GitHub。

## 2026-08-16 — Dock 细节优化：一体化变形 + 比例化 + 设置排版精修

**改动**

- 左右 Dock 上移：默认首球落点约视口 18vh（上部），窗口打开时整体上移至 8vh 为展开让位。
- 球/胶囊/窗口全部比例化（球 clamp(34px,4.4vh,48px)，胶囊/窗口约 21vw，220–330px，随窗口尺寸缩放）。
- 胶囊改为「从球本身单向展开」：球成为胶囊起点（左端/右端），文本从球右缘（左 Dock）开始出现，点击整个胶囊即可开窗；窗口改为紧贴胶囊下方同宽展开（顶部直角融入胶囊，底圆角），实现「点动成线、线动成面」。
- 修复歌单展开：与窗口同级滚动（去掉嵌套滚动与 overflow 裁剪），吸顶头部恢复、背景层不再断开、无歌曲重叠；窗口高度下限随视口比例，卡片底端不越过底部 25% 线。
- 登录胶囊五平台图标改为等距网格，位置与展开窗口内垂直小胶囊一一对应；窗口内五卡 `minmax(0,1fr)` 强制等宽。
- 设置页切换改为仅从卡片下部延展/收缩（AnimatedHeight + 顶部固定）。
- 开关复刻 uiverse light-lion：blur+contrast 液态圆点 + 主题色填充（去绿色），作为全局 toggle 样式。
- 歌词设置改为三张分组卡片（基础文字 / 高亮与动效 / 布局与层级），分段按钮 Pill 化、滑块细轨发光。
- 背景方案卡 hover 放大减轻至 1.012。

**验证**

- pnpm build / qa / build:desktop 全绿；无头 Chrome 专项冒烟（位置上移/比例化/球-胶囊-窗口一体化/等宽登录卡/设置底部延展/液态开关非绿/歌词分组卡片/歌单同级滚动吸顶）全通过、零控制台错误。

## 2026-08-16 — 左右 Dock 重构（小球→胶囊→窗口）+ 全局 Hover 分级基座

**改动**

- 左侧歌单导入改为 Dock：网易云/QQ/酷狗/汽水/Spotify/手动导入 6 球，触左边缘依次果冻弹出；悬浮向右单向展开胶囊（已登录显示歌单数 / 未登录显示「去登录」）；点击已登录平台上移并向下展开歌单窗口（其余小球下移让位），窗口内错峰入场歌单列表、已导入歌单继续展开歌曲队列；手动球胶囊内嵌导入输入框。收回为逆序动画。
- 右侧改为 2 球 Dock：登录球胶囊内 5 平台图标（已登录亮/未登录暗），点击展开后 5 图标原地变为垂直小胶囊 + 下方切换各平台登录/退出；设置球胶囊显示功能说明，点击展开设置窗口（歌词/界面/背景/系统四页，默认系统页）。
- 设置新增：歌词加粗开关；「三句布局」改名「歌词布局」；界面设置新增隐藏 Z2 歌曲卡片、隐藏 Z1 歌词层（沉浸模式，localStorage 持久化）；背景设置改为三大玻璃方案卡（自定义/Wallpaper/跟随封面在底部），选封面时卡片间隙收缩上移并在下方弹出 5 种封面模式，切回其他方案逆动画收回；系统设置含主题切换（液态置灰开发中）、会话记忆说明、关于。
- 全局 Hover 分级基座：`--ui-*` 变量 + `.fx-soft/.fx-medium/.fx-strong`（对应列表/图标卡/主按钮三级），:focus-visible、active 下压；材质参数全部走变量，为未来液态玻璃主题预留。
- 平台 logo 素材（docs/logo 官方五家）统一圆形裁切 + 品牌色低透明底衬。
- 底部条与二级窗口按约定未做任何 hover 更新。

**验证**

- pnpm build / qa / build:desktop 全绿；无头 Chrome Dock 专项冒烟（小球/胶囊/窗口/歌单/登录状态/设置四页/背景方案/沉浸开关）全通过、零控制台错误；已提交并推送 GitHub。

## 2026-08-16 — 新增全局 UI 设计规范文档 + 修正 NOTES/PROJECT 过期条目

**改动**

- 新增 `docs/UI_SPEC.md`：全局设计语言、Z 轴层级、动画语言、全局 Hover 规范（Soft/Medium/Strong 三级 + 按组件分类）、组件分类清单（Taxonomy）、状态机约定、`--ui-*` 变量体系（为未来液态玻璃主题预留）、Hover 强度落地类（`.fx-*`）。
- 轻量修正 `NOTES.md` / `PROJECT.md` 过期内容（git 状态、评论功能状态、导入入口描述、文档清单）。

**验证**

- 文档改动无需构建；左右 Dock 重构实现待用户确认后开工。

## 2026-08-16 — 歌曲详情/歌手主页/评论链路 + 底部条重设计 + 壁纸子窗口 + 面板悬浮化

**改动**

- 后端：网易云 + QQ 打通 song detail / artist info / artist songs / artist albums（QQ 使用 musicu + comm：pf_song_detail_yqq、SingerInfoInter/GetSingerDetail、song_list_server/GetSingerSongList、AlbumListServer/GetAlbumList）；LRC 制作团队解析支持中文与英文（Lyrics by 等）；IPC：song-detail / artist-info / artist-songs / artist-albums。
- 前端弹层（居中、无叉叉、点外部关闭）：底部条评论按钮 → 评论页（热门/最新）；歌曲名 → 歌曲详情（专辑/发行/时长/制作团队/歌手 chip）；歌手名 → 歌手主页（头像/简介/歌曲/专辑，多歌手按名字匹配进入）。
- 底部条重设计：顶部通栏独立进度条；播放模式用图标（循环/循环1/交叉）并全局 toast 提示；音量滚轮调节；删除收藏爱心；音质/翻译/音量改为悬停向上展开面板；默认音质取最高可用并持久化。
- Wallpaper：改为原生子窗口（带系统边框，尺寸随主窗口比例），独立 view=wallpaper 页面；预览视频 IntersectionObserver 按需播放（降低卡顿）；卡片 hover 改为上浮。
- 面板：歌单导入/设置悬浮化（左右等距、窗口比例、低透明玻璃分层）；歌单展开与列表同级滚动、头部吸顶；右键菜单不触发面板/卡片收回；搜索栏去背景层 + 聚焦不收回；全局按钮高光柔和化。

**验证**

- QQ/网易云详情与歌手链路实机测试通过（Baby 详情+Justin Bieber 主页 30 歌/30 专辑）；pnpm build / qa:backend / pnpm qa / desktop-check 全绿；已提交并推送 GitHub。

## 2026-08-15 — 壁纸窗口化/视频预览、WE 启动、逐字模块修复、赋色全局化、会话记忆、歌单展开、全局交互

**改动**

- Wallpaper 菜单改为适中小窗口（右上角叉叉关闭，磨砂玻璃）；视频壁纸直接播放媒体（mediaUrl），图片走 preview；场景/网页壁纸点击提示，检测到 Wallpaper Engine 时启动 WE（steam://rungameid/431960）。完整“场景注入”为独立子系统，另行评估。
- 逐字模块修复：--feather 随 --wp 无条件写入；切换扫光/上浮模式时清空写入缓存强制全量重写；移除“逐字高亮”开关——YRC/QRC 歌曲默认逐字，LRC 自然整句。
- 歌词赋色全局化：改从当前背景媒体（封面/自定义上传/Wallpaper）实时采样取色，不再固定按歌曲封面。
- 删除全部预设背景选项；默认背景=封面混合层；无歌单时隐藏回退午夜星空。
- 会话记忆：退出重开自动恢复上次导入歌单与当前播放歌曲（不自动播放），背景自动回到该歌曲。
- 左侧歌单：已导入歌单点击向下展开歌曲队列（吸顶头部 + ▶播放歌单 + ⬆平滑回顶）；歌曲卡片双击播放并“回到中心”，右键弹出“下一首播放”；主界面卡片同样支持右键“下一首播放”。
- 全局深色半透明滚动条；全局按钮 hover 顶层高光（含新增控件）。

**验证**

- 壁纸库扫描/协议/启动信息通过；pnpm build / qa:backend / pnpm qa / desktop-check 全绿；桌面版已重新打包。

## 2026-08-15 — 封面背景多模式 + Wallpaper 壁纸库 + 歌词赋色系统（含软羽化扫字）

**改动**

- 封面背景 5 种模式（设置可切换）：原图直铺（高度顶格+两侧封面色模糊填充）/ 磨砂暗化 / 纯色纹理（主色渐变+低透明封面+噪声）/ 仅取色（1~3 主色渐变）/ 混合层（底层强模糊暗化+中层低透明原图+上层深色遮罩）。
- Wallpaper 壁纸库：后端自动发现 Steam 库（注册表+libraryfolders.vdf+常见路径）→ 扫描创意工坊 431960 与本地项目 → 解析 project.json（标题/类型/媒体/预览）→ wallpaper:// 自定义协议媒体服务（预览+视频，支持 Range）。前端磨砂玻璃页面 4 列网格展示，视频壁纸直接播放、静态图预览、场景/网页壁纸标注不可播放；可播放的点击即设为背景。实测本机识别 67 个（17 可播 / 45 场景 / 5 仅预览）。
- 歌词赋色系统：按规格实现封面采样（每 8px、跳过透明、得分/冷暖/亮暗/强调/面积桶/彩色占比）、近单色银蓝兜底、高冲击文字色三色生成（primary/secondary/highlight）、最低亮度保护；设置页可切「封面取色 / 自定义基色」（自定义走同一套三色生成）。普通句用 primary，当前句与逐字用 highlight，光晕跟随 secondary。
- 软羽化扫字：逐字/整句渐变改为多段 smoothstep 近似柔边（--feather 可配：逐字 0.03 / 整句 0.055），去掉硬刀口。

**验证**

- 壁纸库实机扫描与协议 Range 测试通过；调色板蓝/红/单色兜底验证通过；pnpm build / qa:backend / pnpm qa 全绿；桌面版已重新打包。

## 2026-08-15 — 修复候选句“视觉偏右”：xOff 改为作用于文字中心

**改动**

- 根因：xOff 此前作用在句子左边缘，而文字总是向右延伸——负偏移被半宽抵消、正偏移被半宽放大（实测左偏移句文字中心 654、右偏移句 1086，离中心 66 vs 366），导致候选句肉眼几乎全在右侧。
- 修复：目标位置改为“文字中心对齐 cw/2 + xOff”（x = cw/2 − 半宽 + xOff），再套水平安全区；晋升当前句收窄到 ±3% 的逻辑不变。
- 时序模拟验证：按文字中心统计，next 左 140 / 右 147，nextNext 左 143 / 右 142，完全对称。

**验证**

- 完整时序模拟对称；pnpm build / pnpm qa 全绿；桌面版已重新打包。

## 2026-08-15 — 候选“偏右”错觉修正 + 上浮模式恢复独立效果

**改动**

- 候选左右分布实测均衡（右 122 / 左 124），无系统性偏差；真实偏差来源是当前句被不对称安全区（右 12% / 左 6%）推到中心偏左（均值 693 vs 720），使右侧候选视觉上更突出。
- 修复：水平安全区改为左右对称（当前句 8%、候选 10%），宽句被夹到中心而非偏向一侧；晋升当前句时水平偏移收窄到 ±3%，视觉重心回到中心。
- 上浮模式重做：单层化后改为“已唱字整体亮起（透明度 0.3→1）+ 上浮（用 wordRise 设置）+ 光晕”，与扫光的“字内渐变扫光”明确区分。

**验证**

- 分布模拟：候选右/左对称；pnpm build / pnpm qa 全绿；桌面版已重新打包。

## 2026-08-15 — 修复扫光歌词消失 / 上浮模糊：--wp 渐变单位错误

**改动**

- 根因：JS 把 `--wp` 写成无单位数字（如 0.500），渐变停靠位置 `var(--wp, 0%)` 直接引用导致整条 background 声明失效；配合 `color: transparent` 文字隐形（扫光），上浮模式只剩 text-shadow 光晕（模糊）。
- 修复：渐变位置改为 `calc(var(--wp, 0) * 100%)`，把无单位数字合法转换为百分比；扫光/上浮两种模式文字恢复可见。

**验证**

- pnpm build / pnpm qa 全绿；桌面版已重新打包。

## 2026-08-15 — Z1 体验优化：水平偏移平衡 + 动态水平安全区 + 单层渲染去重影

**改动**

- 候选句偏移平衡：新增水平偏移平衡器，连续同侧超过 2 次即强制换边（实测 200 次生成左右各 100、最长同侧连击 4），避免半首歌扎堆一侧。
- 动态水平安全区：按当前字号 + 实际 DOM 宽度（未渲染时用字符估算）实时计算句子像素宽度，入场目标/晋升放大后都会把句子右缘收敛到不触碰右边缘（当前句右缘 ≤88% 视口、候选 ≤90%），左缘同样收拢；超长句保左侧安全、右侧自然溢出。
- 重影修复：逐字高亮从“双层文本叠加（底色+clip 高亮层）”改回“单层文本 + 渐变 background-clip”，从根上消除双文本 subpixel 错位重影；平滑时间（rAF 外推）保证 60fps，不再复现此前的低帧率问题。

**验证**

- 平衡器/安全区纯逻辑模拟通过；pnpm build / pnpm qa 全绿；桌面版已重新打包。

## 2026-08-15 — Z1 重大重构：三身份带状系统（替换纯随机穿梭）

**改动**

- 身份系统：全局固定 current / next / nextNext 三句，随播放时间实时推进；开头/结尾优雅降级；跳过翻译独行等不可用行。
- 带状布局：当前句主带 = 垂直中心 ±12%；next 等候带偏移 18%–28%；nextNext 再向外（堆叠布局）或一上一下（错落布局，上/下随机分配）；水平错位 8%–18% 视口宽，每次落点随机；窗口缩放按比例实时重算。
- 循环链路：稳定期（当前句保护性微调 + 两等候句呼吸漂浮）→ 当前句最后 30% 冻结微调并预偏 → 离开（左右 50% 斜向飞出 1.0–1.4s，轻微减速，不淡化）→ next 晋升（0.6–0.9s 短距滑入主带，与离开重叠约 0.3s）→ 补位（原 nextNext 升 next，新 nextNext 从外侧 1.1–1.7s 缓入）。
- 进入：主要左右两侧斜向，12% 垂直进入（文字保持水平）；透明度 0→目标、角度从大收到等候角。
- 视觉层级：当前（最大/最亮/角度 ±8–14°）> 下一（0.82×/0.62）> 下下（0.68×/0.42）。
- 前奏/纯音乐：正文（可用行）未开始时居中展示歌曲信息；修复了“部分歌曲前奏无内容”（此前前奏判定会命中不可用的翻译独行）。
- 设置新增“三句布局”切换（上下堆叠 / 上下错落），持久化。
- 保留：逐字高亮（YRC/LRC）、字号/放大/上浮 DIY、悬浮层次、--wp 按需写、切歌/暂停/Seek 处理。

**验证**

- 三身份整曲模拟（真实 QQ 歌单）：0 帧缺失当前句，最大并发 4（3 身份 + 1 离场重叠）；pnpm build / pnpm qa 全绿。

## 2026-08-14 — Z1 歌词：换字阻尼/出口接管/垂直朝向/安全区/预补偿/前奏展示

**改动**

- 换字阻尼：当前句中心补偿目标加低通滤波，并按字进度 15%–85% 加权（两端放松），长句换字不再被拽。
- 过去句出口：跟踪真实位移速度，变成 past 瞬间用真实速度接管；被钉在中心时从 0 缓加速离场（0.7s ease-out）。
- 垂直入场：限制水平位移 ≥0.45 视口宽（不再近乎垂直的大斜率）；文字保持水平不旋转，按左右半区定位使文字朝向画面中心；补偿强度减半。
- --wp 按需写入：值变化才 setProperty（过去/未来句只写一次），减少高频 DOM 写。
- 翻译只用于二级页面：Z1 穿梭层只显示原文，翻译独行不再在穿梭层渲染。
- 双层字重影：base/fill 强制 translateZ(0) 独立合成层。
- 底部安全区：仅左右水平小倾角句子收敛到播放条上方（-112px）；大斜率/垂直句可正常穿过播放条。
- 下一句预补偿：未来句在距自己开始前 1.8s 缓向中心（含第一字偏移与随机偏置），轮到时无需被往回拽。
- 可调项：歌词设置新增“当前句放大”（默认 1.22×，范围 1–1.6）与“逐字上浮”（默认 4px，范围 0–12px）。
- 前奏/纯音乐：正文未开始时居中展示歌名+歌手，纯音乐额外显示“纯音乐 · 暂无歌词”，正文开始后自然淡出。
- 第 9/10 点（左侧入场提前量/过长句判定）按用户要求暂时搁置。

**验证**

- pnpm build / pnpm qa 全绿；桌面版已重新打包。

## 2026-08-14 — 修复歌词彻底不显示：时间单位双重换算 + 切歌残留

**改动**

- 根因：App 已把 currentTime 换算成毫秒传入，而歌词层内部又按“秒”再乘 1000，导致时间被放大 1000 倍，所有行瞬间判定为“已唱完”，歌词全部被消耗不显示。统一为：App 传秒、歌词层内部换算毫秒。
- 切歌残留：新增 songKey 传入，切歌瞬间立即清空飞行对象并暂停渲染，等新歌歌词就绪后再开始，不再有“旧歌中部句子划过”。
- 音符清理：后端 parseLrc 与前端 parseYrcText 在解析层剥离 ♪♫ 等符号；二级播放页移除空行 `♪` 兜底；开头的翻译独行（正文开始前的）丢弃。

**验证**

- 状态机镜像模拟整首歌（真实 QQ 歌单 124 行）：0 帧缺失当前句；pnpm build / qa:backend / pnpm qa 全绿。

## 2026-08-14 — 修复歌词层“切歌闪词后消失” + 翻译被放大飞过

**改动**

- 当前句误回收：逐字居中补偿时整句原点可能移出视口，旧逻辑把它当“飞出视口”销毁并标记为已播放，导致当前句消失、后续未来句占满槽位后无新歌词。现在当前句不再按原点位置回收，只在变为过去句后正常飞出回收；未来句飞出视口即回收，避免占槽。
- 切歌闪词：换歌时同步清空飞行对象/引用，并用 useLayoutEffect 在绘制前清空渲染列表，杜绝旧歌句子残留一帧“混乱时间词”。
- 翻译放大：mergeWordLyrics 的逐字只挂到有正文的行，翻译独行（text 为空）不再接收逐字，中文翻译保持小字号在下方，不再以主歌词尺寸飞过。
- 当前句 y 轴夹取：大斜率（上下边缘入场）时当前句仍在可见域内。
- 超限回收只消耗已唱完的 past 句，未来句被挤出后可重新生成。

**验证**

- 实测 QQ《Baby》：粘连词 0、翻译独行带逐字 0、逐字行 64、翻译 64；pnpm build / qa:backend / pnpm qa 全绿。

## 2026-08-14 — Z1 歌词 12 项精细优化

**改动**

- 逐字特效帧率：currentTime 改为 rAF 平滑外推（audio timeupdate 仅 ~4Hz），扫光/上浮 60fps 顺滑。
- 当前句居中改位置补偿：正在唱的字直接对齐画面水平中心，y 沿轨迹取值，不再用速度控制。
- 缩放稳定：baseScale 生成时一次定死，状态切换只套固定区间（当前 1.3 / 未来 0.66 / 过去 0.7），不再每次 rand 跳变。
- 路径随机：12% 概率上下边缘入场；rot 加 ±3° 扰动；当前/将到句飞行带靠垂直中心（38%–62%），过去/未来句更边缘（18%–82%）。
- 回拉进度条：检测到 >1.5s 的后跳时清空“一句只飞一次”标记，画面恢复正常。
- 吐字感：扫光风格已唱字按 --wp 上浮 2px；整句高亮时长收窄到 2–4.8s，长句后半段不再拖。
- 动态 lead：提前量 = 下一句间隔×25%，夹在 350–1200ms；快歌提前少。
- 动态并发：慢歌（间隔 >5.2s）临时 4 句，快歌 3 句。
- 翻译：默认开启；翻译独行（原文为空仅有翻译）不再被过滤；小字号固定位于主歌词下方居中，动效只作用于主歌词。
- 粘连词修复：跨源 yrc 时间/文本配不上时就近挂到最近正文行，无正文行直接丢弃；实测《Baby》粘连行 0。
- 新增“悬浮层次”设置：卡片之下（默认）/ 卡片之上（z-index 11），歌词设置页可切换。
- 歌词脱离鼠标缩放：改为屏幕坐标定位，与背景层一样固定，缩放只影响卡片。

**验证**

- 实测 QQ《Baby》：粘连词 0、逐字 64 行、翻译 64 行；pnpm build / qa:backend / pnpm qa 全绿。

## 2026-08-14 — Z1 歌词优化：中部带路径 + 逐字中心同步控速

**改动**

- 路径收拢：歌词起止点从全视口随机改为落在画面中部带（出口 y 在 30%–70% 高度，入口 y 收敛在中带内并夹在 12%–88%），只有一两句时也在画面中部出现，不再从上下边缘冒出来难找。
- 逐字中心同步控速：当前句有逐字数据时，每帧按“正在唱的字”计算该字应到达画面中心的位置，反推本帧速度（目标位置 − 当前位置 / 剩余时间），并在路径斜率上保持直线；词间空白时自动减速、词密集时加速，解决“跟不上/过快”。无逐字数据的整句仍按行时长匀速直线。
- 过去/未来句始终使用入场时的恒定速度，只有当前句启用中心同步，状态切换平滑。

**验证**

- pnpm build / pnpm qa 全绿；桌面版已重新打包。

## 2026-08-14 — Z1 歌词修复三：翻转/闪烁/一句一次/配色/逐字补全

**改动**

- 翻转修复：路径角映射到 [-90°, 90°]，右→左飞行时文字不再 180° 倒置，所有歌词始终正向。
- 闪烁修复：逐字高亮从 background-clip 渐变 + drop-shadow 改为“双层字”（底色 + clip-path 裁剪高亮层），去掉每帧 filter 重绘与 CSS transition；高亮颜色改为 color-mix 由当前句色推导，当前句永远是最可读的那个（浅色背景下其他句不再反超）。
- 一句只飞一次：新增 consumed 集合，唱完/飞完/被回收的句不再重新生成；拖进度条也不补飞过去句。
- 并发句数 5 → 3，当前句缩放提升到 1.26–1.36，弱化句降到 0.6–0.72，保证当前句中心可读性。
- 配料表过滤扩展：支持日文“曲：/词：/作詞/作曲/歌詞/訳詞”及英文 “Lyrics: / Composed:” 等不带 by 的形式。
- 逐字补全：非网易源（QQ）无 qrc 时，自动去网易云搜同名歌补 yrc/ytlrc（翻译同时补）；实测 QQ《Baby》从 0 → 9603 字符 yrc，逐字高亮可用了。
- 浅色背景分支阈值 0.5 → 0.45，更多中亮背景自动切深色字。

**验证**

- 实测 QQ《Baby》：qrc 0 → yrc 9603 字符（含字级时间戳）；pnpm build / qa:backend / pnpm qa 全绿。

## 2026-08-14 — Z1 歌词修复二：抖动/音符/朝向/配料表过滤

**改动**

- 抖动修复：此前目标旋转/缩放每帧用随机数重算导致画面抖动；现在旋转在生成时按路径方向一次定死，缩放/透明度目标只在 future→current→past 状态切换时重算一次。
- 朝向对齐：歌词文本基线角度 = 运动路径起点→终点方向角（atan2），左→右统一向上斜、右→左统一向下斜，歌词与路径同向斜移，不再“文字斜一边、路径斜另一边”。
- 音符清理：删除空行回退的 ♪ 占位；过滤纯音符行并剥离行内音符字符。
- 配料表过滤：新增 filterCreditLines()，过滤“作词/作曲/编曲/演唱/Lyrics by/Composed by/Produced by/OP/SP”等信用行、空行，以及开头“歌名 - 歌手”标题行；实测《Peaches》157 行 → 87 行，正文直接从 “I got my peaches out in Georgia” 开始。

**验证**

- 真实 QQ《Peaches》歌词过滤实测通过；pnpm build / qa:backend / pnpm qa 全绿。

## 2026-08-14 — Z1 歌词修复：时间单位错位（秒/毫秒）+ 左右侧直线穿越 + 视觉修正

**改动**

- 根因修复：playerState.currentTime 是秒、歌词 timeMs 是毫秒，前端此前直接混用，导致“当前句”永远命中第 0 行（QQ LRC 第 0 行恰好是“歌名-歌手”标题行），整首歌只有这一行在飞。LyricsLayer 传参改为 currentTime×1000，NowPlayingPanel 同步换算。
- 删除“合成歌词”兜底：无真实歌词时 Z1 保持空层，不再拿歌名/歌手冒充歌词。
- 入场改为只从左右两侧视口外生成，沿直线穿过到对面（允许轻微上下斜度）；删除“当前句在屏幕中心突然生成”的逻辑，拖进度条跳句也走侧边入场。
- 视觉：默认字号 15→24px，设置滑条上限放大到窗口高度 1/4（min 14px）；当前句不透明、过去/未来句微透明（0.6–0.72）；去掉 62vw 宽度截断以支持大字号。
- 删除自定义歌词覆盖功能（UI/App 状态/后端 IPC/preload/缓存 override 全部移除）。

**验证**

- 实测 QQ《Peaches》后端返回 157 行真实歌词（非空）；pnpm build / qa:backend / pnpm qa 全绿。

## 2026-08-14 — Z1 歌词重构：字级歌词（YRC/QRC）+ 斜向穿梭飞词层

**改动**

- 后端字级歌词：
  - 网易云 fetchLyric 改为优先 lyric_new（返回 yrc/ytlrc 逐字，lrc 新版 JSON-Lines 自动归一为普通 LRC），不足再补 lyric。
  - QQ fetchLyric 改为 music.musichallSong.PlayLyricInfo/GetPlayLyricInfo（lyric/trans/roma/qrc，base64 解码），qrc 原样返回，前端映射进 yrc。
  - LyricService 增加 LyricCache 磁盘缓存（userData/lyric-cache.json，30 天）、非网易源翻译补全（去网易搜同名歌补 tlyric/ytlrc）、自定义 LRC 覆盖（IPC nebula:lyric:set/clear-override，存 lyric-overrides.json）。
- 前端：
  - src/lib/lyrics.ts 新增 parseYrcText()（YRC 绝对毫秒 / QRC 相对偏移 / JSON-Lines 三种格式兼容）与 mergeWordLyrics()（以逐字行为骨架，LRC 补文本翻译）。
  - LyricsLayer 重做为状态机飞词层：当前句身份由 currentTime 实时决定；提前 1.2s 入场、按行时长定速、硬限 5 句、飞完回收；当前句 12–18° 倾斜 + 1.18–1.28 缩放 + 逐字高亮（扫光填充 / 上浮发光两种风格），无字级数据退化为整句高亮；暂停冻结、拖进度条实时重判状态。
  - 右侧抽屉新增“歌词”页：字号滑条、高亮风格切换、逐字高亮开关、自定义 LRC 覆盖当前歌曲。

**验证**

- 实测网易云 33894312 返回 yrc（6755 字符，含 [ms,dur](字时间戳) 结构）；QQ GetPlayLyricInfo 返回 base64 LRC；缓存命中、覆盖/清除均生效；pnpm build / qa:backend / pnpm qa 全绿。

## 2026-08-13 — QQ 头像/VIP 修复 + 卡片来源标签与刷新交互调整

**改动**

- QQ 头像：getAccount 直接返回 qlogo 头像地址（q1.qlogo.cn/g?b=qq&nk=uin&s=640），无需额外接口。
- QQ VIP：QqRightsService 增加主路径 VipLogin.VipLoginInter/vip_login_base（实测可拿到 svip=1、identity.HugeVip/LMFlag、过期时间）；SVIP_FLAG_KEYS 增加 hugevip/lmflag，EXPIRY_KEYS 增加 overdate。
- 卡片：歌手行去掉 “· qq/netease” 来源后缀。
- 登录面板：账号卡去掉“歌单 X 个（可在左侧面板导入）”与“刷新歌单”按钮；刷新入口移到左侧歌单栏“歌单导入”行右侧，只保留“刷新”两字，一键刷新所有已登录平台歌单。

**验证**

- 真实 cookie 实测 getAccount：昵称 Violet Snow、头像 URL 有效、isVip/isSvip 均为 true；pnpm build / qa:backend / pnpm qa 全绿。

## 2026-08-13 — 修复 QQ“我的歌单”为空 + 退出登录自动登回旧账号

**改动**

- QQ 歌单根因：旧接口 fcg_user_created_diss 登录态下已失效（返回 code=0 但 disslist 为空）。改用官方 web 同款 musicu.fcg POST：主路径 music.musicasset.PlaylistBaseRead/GetPlaylistByUin，备用 music.songlist.UserSonglistService/GetUserSonglist；g_tk 按 p_skey/skey/music_key/qm_keyst 以种子 5381 计算（hash33 增加 seed 参数），封面 http→https。
- 退出登录修复：nebula:cookie:clear 新增 onCookieClear 钩子，QQ 退出时同时清空 persist:qq-music-login 分区（cookies+localstorage）；createQqLoginWindow 每次打开前也先清分区，避免旧账号 Cookie 残留导致“自动登回旧账号”无法换号。

**验证**

- 实网 cookie 实测 getMyPlaylists 返回 7 个歌单（含封面/曲目数）；pnpm qa:qq-live 9/9 通过；pnpm qa:backend / pnpm qa 全绿。

## 2026-08-13 — 多平台登录状态重构 / 边缘感应 HUD / 本地音乐导入 / 播放模式

**改动**

- 多账号并行：App 全局 accounts 字典（netease/qq/kugou/spotify 可同时登录），启动并行探活；登录管理与歌单导入解耦——右侧账号抽屉（平台列表 + 登录/退出/刷新），左侧歌单侧栏（平台歌单 + 手动链接）。
- 沉浸式边缘感应：顶部搜索栏、右侧账号/背景抽屉、左侧歌单侧栏默认隐藏在视口外，鼠标触碰 16px 边缘热点滑入，移出 300ms 防抖收回；搜索放大镜垂直对齐修正；新增本地音乐圆形按钮（IPC nebula:open-local-directory → 原生文件夹选择器 → music-metadata 解析 ID3/封面 → 星云卡片）。
- 底部播放条：新增播放模式（顺序 → 单曲循环 → 随机，Fisher-Yates 全歌单洗牌，整轮内不重复）；音量滑条改为悬浮展开。
- 移除旧 Hud / LoginPanel 组件。

**验证**

- pnpm build / qa:backend / pnpm qa 全绿；QA 新增：左面板移出收回、播放模式循环、随机 12 次切歌不重复、音量悬浮 0→68px、本地导入卡片生成；electron 语法检查 + music-metadata 动态加载验证通过。

**遗留**

- QQ 歌单拉取需真实账号跑 pnpm qa:qq-live 确认（c.y.qq.com rsc 接口）；酷狗/汽水登录仍不可用。

## 2026-08-12 — 修复 QQ 音乐登录：旧二维码接口 403 封禁 → 官方登录页 + 粘贴 Cookie

**改动**

- 根因：QQ 音乐旧版 ptqrshow 二维码接口（appid=716027609）已被官方 403 封禁；实测同接口换 QQ 空间 appid 返回 200，确认是 QQ 音乐侧停用该接口而非参数问题；Mineradio 对 QQ 也仅提供 Cookie 粘贴。
- LoginPanel QQ 页签改为两条路径：打开官方登录页（独立 partition 窗口扫码，自动读取 Cookie，校验 uin + 播放票据后落库并关闭窗口）+ 粘贴 Cookie 导入；网易云二维码流程不受影响。
- 新增 IPC nebula:login:qq:window（preload / ipcClient / ipc.ts 对齐）。

**验证**

- 实网复现 ptqrshow 403（带/不带 Referer 均 403）；pnpm build / qa:backend / pnpm qa 全绿；electron main/preload 语法检查通过。

**遗留**

- 官方页扫码回填链路需真机确认；酷狗/汽水登录仍不可用。

## 2026-08-12 — 音源探测 / 前端音质选择 / QQ 取链加固与会员权益解析

**改动**

- 音源探测：新增 audioProbe（按平台注入 Referer/UA/Cookie，抓前 64 字节校验音频 magic/类型）；SongResolver 取链后先探测，403/死链/HTML 错误页自动换源，同一 URL 10 分钟内不重复探测。
- 音质选择：netease/qq/kugou 适配器新增 listQualities + fetchSongUrl(quality) 偏好透传；新增 IPC nebula:song-qualities；底部播放条新增音质菜单（点击外部自动关闭），切换不中断播放、保留进度，选择持久化到 localStorage。
- QQ 加固：取链按 flac/320k/128k 分级 + 登录 uin 注入 + 明确错误码；getAccount 尝试真实昵称与权益。
- QQ 权益：新增 qqRights（字段白名单解析 + 10 分钟缓存 + 有效保底），接入 QqLogin.getAccount。
- 新增 scripts/qq-live-check.mjs（pnpm qa:qq-live，需真实 QQ Cookie）。

**验证**

- pnpm qa:backend 全绿（新增探测 magic、权益解析、quality 透传、探测过滤、IPC 音质列表断言）；pnpm build + pnpm qa 全绿（含音质菜单交互断言）。

**遗留**

- QQ 真实账号联调需用户跑 pnpm qa:qq-live（粘贴 Cookie）；酷狗/汽水登录仍不可用；Cookie 明文存储待 DPAPI 加密。

## 2026-08-12 — 修复试听循环 / 优化 seek 与切歌延迟 / 菜单交互小改

**改动**

- 试听循环根因：匿名/权益不足歌曲拿到的是截断试听文件，播到 30s/50s 边界触发 error → 重试同一 URL → 从头循环。修复：
  - 后端透出 `trialEndTime`（freeTrialInfo.endTime），前端在试听边界干净暂停并提示「试听片段已结束」，不再触发 error 循环；
  - 重试解析器统一走 `resolveSong`（主平台取链，内部含兜底）且**同一 URL 不重试**，彻底切断循环。
- 切歌延迟：`next/prev/ended` 遇未解析歌曲时新增 `emptyResolver` 快路径（主平台取链），不再直接走跨平台搜索兜底（实测切歌 39ms）。
- seek 延迟：进度条拖拽节流（~80ms 合并一次）+ 音频代理改用 keep-alive Agent、仅客户端断连才中止上游（Range 请求实测 ~100ms）。
- 交互：导入/背景/登录面板点击外部自动关闭；移除左上角 logo 与小字。

**验证**

- 试听边界实测：3.0s 暂停、提示正确、resolve 仅 1 次无循环；`pnpm qa` / `qa:backend` 全通过。

---

## 2026-08-12 — 修复重启后 UI 未保持登录态

**改动**

- 渲染进程启动时探测登录态（App 挂载 `loginAccount('netease')`），HUD 直接显示「已登录 xxx」。
- 登录面板打开时先探测当前平台登录态：已登录直接展示账号/歌单/退出登录（不再显示二维码），未登录才走扫码。

**验证**

- `pnpm qa` 通过；headless 模拟「启动即已登录」：HUD 已登录、面板无二维码、歌单与退出按钮就绪。

---

## 2026-08-12 — 后端成熟化（成熟库 / 多音质 / 音频代理 / Cookie 校验）

**改动**

- 网易云改用 `@neteasecloudmusicapienhanced/api`（登录/取链/歌词/账号全部走库，不再自研加密主路径；`ncmCrypto` 保留为降级）。
- CookieStore：`normalizeCookieHeader` 归一化 + 按平台校验（netease 需 MUSIC_U；qq 需 uin+播放票据）；`setCookie` IPC 非法即拒绝且不落盘。
- NeteaseLogin：QR 返回 qrimg、poll 校验 MUSIC_U、getAccount 返回 VIP 信息、启动探活 `probeLogin`。
- 取链：`song_url_v1` 按权益过滤 level（jymaster/sky→SVIP，hires/lossless→VIP）→ `song_url` br 降级 → freeTrialInfo 试听标记 → 明确 error；SongResolver 10s 超时 + 失败明确错误。
- 新增 `AudioProxy`（主进程本地 HTTP）：Range 透传、按域名注入 Referer/UA/Cookie、回写响应头 + ACAO；前端音频统一走代理地址。
- QQ/酷狗取链失败返回明确 error；QQ 补 searchSongs 供兜底；LyricService 主源失败跨平台搜索兜底（返回 lrc/tlyric/romalrc/source）。

**验证**

- 后端冒烟全通过（新增 cookie 归一化/校验断言）；P0 真实接口：QR+轮询 801、匿名取链 standard 试听、歌词 49 行、代理 206 Range（bytes 0-1023/721023）、白名单 403。
- `pnpm build:desktop` + `pnpm qa` 通过；`desktop-play-smoke`（真实歌单导入→播放推进→登录面板）通过。

**遗留**

- 扫码确认需真机验证（cookie 持久化 + 重启探活已就绪）；前端 Cookie 粘贴 UI 未加（IPC 已支持）。

---

## 2026-08-12 — UI 体系重建 V2（液态玻璃 / 歌词层 / 缩放 / 二级播放窗口）

**改动**

- 玻璃基底：卡片/按钮/面板统一为渐变细边框 + 双层内外阴影；hover 不改模糊与底色；新增 `lib/glassGlow.ts` 全局动态高光遮罩（鼠标跟随径向柔光、指数惯性、两级反馈：邻近 CSS 变量上浮 + 进入柔光）。
- Z 轴分层：Z0 背景（固定）/ Z1 流动歌词（`LyricsLayer` 粒子式斜向穿梭、跟随平移、被卡片遮挡、背景采样自适应配色）/ Z2 卡片 / Z3 底部条 / Z4 弹窗。
- 背景采样 `lib/bgSampler.ts`：计算明度/饱和度/色相 → 写入 `--glow-rgb`、歌词配色（亮/暗分支），玻璃高光与歌词随底色微调。
- 滚轮缩放：`PanController` 支持 zoom（0.45~2.6，光标锚点），Z1+Z2 同步缩放、Z0 静止；卡片与弹窗增加厚度（`::before` 错层基座）。
- 封面背景：新增预设自动跟随播放歌曲封面，3 种预处理模式（磨砂模糊/暗调融合/流光粒子），可选并持久化。
- 二级播放窗口 `NowPlayingPanel`：旋转封面、信息控制、歌词上下分区（当前行双高亮）、视差字号、翻译开关；Esc/点击空白关闭。
- 底部条：封面可点击打开二级窗口；新增翻译开关（与 Z1 歌词联动）。
- 回到中心：改为定位当前播放歌曲卡片（含缩放精确居中）。

**验证**

- `pnpm qa` 全通过（QA 同步适配二级窗口弹出后的操作）；Playwright 实测高光/邻近/缩放/歌词/二级窗口/回到中心（误差 <20px）。

---

## 2026-08-12 — 修复导入初期与多结果搜索的中心扎堆/压盖

**改动**

- 布局 tile 增加最小尺寸（1920×1080）：小歌单自动放大 cellSize 铺满全屏，避免周期回绕造成同批卡片重复堆在视口中心。
- 渐进揭示入场：新卡片首帧从视口中心散开（`spawnFromCenterRef`），利用既有 transition 滑向终点，告别揭示初期扎堆。
- 搜索聚簇：间距动态放宽（260+3n，上限 420）、上限 60→42，多结果簇团不再互相压盖。

**验证**

- `pnpm qa` 全通过；实测 16 首歌单导入 16 张全屏分布（中心区仅 1 张）；"waves/echo" 聚簇最小间距 363px、中心区 1 张。

---

## 2026-08-12 — 新增搜索功能（实时匹配 + 聚簇 + 视角定位）

**改动**

- 顶部新增搜索框（Hud 中央）：输入实时匹配歌曲名/歌手（子串、不区分大小写），下拉展示结果（可点击、键盘 ↑/↓/Enter/Esc）。
- 回车（多结果）：命中卡片重排成围绕画布中心的紧凑簇团，其余卡片原位不动形成“让位包围”，视角平滑定位到簇团中心。
- 点选单条结果：保留全部命中聚簇，视角定位到该卡片（居中误差实测 ~140px）。
- 清空输入恢复原始随机布局。`PanController` 新增 `animateTo` 平滑定位；新增 `src/lib/search.ts`（匹配+聚簇）。

**验证**

- `pnpm qa` 全通过；构建通过；Playwright 实测“waves”119 命中聚簇居中、点选定位、清空恢复。

---

## 2026-08-12 — 建立项目文档与变更日志体系

**目标**

为长线协作建立可追溯、可续写的项目文档：帮助回忆上下文、保证长线质量、提高缓存命中率、便于项目管理。

**改动**

- 新增 `docs/PROJECT.md`：项目定位、技术栈与目录结构、常用命令、关键架构决策（布局/登录/音源/测试）、文档维护约定。
- 新增 `docs/CHANGE_LOG.md`：按日期回溯全部历史阶段（3D 星云 → 无限画布 → 密度/鱼眼 → 播放条与导入 → 后端架构 → 多平台登录 → eapi 修复），并约定此后每次改动追加条目。
- 新增 `docs/NOTES.md`：平台接口踩坑（明文扫码废弃、eapi 设备 Cookie、歌单分页、VIP 占位地址等）、构建注意事项、待办清单。

**验证**

- 三份文档与当前代码结构、构建脚本、QA 脚本核对一致。

**遗留**

- 文档为手动维护；建议后续将项目纳入 git 以便自动 diff 追踪。

---

## 2026-08-12 — 修复网易云扫码登录（eapi 加密接口）

**目标**

网易云手机扫码并确认授权后，面板报「请切换其他登录方式或升级新版本再试」，无法登录。

**根因**

登录走的是网易云已废弃的明文接口（`music.163.com/api/login/qrcode/unikey?type=1` + `client/login?type=1`）。该接口仍能返回二维码，但扫码确认后服务端按旧客户端拒绝，返回上述错误。

**改动**

- 新增 `src/main/encrypt/ncmCrypto.ts`：完整实现网易云 weapi/eapi 加密（AES-128-CBC/ECB、RSA 无填充、MD5 签名、设备 ID/WNMCID/随机 NUID 生成），并提供 `buildEapiRequest`（含设备 Cookie 与客户端 UA）。
- 重写 `src/main/login/neteaseLogin.ts`：
  - `createQr()` 改用 eapi：POST `interface.music.163.com/eapi/login/qrcode/unikey`（`type=3`）。
  - `pollLogin()` 改用 eapi：POST `/eapi/login/qrcode/client/login`（`key` + `type=3`）；803 成功时合并响应头 Set-Cookie 与 body `cookie` 字段存入 CookieStore。
  - 保留 `{ unikey, payload }` / `{ ok, message }` 返回契约，前端零改动。
- `src/main/http.ts`：`RequestOptions` 增加 `form`（application/x-www-form-urlencoded）支持，供加密接口使用。
- `src/main/index.ts`：导出 `encrypt/ncmCrypto`。
- `scripts/backend-smoke.mjs`：新增 eapi 签名、weapi 256 位 encSecKey、buildEapiRequest 结构、eapi 响应解密四项断言。

**验证**

- `pnpm qa:backend` 全部通过。
- 真实接口联调：eapi 与 weapi 均能获取有效 unikey；eapi `pollLogin` 返回「等待扫码…」（801）。
- `pnpm build` / `pnpm build:desktop` 构建通过。
- 用户真机确认：扫码登录成功（2026-08-12）。

**遗留**

- 未实现 weapi 自动降级（eapi 为主通道；weapi 通道已实测可用，若 eapi 未来被风控可切换）。
- 登录 Cookie 明文存储在 userData（计划中可换 keytar/DPAPI）。

---

## 2026-08-12（早） — 多平台登录与“我的歌单”自动识别

**目标**

支持与导入歌单平台匹配的多平台登录；登录后直接识别并列出用户歌单；手动导入降级为备用入口；修复歌单封面缺失。

**改动**

- 登录面板支持网易云 / QQ / Spotify / 酷狗 / 汽水五个 Tab（酷狗、汽水标注接口未开放）。
- 登录成功自动拉取“我的歌单”并支持点击导入；顶部中心手动导入入口移至右上角「导入 ▾」下拉。
- 卡片与播放条展示真实封面（此前仅歌手歌名）。
- 修复扫码轮询失败：`preload.cjs` 中 `loginPoll` 缺传 unikey 已补齐；轮询 3s + 3 次自动重试。

**验证**

- 导入后卡片封面 6/6 显示正常；桌面版登录与歌单导入链路可用。

**遗留**

- QQ 扫码为实验性；Spotify 需配置 `SPOTIFY_CLIENT_ID`。

---

## 2026-08-11 — 桌面版后端 API 架构（Adapter / 防盗链 / 音源兜底 / 歌词评论）

**目标**

将模拟歌单解析升级为真实分布式多平台 API 后端架构。

**改动**

- `src/main/adapters/`：统一 `Track / Lyric / Comment` 数据模型；netease / qq / kugou 适配器实现 `fetchPlaylist / fetchSongUrl / fetchLyric / fetchComments`；`mappers.ts` 做字段归一（`al.picUrl`、`ar`、`album.pmid`、`singer` 等）。
- `electron/main.cjs`：`webRequest.onBeforeSendHeaders` 全局注入 Referer/Origin/UA 解决 `<audio>` 403；放开跨域响应头。
- `services/songResolver.ts`：主平台取流失败 → 按歌名+歌手跨平台搜索 → 时长/名称匹配度打分 → 填充 `fallbackUrl`。
- `parsers/lyricParser.ts`：LRC 时间轴正则提取 + 双语（lrc/tlyric）按 timeMs 归并。
- 歌单链接/ID 导入与热门评论解析接入 IPC。

**验证**

- `pnpm qa:backend` 通过（含兜底命中与全失败容错用例）。

---

## 2026-08-10 — 底部播放条 + 真实歌单解析与在线播放

**目标**

补全底部播放控制条 UI，接入真实歌单解析与在线播放。

**改动**

- 底部悬浮播放条：封面微缩图、歌名/歌手、进度条与时间、上一首/播放暂停/下一首/收藏/音量。
- 歌单适配器模式：输入网易云/QQ 链接或 ID 解析出含封面元数据的歌曲列表；导入后以 100ms 渐进动画生成 3D 卡片，继承既有布局/鱼眼/Z-index 逻辑。
- 全局 AudioPlayer 单例：点击卡片或控制条驱动播放；实时同步播放状态/时间/进度；封面歌名歌手同步。
- 音源失败自动 skipNext，卡片置灰（opacity 0.5）。

**验证**

- 前端 QA（`pnpm qa`）覆盖导入、播放、暂停、上下曲、seek、坏链跳过的断言通过。

---

## 2026-08-10（早） — 3D 星云卡片墙：密度 / 鱼眼 / 重叠专项调整

**目标**

向目标视觉靠拢：提高布局密度、增强中心鱼眼放大对比、加入层级重叠。

**改动**

- 减小卡片基础间距，提高视口内可见卡片数量（消除大面积留白）。
- 鱼眼映射曲线调整：中心 scale 提升至 ~2.2x，边缘快速衰减至 ~0.5x，边缘卡片带轻微模糊。
- 新增 z-index 逻辑：越靠近中心层级越高，允许边缘卡片在微小间距下自然重叠。

**验证**

- `pnpm qa` 的密度 / 鱼眼 / z-index 断言通过（中心 scale ≥1.7、边缘 ≤0.7、中心 z > 边缘 z）。

---

## 2026-08-10（前序） — 无限画布星云墙：视口裁剪 + 鱼眼 + 平移重构

**目标**

修正“数百张卡片堆叠在视口中央”的问题，改为 Google Earth 式无限画布。

**改动**

- 单屏可见卡片严控 15~25 张且不重叠（网格 + 随机扰动分布，安全间距）。
- 无限大坐标系（4000×4000 起）上分布卡片；拖拽/滚轮无限平移（周期回绕）。
- 视口虚拟化/裁剪：只渲染当前视口 + 缓冲区内的卡片，视口外销毁。
- 中心 1~3 张卡片最大最清晰，边缘按距离缩小 + `blur()` 景深；悬浮转正放大置顶。

**验证**

- `pnpm qa` 无头 Chrome 断言（挂载数 ≤60、屏内 8~30、平移/回绕、悬浮）通过。

---

## 2026-08-10（首轮） — 第一阶段：3D 音乐星云基础布局与无限平移

**目标**

全屏 3D 舞台容器（perspective 2000px），伪随机散落卡片形成“音乐星云”，支持无限平移。

**改动**

- 舞台容器 + 伪随机卡片生成（仿 replica_music_player_v3.html 算法）。
- 布局：中心密四周稀；每张卡片独立轻微 rotateZ（-10°~+10°）与自然层叠。
- 距离映射：中心卡片 scale ≥1.2 且最亮，边缘缩小变暗；悬浮顺滑放大、拉近、转正。
- 空白处长按拖拽或滚轮无限平移舞台层（translate3d）。

**验证**

- 浏览器预览确认基础交互可用；后续由自动化 QA 接管。