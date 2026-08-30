# Nebula 用户画像与长期记忆（USER PROFILE）

> 用途：跨会话 / 跨 agent 维持对用户的稳定认知。**更新时机**：用户表达新的稳定偏好或反模式时追加；一次性事件不写进来。
> 预算约束：保持精简（数百行内），追求信息密度，不做流水账。

---

## 1. 基本沟通

- 语言：中文；结论先行，随后给依据 / 可执行步骤。
- 用户 git / 工程操作是新手：技术细节按新手水平解释；产品与审美判断力强，方向性决策尊重用户。
- 重大改动先对齐再执行（用户会主动 grill）；小且明确的请求直接做，不反复确认。

## 2. 工作流偏好

- 每步 `pnpm build` + QA 全绿后独立提交；UI 设计每阶段用户亲自 `pnpm build:desktop && pnpm desktop` 桌面端验收。
- 不交付截图 png（用户明确不需要）。
- 分支隔离：main 主开发；UI 设计在独立 worktree（`music-nebula-ui Created by deepseek-codex`，分支 `ui/nebula-design-deepseek-codex`）；`music-nebula-ui Created by mimo-hermes` 目录 / 分支不碰。
- 文档是事实源：冻结的设计规格 / 执行稿不得自由发挥；实现以文档为准，参数在约束内通过实际界面校准。

## 3. 设计审美（稳定偏好）

- 动效：spring / jelly 弹性、流畅；适度果冻感有生机，过强会失衡。
- 玻璃：要通透（透出背景颜色与光），拒绝"黑色塑料"感；拒绝廉价 AI glass（blur + 白底 + 白边 + 发光）。
- Hover：反馈由元素自身呈现（文字 / 图标变亮、轻微 scale / 上浮）；**禁止** hover 圆形背景、外圈方框、通用发光。
- 颜色：优先系统取色（封面 / 背景采样 `palette.primary`），不用硬编码蓝。
- 图标：用经典 / 常见语义图标（顺序 = 双箭头围圈、单曲 = 加数字 1、随机 = 箭头交叉），线条精致。
- 克制原则：高级感 = 克制；不做无语义装饰；不确定时选更克制的实现。

## 4. 反模式（用户明确否定，勿再犯）

- 独立 Prototype 再搬进主项目（曾整合爆炸；现改为分支内原生开发）。
- hover 圆形背景 / 方框 / 通用发光。
- 黑色塑料玻璃、常显渐变发光边框。
- 硬编码蓝色替代系统取色。
- 擅自改冻结的交互语义 / 几何。

## 5. 领域现状速记（细节见 CONTEXT_SNAPSHOT）

- 平台：网易云 / QQ 取链 + 多平台 VIP 路由可用；酷狗歌单导入已修；汽水放弃取链（歌单走网易云 / QQ 兜底）；Spotify 仅专辑详情。
- 当前活跃任务：Nebula Player 重构（Bottom Player / Listening Space / Spatial+Inner Lyrics / Music Orb / Atmosphere / Frosted）。
