# Music Nebula — 全局前端 UI 设计规范

> 用途：本项目所有前端界面的统一设计语言、组件分类与交互规范。
> 维护约定：新增 / 重构任何 UI 组件前先查本文档；本规范本身有修改时同步更新 `CHANGE_LOG.md`。
> 本规范同时为未来的「液态玻璃」第二套主题预留接口：所有材质与动效参数走 CSS 变量，主题切换只换变量组、不重写组件。

---

## 0. 两条总原则

1. **层级分明、暗调通透、电影氛围**：玻璃是"载体"不是"装饰"，任何效果都不得喧宾夺主。
2. **一切材质、颜色、动效参数走 CSS 变量**：组件代码不写死材质数值，未来液态玻璃主题只替换变量组。

---

## 1. 空间 Z 轴层级（已锁定）

| 层级 | 内容 | 行为 |
| --- | --- | --- |
| Z0 | 背景画布（封面混合 / 自定义 / Wallpaper / 午夜备用） | 固定静止，永不跟随拖拽 |
| Z1 | 空域歌词层（穿梭歌词） | 跟随视口；可切到 Z2 之上模式 |
| Z2 | 3D 歌曲卡片星云墙 | 鱼眼透视 + 拖拽 / 缩放 |
| Z3 | 底部播放控制条 | 常驻 |
| Z4 | 弹层：二级播放窗、评论、详情、歌手页、右键菜单、左右 Dock 展开窗口 | 悬浮于全局之上 |

---

## 2. 材质体系（当前：磨砂玻璃 Frost）

- **基底**：`backdrop-filter: blur + saturate`，暗色半透明渐变（`padding-box` / `border-box` 双层语法）。
- **边框**：渐变细边框（上亮下暗），杜绝廉价塑料质感。
- **景深**：双层内外阴影（外投影 + 内侧顶部高光 + 内侧底部微光）。
- **顶层柔光**：绝对定位 `::after` 遮罩（不挤压布局），`radial-gradient(circle at var(--gx) var(--gy), rgba(var(--glow-rgb), …), transparent)`，透明度 `var(--glow-a)`，JS 委托写入（`lib/glassGlow.ts`）。
- **光色来源**：`--glow-rgb` 由背景采样模块按当前底色实时调整（封面 / 自定义 / Wallpaper 取色），保持全局光照一致。
- **未来液态（Liquid）**：同一套 `--ui-*` 变量，仅替换 surface / border / shadow / highlight 四组变量实现，折射、表面张力、流体高光全部在 `.theme-liquid` 作用域内完成。

---

## 3. 动画语言（统一）

- **物理**：spring / jelly 弹性优先（`motion` 弹簧或 CSS 变量驱动）；禁止线性生硬过渡。
- **时长**：微交互 160–240ms；面板展开 / 收起 300–450ms；Dock 小球序列入场 40–60ms 错峰。
- **兜底**：`ease-out`；需要"自然接替"时用指数平滑。
- **克制**：禁止大幅位移、全屏动画、锐利水波纹；只允许"推挤、让位、上浮、液化、呼吸"。
- **可访问性**：尊重 `prefers-reduced-motion`，关闭非必要动画。

---

## 4. 全局 Hover 设计原则（已确定，2026-08-16）

### 4.1 统一语言

| 项目 | 规范 |
| --- | --- |
| 物理手感 | spring / jelly 弹性，160–240ms |
| Scale 范围 | Soft 1.02–1.04 · Medium 1.03–1.06 · Strong 1.04–1.08 |
| 玻璃增强 | 亮度 +8–15%、饱和度 +5–10%、边框高光增强 |
| 颜色来源 | 优先主题主色或专辑动态色（低透明度） |
| 焦点状态 | 必须提供 `:focus-visible`（键盘可达） |
| Active 状态 | 按下 scale 0.96–0.98，轻微下压 |
| 变量预留 | 全部 CSS 变量控制，未来液态玻璃一键切换 |

### 4.2 强度分级速查

| 强度 | Scale | 发光 | 上浮 | 适用 |
| --- | --- | --- | --- | --- |
| Soft | 1.02–1.04 | 极弱或无 | 无 / 极轻 | 列表项、Tooltip、文字链接 |
| Medium | 1.03–1.06 | 柔和 | 轻微 | Icon 按钮、卡片、输入框、开关 |
| Strong | 1.04–1.08 | 明显（Specular + Border Glow） | 明显 | Primary 按钮、主播放按钮 |

### 4.3 按组件分类的 Hover 规范

