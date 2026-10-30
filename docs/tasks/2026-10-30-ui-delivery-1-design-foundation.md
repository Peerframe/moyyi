# 界面交付一：设计基础

- 日期：2026-10-30。
- 上级计划：[M6 之后的计划 v2](2026-10-28-post-m6-plan.md)。这是计划第 4 节四个交付之外、owner
  当天追加的界面优化交付，不改变交付零至交付四的内容和顺序。
- 执行：Codex。从最新 main（`dde4e1b` 或之后）新建分支 `codex/ui-design-foundation`，整块实现，
  一个 PR。与交付三的关系见第 9 节。
- 审查与验收：Claude。

## 1. 目标

让桌面端的视觉有一套能被检查的基础：所有颜色、间距、圆角和字号都来自一份 token 文件，品牌色
真正用到界面上，文字和控件边框达到 [design](../design.md) 要求的对比度，并且这些规则由测试
守住，以后加界面（交付三、四）不会再退化。

本交付**不改任何功能行为**：不动宿主、IPC、共享类型、持久化格式和文案（第 4 节 E 新增的装饰
图片除外，它不带文字）。

2026-10-30 在 main `dde4e1b` 上的实际状态（来自 owner 的 moyyi Design System 整理）：

- `apps/desktop/renderer/styles.css` 共 1012 行，`:root` 定义 12 个变量，另有 12 处直接写的颜色：
  主按钮 `#111`/`#333`/`#fff`、输入区边框 `#d7d7db`/`#999`、placeholder `#8e8e93`、复选框
  `accent-color: #111`、对话框遮罩 `rgb(0 0 0 / 28%)`、表格边框 `#ddd`、行内代码 `#f3f3f3`、
  材料拖放区 `#ccc`/`#444`。
- [design](../design.md) 规定的品牌色 `--brand`、`--brand-soft`、`--brand-accent` 还没加；主按钮是
  近黑色。
- 对比度不达标（WCAG 2.1 AA）：
  - `--muted #6e6e73` 在 `--fill` 上 4.46:1、`--fill-hover` 4.30:1、`--selected` 4.07:1，低于 4.5:1；
  - placeholder `#8e8e93` 在白底 3.26:1，低于 4.5:1；
  - 输入框边框用 `--line #e3e3e6`，白底 1.28:1；输入区边框 `#d7d7db` 1.44:1，都低于控件边框
    要求的 3:1。
- 数值没有收敛：间距用了 3、5、6、7、8、9、10、11、12、13、14、15、16、17、18、20、22、24、25、
  27、28、30、32 px；圆角 3、7、8、9、10、12、14、16 px 八档；字号 10、11、12、13、14、15、18、
  22、25、26 px；字重 500、550、600、650，对话框标题沿用浏览器默认 700。
- 品牌角色图只在品牌稿里，空会话页没有用到；[design](../design.md) 允许角色出现在空状态。

## 2. 参照

| 位置 | 看什么 |
|---|---|
| main `dde4e1b`：`apps/desktop/renderer/styles.css`、`main.tsx` | 全部现有规则；`main.tsx` 第 3 行引入样式 |
| `apps/desktop/features/*/renderer/*.tsx`、`renderer/*.tsx` | 每个 class 实际在哪里用 |
| [docs/design.md](../design.md) | 品牌色、组件表、状态表、窄窗口验收尺寸（1120 × 800 与 780 × 560） |
| `design/brand/2026-10-28-brandkit/character.png` | 空状态角色图的来源，1254 × 1254 透明 PNG |
| `scripts/desktop-build.ts` | renderer 的 esbuild 入口；`index.html` 用 `cpSync` 复制，静态资源照此处理 |
| `apps/desktop/renderer/index.html` | CSP：`img-src 'self' data:`、`style-src 'self'` |
| moyyi Design System（owner 私有 artifact，Codex 可能打不开） | 现状 token 的整理稿；本简报已包含实施需要的全部数值 |

不引入新的 npm 依赖；不参照 DSH 或 OpenBot 的视觉。

## 3. 不变的边界

