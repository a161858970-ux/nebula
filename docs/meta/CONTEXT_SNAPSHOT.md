# Nebula 上下文快照（CONTEXT SNAPSHOT）

> 用途：任何新会话 / 新 agent 用最小 token 恢复上下文；"上下文压缩迭代"的载体。
> 维护：重大里程碑或会话结束时刷新「当前状态」；历史只保留最近 1–2 条，避免膨胀。

---

## 恢复路径（按序读完即可动手）

1. `docs/meta/HANDOFF.md` — 协作规则
2. `docs/meta/USER_PROFILE.md` — 用户画像
3. 本文件「当前状态」
4. `docs/project/ARCHITECTURE.md` + `docs/project/CHANGE_LOG.md` 最近 20 条

## 模型迭代与连续性（为什么这份文件存在）

- 底层模型可能随供应商版本迭代被替换；同一线程的上下文窗口也会被 **compaction** 压缩（官方说明：compaction 降低上下文体积、保留后续轮次所需状态，但压缩项是不透明摘要，细节会损失）。
- 连续性因此分三层：① 线程对话历史（会在压缩中损失细节）；② 仓库文档（本目录 + CHANGE_LOG + 冻结设计规格，人类可读、可无限增长）；③ git 提交历史（事实基准）。
- **协议**：新会话 / 新 agent / 换模型后按上面「恢复路径」读完再动手；重大里程碑或会话结束时刷新本文件「当前状态」小节。`AGENTS.md` 已配置自动指向这条路径。

## 当前状态（2026-08-30）

- **目录 / 分支**：
  - `music-nebula`（main）— 主项目，本会话直管。
  - `music-nebula-ui Created by deepseek-codex`（`ui/nebula-design-deepseek-codex`）— UI 设计工作树，本会话直管。
  - `music-nebula-ui Created by mimo-hermes`（`ui/nebula-design`）— 另一 agent 的目录，不碰。
- **活跃任务**：Nebula Player 重构（8 阶段，见 `docs/design/PLAYER_IMPL_PLAN.md`）。
  - Phase 1（Bottom Player）已完成：分支提交 `f79b65a`（弹层点击开关/居中、进度条修复、模式图标三件套、队列 FIFO、玻璃通透、去方框/圆 hover、时间常显）。
  - 下一阶段：**Phase 2** Listening Space shell + Bottom→Listening 连续变形 + 主舞台退场。
  - 挂起决策：播放模式循环顺序（现为 顺序→单曲→随机；文档写 顺序→随机→单曲）待用户拍板。
- **主项目 main** 停在 `f60c82c`（跨平台歌手/专辑转译、评论分页、QQ 专辑等已上线）；UI 分支暂不合并，UI 完成后统一合并 + 全量 QA。
- **验证命令**：各仓库内 `pnpm build` + `pnpm qa`；UI 桌面验收在 worktree 目录 `pnpm build:desktop && pnpm desktop`。
- **文档体系**：已重构为 `docs/{project,design,meta}` 三个二级目录，入口 `docs/README.md`。
