# Music Nebula — 文档索引

> 用途：docs 二级分类入口与维护约定。新文档先看这里决定归属。
> 维护：分类调整 / 新增文档时同步更新本文件；每次文档体系改动追加 `docs/project/CHANGE_LOG.md`。

---

## 分类结构

| 目录 | 内容 | 文档 |
|---|---|---|
| `docs/project/` | 项目治理：总览、架构、变更日志、踩坑与待办 | `PROJECT.md` · `ARCHITECTURE.md` · `CHANGE_LOG.md` · `NOTES.md` |
| `docs/design/` | 设计规格：UI 语言、歌词系统、播放器重设计 | `UI_SPEC.md` · `LYRICS_SYSTEM.md` · `NEBULA_PLAYER_DESIGN_SPEC.md` · `PLAYER_AGENT_BRIEF.md` · `PLAYER_IMPL_PLAN.md` |
| `docs/meta/` | 交接与记忆：接手手册、用户画像、上下文快照 | `HANDOFF.md` · `USER_PROFILE.md` · `CONTEXT_SNAPSHOT.md` |

> `NEBULA_PLAYER_DESIGN_SPEC.md` / `PLAYER_AGENT_BRIEF.md` / `PLAYER_IMPL_PLAN.md` 目前在 UI 分支（`ui/nebula-design-deepseek-codex`）维护，合入 main 后归入 `docs/design/`。

---

## 新接手者必读顺序

1. `docs/meta/HANDOFF.md` — 协作规则与隐性约定
2. `docs/meta/USER_PROFILE.md` — 用户画像与审美偏好
3. `docs/meta/CONTEXT_SNAPSHOT.md` — 当前状态与活跃任务
4. `docs/project/PROJECT.md` + `docs/project/ARCHITECTURE.md`
5. `docs/project/CHANGE_LOG.md` 最近 20 条
6. `docs/project/NOTES.md` — 踩坑与待办

## 维护约定

- 每次改动追加 `docs/project/CHANGE_LOG.md`（日期、目标、改动、验证、遗留）。
- 新踩坑/待办 → `docs/project/NOTES.md`；架构变化 → `docs/project/ARCHITECTURE.md`；UI 规范 → `docs/design/UI_SPEC.md`。
- 用户的稳定偏好/反模式 → `docs/meta/USER_PROFILE.md`；里程碑或会话结束 → 刷新 `docs/meta/CONTEXT_SNAPSHOT.md`。