- 宿主、`main.ts`、`preload.ts`、`shared.ts`、worker、IPC 通道、持久化格式、设置文件：不改。
- 组件结构和文案不改。唯一的 TSX 改动是第 4 节 E 的空状态图片。
- 安全：不加载远程资源；新图片随包本地加载，满足现有 CSP，不放宽 CSP。
- `prefers-reduced-motion` 规则保留；不新增动画。
- 布局结构不变：侧栏 240 px（800 px 以下 190 px）、对话列最宽 800 px、对话框 560 px、
  `body` 最小 560 px、800 px 断点。
- `--focus #1f6fd6` 和焦点框样式（2 px 实线、偏移 3 px）不变。
- OpenBot 许可头保留；从 `styles.css` 拆出的 `tokens.css` 带同样的许可头，
  [provenance](../openbot-provenance.md) 中 `styles.css` 一行补上 `tokens.css`。
- 不需要 ADR：不涉及层次、扩展点或保证。

## 4. 工作内容

### A. 单一 token 文件

- 新建 `apps/desktop/renderer/tokens.css`，只放 `:root { --… }` 声明。`main.tsx` 先引入
  `./tokens.css`，再引入 `./styles.css`。
- `styles.css` 不再声明任何 `--` 变量，也不再出现颜色字面量。`:root` 里的 `color`、`background`、
  `font-family`、`font-size` 改为引用变量。
- token 全集如下，名字和值以此为准（✱ 为新增或改值）：

| 类别 | token | 值 | 用途 |
|---|---|---|---|
| 底色 | `--page` | `#fcfcfc` | 对话区、根背景 |
| | `--sidebar` | `#f5f5f6` | 侧栏 |
| | `--surface` | `#ffffff` | 卡片、面板、对话框、输入区、默认按钮 |
| | `--fill` | `#f0f0f2` | 用户消息气泡、预览块、代码块 |
| | `--fill-hover` | `#ececee` | 按钮悬停 |
| | `--selected` | `#e6e6e8` | 保留，供以后的中性选中态；当前会话行改用品牌色（见 B） |
| 线 | `--line` | `#e3e3e6` | 装饰性分隔线和卡片描边（不承担控件边界） |
| | ✱`--control-border` | `#8a8a8f` | 输入框、选择框、文本域、输入区、拖放区的边框；表格单元格边框改用 `--line` |
| 文字 | `--text` | `#1d1d1f` | 正文 |
| | ✱`--muted` | `#636368`（原 `#6e6e73`） | 次要文字；也用于 placeholder |
| 状态 | `--focus` | `#1f6fd6` | 焦点框 |
| | `--danger` | `#b3261e` | 错误、停止、破坏性操作 |
| | `--attention` | `#94480b` | 等待批准、结果未知、预览警告 |
| | ✱`--attention-soft` | `#fcf5ee` | 审批卡背景 |
| 品牌 | ✱`--brand` | `#263c67` | 主按钮、当前会话标题、侧栏字标、复选框 `accent-color`、输入区/拖放区获得焦点时的边框 |
| | ✱`--brand-hover` | `#1c2e52` | 主按钮悬停 |
| | ✱`--on-brand` | `#ffffff` | 品牌底上的文字 |
| | ✱`--brand-soft` | `#dce7f5` | 当前会话行背景 |
| | ✱`--brand-accent` | `#a7c1e8` | 只做装饰，本交付不使用；不得用于文字 |
| | ✱`--brand-offwhite` | `#f6f8fc` | 品牌底面，本交付不使用 |
| 其他 | ✱`--backdrop` | `rgb(0 0 0 / 28%)` | 对话框遮罩 |
| | ✱`--disabled-opacity` | `0.45` | 禁用按钮 |
| 字体 | ✱`--font-sans` | 现有系统字体栈原样 | 界面文字 |
| | ✱`--font-mono` | `ui-monospace, SFMono-Regular, Menlo, monospace` | 代码、哈希、工具输出 |

