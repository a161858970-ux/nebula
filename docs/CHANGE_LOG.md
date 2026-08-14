# Music Nebula 变更日志

> 维护约定：每次代码/文档改动后，在文件**顶部**（本说明之下）追加一条最新记录。
> 条目格式：`YYYY-MM-DD — 摘要`，内容包含：目标 / 改动点 / 验证方式 / 遗留与风险。

---

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
