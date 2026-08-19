# Music Nebula — 新接手者交接手册（HANDOFF）

> 用途：跨模型 / 跨 agent harness 接手本项目的必读入口。
> 本文档回答「项目是什么」之外的三个问题：怎么和用户协作、接手时先读什么、有哪些隐性约定。
> 维护：本文件有修改时同步追加 `CHANGE_LOG.md`。

---

## 0. 必读顺序（未读完全前不写代码）

1. 本文件（HANDOFF.md）
2. `docs/PROJECT.md` — 项目总览、技术栈、常用命令、关键架构决策
3. `docs/ARCHITECTURE.md` — 前端领域化架构、依赖规则、Context 清单
4. `docs/UI_SPEC.md` — UI 设计语言、Hover 规范、液态玻璃预留
5. `docs/LYRICS_SYSTEM.md` — Z1 穿梭歌词设计规格（参数与已废弃决策）
6. `docs/CHANGE_LOG.md` 最近 20 条 — 了解最近改动脉络与验证方式
7. `docs/NOTES.md` — 踩坑记录与待办

---

## 1. 与用户协作的基本规则

1. **重大改动先沟通，确认后执行**。用户的惯例是：改动量大、方向性强时要求"先沟通明确项目需求，等我确认之后再做下一步执行"。小改动 / 明确请求直接做，不要反复确认。
2. **架构与重构：行为零变化**。重构只做结构整理，不改变视觉与行为；每步 `pnpm build` + `pnpm check:arch` + `pnpm qa` 全绿后独立提交，再继续下一步。
3. **UI 以现有实现为唯一真源**。项目曾发生过"参考 Prototype 重新设计导致整合爆炸"的教训；不允许为了"适配"而改变已确认的视觉结构。审美与参数先查 `UI_SPEC.md`，不要自由发挥。
4. **不要输出截图 png**。用户明确不需要 output 目录里的截图产物。
5. **git 每步提交 + 推送**。远程 `origin/main`（`github.com/a161858970-ux/nebula.git`）；文档与代码一起提交。
6. **文档同步**：每次改动追加 `CHANGE_LOG.md`；踩坑更新 `NOTES.md`；架构变化更新 `ARCHITECTURE.md`；UI 规范变化更新 `UI_SPEC.md`。
7. **搜索优先 `rg`**；本项目 Windows PowerShell 下不可用时改用 `Select-String`。
8. **沟通语言**：中文；结论先行，给可执行步骤。用户自述 git / 工程操作为新手，但产品与审美判断力强——技术细节按新手水平解释，方向性判断尊重用户。

---

## 2. 用户反复强调的产品原则

- **Z1 歌词系统是项目特殊难点**："歌词播放沿时间推进，但视觉是多句并行；设计逻辑时不能只按传统垂直滚播考虑当前句，必须同时计算前后 1–2 句与已发生状态来调整整个匹配系统。"这是 Z1 的底层法则（详见 `LYRICS_SYSTEM.md`）。
- **高级感 = 克制**：不滥用发光 / 跳动；玻璃是"载体"不是"装饰"；一切材质、颜色、动效参数走 CSS 变量，为未来「液态玻璃」第二套主题留路。
- **前瞻可读性优先**：当前句 + 下一句 + 下下句三句结构已锁定，不要退回纯随机穿梭。

---

## 3. 当前状态速览（2026-08-19）

- 架构收敛 9 步全部完成，App.tsx 从 1411 行收敛到 587 行；依赖规则由 `scripts/check-arch.mjs` 机制化强制。
- 工作区干净；最近提交见 `git log`（推送至 `origin/main`）。
- 主要待办见 `NOTES.md`；已废弃决策见 `LYRICS_SYSTEM.md` §8「明确不做」。

---

## 4. 环境速查

- pnpm 需带 `$env:pnpm_config_verify_deps_before_run='false'`（Windows PowerShell）。
- Node 运行时与 QA 用本机 Chrome 的路径见 `PROJECT.md` §3 与 `scripts/qa.cjs` 顶部。
- 改动 `src/main`（后端）后必须 `pnpm build:main` 才能让 Electron 与冒烟测试生效。