- 被替换的字面量去向：`#111`/`#333`/`#fff`（主按钮）→ `--brand`/`--brand-hover`/`--on-brand`；
  `#d7d7db`、`#ccc` → `--control-border`；`#999`、`#444` → `--brand`；`#8e8e93` → `--muted`；
  `#ddd` → `--line`；`#f3f3f3` → `--fill`；遮罩 → `--backdrop`。

### B. 品牌色和重点状态

- 主按钮（`button.primary`）：`--brand` 底、`--on-brand` 字、同色边框；悬停 `--brand-hover`。
- 当前会话行（`.session-item[aria-current="true"]`）：`--brand-soft` 背景，标题 `--brand`，
  第二行保持 `--muted`。
- 侧栏字标 `.brand`：`--brand`。
- 审批卡（`.approval-card`）：`--attention-soft` 背景，1 px `--attention` 边框，其余不变；
  标题行原本就是 `--attention`。这样“等待批准”在页面上比其他卡片更醒目。
- 输入区（`.composer-box`）与材料拖放区获得焦点时边框改为 `--brand`。
- 复选框 `accent-color`：`--brand`。

### C. 间距、圆角、字号、字重收敛

- 新增 token：
  - 间距：`--space-1` 4 px、`--space-2` 8 px、`--space-3` 12 px、`--space-4` 16 px、`--space-5`
    20 px、`--space-6` 24 px、`--space-8` 32 px。
  - 圆角：`--radius-xs` 4 px、`--radius-sm` 8 px、`--radius-md` 12 px、`--radius-lg` 16 px。
  - 字号：`--text-xs` 11 px、`--text-sm` 12 px、`--text-md` 13 px、`--text-base` 14 px、
    `--text-lg` 16 px、`--text-xl` 18 px、`--text-2xl` 24 px。
- `padding`、`margin`、`gap`（含 `row-gap`、`column-gap`）里的 px 值换成最近的间距 token，与两侧
  距离相等时取较大的一档。对照：3、5 → 4；6、7、9 → 8；10、11、13 → 12；14、15、17 → 16；
  18 → 20；22、25、27 → 24；28、30 → 32。0 和不超过 2 px 的值（光学微调，如复选框 `margin: 2px 0 0`、
  行内代码 `padding: 1px 4px` 中的 1 px）保持字面量。`min(12vh, 100px)` 这类与视口相关的表达式保留，
  只换其中的固定间距部分。
- 圆角按组件定，不按数字就近：
  - `--radius-xs`：行内代码；
  - `--radius-sm`：按钮、输入框、选择框、文本域、卡片内的预览块和代码块、会话行、文档图标、拖放区、
    操作记录行右侧圆角；
  - `--radius-md`：卡片和面板（材料、来源、报告成果、报告预览）、工具消息、历史提示、用户消息气泡；
  - `--radius-lg`：审批卡、输入区、对话框。
- 字号全部用 `--text-*`：10 → 11；15（对话标题）→ 16；22、25、26（字标、空状态标题、启动页标题）
  → 24；删除 800 px 以下把空状态标题改成 22 px 的规则。其余 11/12/13/14/18 一一对应。
- 字重只用 400、500、600：550（报告卡路径）→ 600，650（字标）→ 600，对话框 `h2` 显式写 600。
- 行高本交付不收敛。

### D. 用测试守住规则

新建 `apps/desktop/renderer/styles.test.ts`（vitest，读两个 CSS 文件的文本，不引入 CSS 解析依赖）：

1. `styles.css` 中没有十六进制颜色、`rgb(`、`rgba(`、`hsl(`、`hsla(`，也没有颜色关键字（`transparent`、
   `currentColor`、`inherit` 除外）；颜色只能写在 `tokens.css`。
2. `styles.css` 里每个 `var(--x)` 都在 `tokens.css` 中声明；`tokens.css` 声明的变量都至少被
   `styles.css` 使用一次，`--brand-accent`、`--brand-offwhite`、`--selected` 三个列入测试里的
   “预留”名单除外。