1. **Primary / Secondary 按钮**（播放/暂停主按钮、确认、登录）
   - Strong；Scale 1.05–1.07 + 轻微上浮；Specular 高光扫过；柔和边框发光；背景提亮 + 饱和度上升。
2. **Icon / 工具按钮**（上一首/下一首、音量、歌词、设置、关闭）
   - Medium；Scale 1.06–1.08；圆形背景轻微提亮 + 图标变亮；**不加强发光**（避免播放条与侧栏杂乱）。
3. **卡片**（歌单卡、专辑卡、壁纸卡、背景方案卡）
   - Medium；轻微上浮 + Scale 1.03；边框高光增强（轻量 Border Glow）；内容变亮；阴影加深可选。
4. **列表项**（歌曲列表、歌单列表、搜索结果、评论列表）
   - Soft；极低透明度白色/主色层背景；左侧细指示条；文字轻微提亮；几乎不 Scale（或 1.01）。
5. **Input / 搜索框 / 手动导入输入框**
   - Soft–Medium；边框变亮 + 轻微外发光；**不 Scale**（保持稳定）；Focus 时发光更明显。
6. **Toggle / Checkbox / Radio**
   - Medium；轨道/圆点轻微放大；颜色提亮；可加轻微液体填充感（为液态主题铺路）。
7. **Tooltip**
   - Soft；出现 fade + scale from 0.95；背景用更深磨砂玻璃；无额外发光。
8. **左右 Dock 核心交互（小球 → 胶囊 → 窗口）**
   - 小球 hover：果冻放大 + 轻微发光（与 Floating Dock 统一）；
   - 胶囊 hover：保持展开，内部按钮按 Primary 规范；
   - 窗口内元素：按卡片 / 列表规范执行。

---

## 5. 组件分类清单（Taxonomy）

> 用途：全局模块化修改的索引（例如"对所有按钮统一换一种 hover"）。新增组件必须先归类。

### 5.1 按钮 Buttons

| 子类 | 现有实例 | Hover | 说明 |
| --- | --- | --- | --- |
| Primary / Secondary | 播放/暂停主按钮、确认、登录、导入 | Strong | Specular 高光 + 边框发光 |
| Icon / 工具按钮 | 上一首/下一首、音量、歌词、翻译、关闭、回中 | Medium | 无强发光 |
| 圆形玻璃按钮 | Dock 小球、本地导入、回到中心、收藏 | Medium | 圆形裁切 + 果冻放大 |
| 文字/链接按钮 | 详情里的"查看全部"等 | Soft | 仅文字提亮 |

### 5.2 输入 Inputs

| 子类 | 现有实例 | Hover | 说明 |
| --- | --- | --- | --- |
| 搜索框 | 顶部 Gooey 搜索 | Soft–Medium | 果冻展开形态，不 Scale |
| 链接输入框 | 左侧手动导入 | Soft–Medium | Focus 发光增强 |
| 数值/滑块 | 进度条、音量、字号 | — | 拖拽中跟随，非 hover 放大 |

### 5.3 开关与选择 Toggle / Checkbox / Radio / Segmented

| 子类 | 现有实例 | Hover | 说明 |
| --- | --- | --- | --- |
| Toggle Switch | 隐藏歌词层 / 隐藏卡片 / 歌词加粗 | Medium | 轨道 + 圆点 |
| Segmented | 高亮风格、歌词布局、图层模式、背景模式 | Medium | 选中项高亮，hover 轻微 |
| Radio / Checkbox | 封面背景二级选项等 | Medium | 圆点放大 + 颜色提亮 |

### 5.4 卡片 Cards

| 子类 | 现有实例 | Hover |
| --- | --- | --- |
| 3D 歌曲卡 | 主界面星云卡片（Z2） | 转正 + 放大 + 置顶（鱼眼专用，不走通用规范） |
| 歌单卡 | 左 Dock 窗口内歌单列表 | Medium 上浮 1.03 |
| 壁纸卡 | Wallpaper 导入窗口 | 微微上浮（不发光） |
| 背景大方案卡 | 设置→背景页 | Medium |

### 5.5 列表项 List Items

| 子类 | 现有实例 | Hover |
| --- | --- | --- |
| 歌曲列表 | 歌单展开歌曲队列 | Soft + 左侧指示条 |
| 歌单列表 | 各平台歌单 | Soft + 左侧指示条 |
| 搜索结果 | Gooey 下拉 | Soft |
| 评论列表 | 评论弹窗 | Soft |
| 播放队列（未来） | — | Soft |

