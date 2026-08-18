# Music Nebula — 前端架构（App.tsx 收敛计划 v1）

> 本文档是 App.tsx 领域化重构的唯一架构真源，随迁移步骤同步更新。
> 依赖规则由 `scripts/check-arch.mjs` 机制化执行（`pnpm check:arch`，并随 `pnpm qa` 运行）。

---

## 1. 目标

- 把 1411 行的 App.tsx 收敛为「组合层」：领域 hooks 提供状态与行为，视图区块按 Z 轴组装，App 只做接线。
- 纯结构整理：**行为零变化**；不引入状态库、不重写 panEngine / AudioPlayer。
- 低成本重渲染隔离：App 顶层不再订阅全量播放器状态；高频值（currentTime/progress）留在叶子订阅。

## 2. 领域清单（11 hooks + 2 services）

### Services（lib 单例，非 React）

| Service | 职责 | 约束 |
| --- | --- | --- |
| `audioPlayer`（已有） | 播放/队列/模式 | 全局单例，leaf 可订阅 |
| `LibraryService`（新增 `src/lib/library.ts`） | **仅 track/catalog 数据**（songs） | **不持有 currentPlaylist**；`applyImported` 是唯一外部导入入口 |

> 概念边界：`LibraryService → PlaylistService/usePlaylist → audioPlayer`。第一阶段若只做一个 service，也**不得**让 LibraryService 变成万能音乐状态容器。

### Hooks（按领域目录 `src/hooks/<domain>/`）

| Hook | 领域 | 拥有 | 依赖 |
| --- | --- | --- | --- |
| `useAccounts` | 账号 | platforms / accounts / loginNonce / drawerPlatform；启动探活、refresh、requestLogin | 无 hook 依赖 |
| `useLibrary` | 曲库 | LibraryService 的 React 订阅适配层（**无业务逻辑**） | LibraryService |
| `usePlaylist` | 歌单生命周期/队列 | 当前歌单身份、playPlaylistFromStart / playSongFromList / insertNextSong | LibraryService + audioPlayer |
| `usePlaylistImport` | 导入流程 | importStatus / importMessage / importing / localBusy + 手动/平台/本地导入 | LibraryService（applyImported） |
| `useOverlays` | 浮层 | contextMenu / infoModal / nowPlayingOpen / modeToast | audioPlayer |
| `useLyrics` | 歌词运行态 | lyricLines / 拉取/归一化（随切歌） | audioPlayer（service） |
| `useBackground` | 背景/氛围 | bgSetting / bgCoverMode；产出 **VisualAtmosphere**（不直接改歌词/玻璃） | 无 hook 依赖 |
| `useInterfaceSettings` | 界面设置 | lyricSettings、uiHideCards、uiHideLyrics、lyricTranslationEnabled + 持久化 | 无 hook 依赖 |
| `useSearchCluster` | 搜索 | searchMatches + 定位/聚簇 handlers；歌曲数据来自 App 传参（songs prop） | 不依赖 usePlaylist |
| `useEdgePanels` | 边缘面板 | edge 状态 + 热点/防抖计时器 | 无 hook 依赖 |
| `useStage` | 画布（最后迁移） | hoveredId / visibleIds / failedIds / likedIds + 舞台接线 | LibraryService + audioPlayer |

## 3. 依赖图（DAG）

```
lib/（audioPlayer · LibraryService · atmosphere 纯函数 · 既有模块）
   ▲
   │ 全部 hooks 可依赖（Hook → Service/lib ✔）
hooks/（默认禁止跨领域；白名单为空集；逃生口：基础层被上层依赖，需登记）
   ▲
contexts（VisualAtmosphere / Playback / InterfaceSettings）只被组件消费
   ▲
view blocks（同层互不依赖，组合只由 App 完成）
```

跨域数据一律经 service / context / App 组合层传参；**不写死"hooks 永远不能互相调用"**，白名单机制保留。

## 4. Context 清单（仅这三个，禁止大全局 context）

| Context | 值 | 高频值 |
| --- | --- | --- |
| `PlaybackProvider` | `{ song, playing, mode, quality, loading, failed, error }` | 不含 currentTime / duration / progress |
| `InterfaceSettingsProvider` | `{ lyricSettings, uiHideCards, uiHideLyrics, lyricTranslationEnabled }` + setters | — |
| `VisualAtmosphereProvider` | `{ lyricPalette, glowRgb, coverMode, effectiveBg }` | — |

高频订阅（`useAudioPlayer()` 叶子）：仅 `BottomBar`、`NowPlayingPanel`。

## 5. 视图区块（按 Z 轴 + 功能边界）

| 区块 | 内容 | 备注 |
| --- | --- | --- |
| Z0 | `BackgroundLayer` | 已有组件 |
| Z1 | `LyricsOverlay` | 歌词层 + 隐藏开关 |
| Z2 | `StageCanvas` | stage-3d + 卡片渲染（收 useStage 数据） |
| Z3 | `BottomBar` + 回中按钮 | BottomBar 已有 |
| HUD | `TopBar` / `AccountDock` / `PlaylistDock` | 三者独立，**不合体** |
| Z4 | `OverlayStack` | NowPlaying + InfoModals + 右键菜单 + toast |

## 6. Dependency Rules（check-arch 强制）

1. `lib` 不得 import `hooks` / `components`。
2. `hooks` 禁止跨领域依赖；基础层可被上层依赖，禁止反向；依赖以白名单为准。
3. 同层 UI 区块禁止互相依赖，组合只能由上层容器（App）完成。
4. Background 不得修改 Lyrics 状态（只经 VisualAtmosphere 中间层）。
5. Stage 不得接触 Account 状态。
6. `applyImported` 是曲库唯一外部导入入口，不演化成通用 mutation。
7. `components` 允许直接 import `lib` 纯函数/类型（例外保留）。

## 7. 迁移路线（插花式，每步 build + qa + 提交）

- [x] 1. `useAccounts`
- [x] 2. `LibraryService` + `useLibrary` + `usePlaylist` + `usePlaylistImport`（含 `lib/playlistTypes.ts` 共享类型；会话记忆效果暂留 App，随 Stage 步迁移）
- [ ] 3. `useOverlays`
- [ ] 4. 视图第一阶段（HUD / OverlayStack 接线，App 开始瘦身）
- [ ] 5. `useLyrics`
- [ ] 6. `useBackground`（含 VisualAtmosphere 中间层迁移）
- [ ] 7. `useSearchCluster` + `useEdgePanels`
- [ ] 8. 视图第二阶段（LyricsOverlay / StageCanvas 接线）
- [ ] 9. `useStage`（最后，最高风险）