3. `padding`、`margin`、`gap`、`row-gap`、`column-gap` 的值里，除 `0`、`auto`、不超过 2 px 的值和
   `vh`/`vw`/`%` 表达式外，不出现 px 字面量；`border-radius` 只用 `--radius-*`、`0` 或 `0 X X 0`
   这类由 token 组成的组合；`font-size` 只用 `--text-*` 或 `inherit`。
4. 对比度：测试从 `tokens.css` 读出颜色，用 WCAG 2.1 相对亮度公式计算，以下组合不达标即失败：
   - ≥ 4.5:1：`--text` 与 `--muted` 分别对 `--page`、`--sidebar`、`--surface`、`--fill`、
     `--fill-hover`、`--selected`、`--brand-soft`、`--attention-soft`；`--danger`、`--attention`
     对 `--page`、`--surface`、`--attention-soft`；`--on-brand` 对 `--brand`、`--brand-hover`；
     `--brand` 对 `--brand-soft`。
   - ≥ 3:1：`--control-border` 对 `--page`、`--sidebar`、`--surface`；`--focus` 对 `--page`、
     `--sidebar`、`--surface`、`--fill`、`--selected`、`--brand-soft`、`--attention-soft`；
     `--attention` 对 `--surface`（审批卡边框）。

按第 4 节 A 的数值，以上组合全部达标（最低：`--muted` 对 `--brand-soft` 4.78:1，`--control-border`
对 `--sidebar` 3.15:1，`--focus` 对 `--brand-soft` 3.90:1；共 36 组）。如果实际计算有组合不达标，
按第 7 节停下。

### E. 空会话页的角色图

- 用 macOS 自带 `sips` 从 `design/brand/2026-10-28-brandkit/character.png` 生成
  `apps/desktop/renderer/assets/empty-character.png`，最长边 320 px（显示 160 px，兼顾 2 倍屏），
  不做其他处理。把生成命令写进 PR 说明。
- `scripts/desktop-build.ts` 像 `index.html` 一样把它复制到输出目录的 `assets/`；打包和
  `verify:desktop` 若有文件清单或哈希检查，一并更新。
- `EmptyConversation`（`features/conversation/renderer/index.tsx`）在 `<h2>` 前加
  `<img className="empty-character" src="./assets/empty-character.png" alt="" aria-hidden="true">`。
  样式：高 160 px、宽自动，下边距 `--space-4`；窗口高度小于 640 px 时 `display: none`，保证
  780 × 560 时输入区和标题不被挤出首屏。
- 只放在空会话页。消息、审批、结果、对话框里不放（[design](../design.md) 的品牌规则）。

## 5. 文档

Codex 更新：

- [docs/design.md](../design.md)：
  - “Tokens” 一节改写为第 4 节 A、C 的完整 token 表和收敛规则，说明 `tokens.css` 是唯一来源，
    `styles.test.ts` 守住颜色、间距、圆角、字号和对比度；
  - 删除“Add brand tokens when the next UI delivery touches primary actions”这类已完成的待办句；
  - Brand 一节写明角色图已用于空会话页。
- [moyyi-desktop-ui](../../.agents/skills/moyyi-desktop-ui/SKILL.md) 第 2 步：变量来源改为
  `apps/desktop/renderer/tokens.css`，并提到新增 token 时同步对比度测试。
- [provenance](../openbot-provenance.md)：`styles.css` 一行补 `tokens.css`。

Claude 验收时更新：system overview 的桌面端状态行、本计划的交付记录、owner 的 moyyi Design
System（按验收后的 token 重新同步）。

## 6. 完成标准（交付结束时统一验收）

1. `npm run check` 通过，包含新的 `styles.test.ts`。
2. `npm run desktop:build`、`npm run desktop:package`、`npm run verify:desktop` 通过（合成模型，
   不读密钥）。
3. 改动范围：`git diff --stat origin/main...HEAD` 只涉及 `apps/desktop/renderer/tokens.css`、
   `styles.css`、`styles.test.ts`、`main.tsx`、`assets/empty-character.png`、
   `features/conversation/renderer/index.tsx`、`scripts/desktop-build.ts`（及打包/验收脚本中的
   文件清单，如有）和第 5 节的文档。宿主、IPC、`shared.ts`、持久化相关文件零改动。