### 5.6 提示与浮层 Tooltip / Toast / Menu / Modal

- **Tooltip**：Soft，fade + scale from 0.95，深色磨砂底，无发光。
- **Toast**：全局播放模式切换提示等；滑入滑出 + 淡出。
- **右键菜单（Context Menu）**：出现 fade + scale from 0.96；项按列表项规范。
- **Modal**：二级播放窗、评论页、歌曲详情、歌手主页；居中，无叉叉，点外部关闭；遮罩模糊底层。

### 5.7 停靠与抽屉 Dock / Drawer

| 子类 | 现有实例 | 说明 |
| --- | --- | --- |
| 左 Dock | 歌单导入 | 6 小球 → 胶囊 → 上移 → 窗口 |
| 右 Dock | 登录 / 设置 | 2 小球 → 胶囊 → 上移 → 窗口 |
| 顶栏搜索 | Gooey 搜索 + 本地导入 + 计数 | 边缘感应滑入 |
| 底部播放条 | 播放控制 + 进度 + 音量 | 常驻 Z3 |

### 5.8 标签 / 徽章 / 页签 Chip / Badge / Tabs

- 计数徽章（顶部"n 首"）、来源标签（歌曲卡片平台标记）、平台页签、设置分类页签（歌词/界面/背景/系统）。
- Hover：Medium 提亮；选中项主色高亮。

### 5.9 歌词（特殊组件，独立体系）

- Z1 穿梭歌词（三句身份机：current / next / nextNext）、二级窗口滚动歌词。
- 视觉由「歌词赋色系统」驱动（primary / secondary / highlight 三色 + 最低亮度保护）。
- 不套用通用按钮/卡片 Hover；只有设置项按上述规范。

### 5.10 滚动条 Scrollbar

- 全局深色半透明滚动条；Hover 变亮；Track 极淡。

---

## 6. 状态机约定

每个可交互组件至少实现：`rest / hover / active(press) / focus-visible / disabled / selected(可选)`。

- `:focus-visible` 必须可见（键盘可达），与 hover 视觉同强度但使用焦点环样式。
- `disabled` 无 hover 反馈（透明度降低即可）。
- hover 与 focus 同时存在时以 focus 为准。

---

## 7. CSS 变量体系（未来液态切换的关键）

统一前缀 `--ui-*`，按语义分组（示例）：

```css
:root {
  /* 基底 */
  --ui-bg-a: rgba(36, 40, 60, 0.74);
  --ui-bg-b: rgba(15, 17, 30, 0.52);
  /* 边框渐变 */
  --ui-border-hi: rgba(255, 255, 255, 0.5);
  --ui-border-lo: rgba(255, 255, 255, 0.04);
  /* 阴影 */
  --ui-shadow-outer: 0 24px 60px rgba(0, 0, 0, 0.52);
  --ui-shadow-inner-hi: inset 0 1px 0 rgba(255, 255, 255, 0.16);
  /* 顶层高光 */
  --ui-hi-color: rgba(var(--glow-rgb, 255, 255, 255), 0.14);
  /* hover 各强度 */
  --ui-hover-soft-scale: 1.03;
  --ui-hover-med-scale: 1.05;
  --ui-hover-strong-scale: 1.07;
  --ui-hover-bright: 1.10;
  --ui-hover-saturate: 1.08;
  --ui-focus-ring: 0 0 0 2px rgba(var(--glow-rgb, 120, 140, 220), 0.45);
}
```

主题切换：`html.theme-frost` / `html.theme-liquid` 只覆盖上述变量组，**组件样式不感知主题**。

---

## 8. Hover 强度落地（CSS 类）

- `.fx-soft` / `.fx-medium` / `.fx-strong` 三个工具类承载各自强度（scale / lift / glow / brightness / saturation）。
- 现有全局 `button:hover` 的"一律发光"逐步收敛：按钮默认 `.fx-medium`，关键操作 `.fx-strong`，列表/卡片按类覆盖。
- Dock 小球等特殊交互保留独立类（`.dock-ball` 等），但内部变量仍引用 `--ui-*`。

---

## 9. 未来液态玻璃主题的预留设计

- 组件不写死材质数值：背景、边框、阴影、高光一律引用 `--ui-*`。
- 高光从"径向渐变遮罩"升级为"折射 / 表面张力 / 流体高光"时，只改 `.theme-liquid` 作用域内的变量与 `::after` 实现。
- 两套主题功能布局完全一致，仅材质差异；切换入口计划放在 设置 → 系统设置。

