# AGENTS.md — Music Nebula

> Codex 会自动加载本文件。用途：任何新会话 / 新 agent / 换模型后，**动手前先恢复项目上下文**。

## 恢复上下文（按序读，读完再动手）

1. `docs/meta/HANDOFF.md` — 协作规则与隐性约定
2. `docs/meta/USER_PROFILE.md` — 用户画像、审美偏好、反模式
3. `docs/meta/CONTEXT_SNAPSHOT.md` — 当前状态、活跃任务、挂起决策
4. `docs/project/ARCHITECTURE.md` + `docs/project/CHANGE_LOG.md` 最近 20 条
5. `docs/README.md` — 文档索引与维护约定

## 硬性约定（不可自行放宽）

- 每步改动：`pnpm build` + `pnpm qa`（后端改动加 `pnpm qa:backend`）全绿后独立提交；每次改动追加 `docs/project/CHANGE_LOG.md`。
- `docs/design/*` 是冻结真源（UI_SPEC / LYRICS_SYSTEM / NEBULA_PLAYER_DESIGN_SPEC / PLAYER_AGENT_BRIEF / PLAYER_IMPL_PLAN）；不得自由发挥，不得静默改交互语义。
- Hover 反馈必须由元素自身呈现（文字 / 图标变亮、轻微 scale）；禁止圆形背景、外圈方框、通用发光。
- 颜色优先系统取色（封面 / 背景采样），禁止硬编码蓝。
- 不交付截图 png。
- 分支纪律：main 主开发；UI 设计在独立 worktree `music-nebula-ui Created by deepseek-codex`（分支 `ui/nebula-design-deepseek-codex`）；`music-nebula-ui Created by mimo-hermes` 不碰。