4. `apps/desktop/renderer/render.test.ts` 原有断言不改即通过。
5. 原生截图：在安装形态的应用里，以 1120 × 800 和 780 × 560 两种窗口尺寸，各截以下状态的
   改前（main）与改后对照，附在 PR 里：空会话页；运行中的对话（含输入区和停止按钮）；等待批准的
   审批卡；含“结果未知”一项的操作记录；模型设置对话框；会话权限对话框；侧栏选中一个会话；
   用 Tab 把焦点移到主按钮和一个输入框时的焦点框。780 × 560 下空会话页不显示角色图，且输入区
   完整可见。
6. 用键盘走一遍上述界面，每个控件都能获得焦点并显示焦点框。
7. 模型请求 0 次，付费 0。

## 7. 先做完，再集中修复

可以先记下、最后集中改的：

- 收敛后个别位置的视觉不协调（例如某个间距从 10 px 变成 12 px 后显得松）。可以在第 4 节 C 的
  token 范围内换一档，并在 PR 中逐条列出；不能为此新增 token 或改回字面量。
- 截图里的小差异、角色图尺寸的微调（120–200 px 之间）。

必须立刻停下、交给 owner 的：

- 对比度测试中有组合按第 4 节 A 的数值不达标，或要达标就得改品牌四色（`--brand`、`--brand-soft`、
  `--brand-accent`、`--brand-offwhite`）——品牌色是 owner 的决定。
- 需要改宿主、IPC、共享类型、持久化格式、CSP，或新增 npm 依赖。
- 打包或 `verify:desktop` 因新图片无法通过、且不能只靠更新文件清单解决。

## 8. 不做

- 暗色模式（U-3：单独交付）。
- 新组件、布局调整、文案改写、图标体系。
- 矢量 logo、应用图标和 Dock 图标（还没有矢量母版）。
- 行高收敛。
- 交付三的任何功能。

## 9. 与其他工作的关系

- 交付三（[简报](2026-10-30-delivery-3-settings-skills-search.md)，随
  [PR #54](https://github.com/Peerframe/moyyi/pull/54) 合入 main；分支
  `codex/delivery-3-settings-skills-search`）正在进行，会给设置、侧栏、对话区加界面和样式。两者都改
  `styles.css`，冲突集中在这一个文件。
- 按 U-1（已接受）：两边并行开发，**先合并者为准**。
  - 本交付先合并：交付三变基后，新增的样式要通过 `styles.test.ts`（只用 token、对比度达标）。
    这只是让交付三遵守 [design](../design.md) 已有的“组件不用字面量颜色”规则，不增加它的功能范围。
  - 交付三先合并：本交付变基后，把交付三新增的规则一并按第 4 节换成 token，并把交付三新增界面
    加入第 6 节第 5 项的截图清单。
- 交付四和以后的界面都在 token 和测试之上做；暗色模式届时只需要给 `tokens.css` 增加一组值。

## 10. Owner 决定（2026-10-30 已定）

owner 当天三项全部按推荐接受：与交付三并行、先合并者为准；空会话页放角色图；暗色模式不并入。

| 编号 | 决定 | 推荐（已接受） |
|---|---|---|
| U-1 | 本交付与交付三并行开发、先合并者为准（第 9 节），还是等交付三合并后再开始 | 并行。改动集中在 CSS，冲突只在 `styles.css` 一个文件，变基成本低；等待会让交付三继续写出不合规的样式 |
| U-2 | 空会话页放角色图（第 4 节 E）。品牌稿是位图概念稿，还没有正式的生产版本 | 放。只用在空状态，符合 design 的品牌规则；有正式版本后替换同一个文件即可 |
| U-3 | 暗色模式是否并入本交付 | 不并入。需要为每个 token 定暗色值，并把第 6 节的截图量翻倍；本交付完成后它只剩 `tokens.css` 的一组值和一份截图验收，单独做更快 |
