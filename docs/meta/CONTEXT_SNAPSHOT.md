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

## 当前状态（2026-09-13）

- **目录 / 分支**：
  - `music-nebula`（main，HEAD `f69f13a`）— 主项目，本会话直管。
  - `music-nebula-ui Created by deepseek-codex`（`ui/nebula-design-deepseek-codex`，HEAD `d796031`）— UI 设计工作树，本会话直管。
  - `music-nebula-ui Created by mimo-hermes`（`ui/nebula-design`）— 另一 agent 的目录，不碰。
- **活跃任务**：Nebula Player 重构（8 阶段，见 `docs/design/PLAYER_IMPL_PLAN.md`）。
  - Phase 1（Bottom Player）已实现并两轮打磨：`2d18039`（结构重构）→ `7e38760`（弹层开关/进度条/图标/音量/高度）→ `f79b65a`（音质弹窗重设计、图标按参考图重绘、系统取色、去方框/圆 hover、玻璃通透、时间常显）。**状态：待用户桌面端最终复验**（8-30 后项目搁置）。
  - 下一阶段：**Phase 2** Listening Space shell + Bottom→Listening 连续变形 + 主舞台退场。
  - 挂起决策：播放模式循环顺序（现为 顺序→单曲→随机；文档写 顺序→随机→单曲）待用户拍板。
- **主项目 main**：功能停在 `f60c82c`（跨平台歌手/专辑转译、专辑点播 VIP 路由、评论分页、歌手全曲、QQ 专辑接口等已上线并推送）；其后为文档体系提交（`b379e24` 二级分类、`f69f13a` AGENTS.md + 连续性协议）。UI 分支暂不合并，UI 完成后统一合并 + 全量 QA。
- **模型迭代记录**：2026-09-13 用户告知原 deepseek-v4-flash 已下架、现由 v4.1 flash 提供服务；本次按本文件「模型迭代与连续性」协议完成冷启动预热（全量 docs 精读 + 刷新快照 + 修正 NOTES 过时项）。**本轮已确认可继续开发，无需用户重述历史。**
- **验证命令**：各仓库内 `pnpm build` + `pnpm qa`；UI 桌面验收在 worktree 目录 `pnpm build:desktop && pnpm desktop`。
- **文档体系**：已重构为 `docs/{project,design,meta}` 三个二级目录，入口 `docs/README.md`。
- **已知文档边界**：`CHANGE_LOG.md`（92–97KB）按约定只精读「最近 20 条 + 全量条目索引」；历史细节需要时按条目日期定位回读。
