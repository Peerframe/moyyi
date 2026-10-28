# 交付零：vibe coding 环境（AGENTS.md、skill 库、设计规定）

- 日期：2026-10-29。
- 上级计划：[M6 之后的计划 v2](2026-10-28-post-m6-plan.md)。
- 执行：**内容由 Claude 写**（规则、skill、设计规定都属于设计工作）；需要的机械检查由 Codex 在
  交付二里顺带接上。本交付不改产品代码。
- 状态：2026-10-29 owner 接受 Z-1、Z-2、Z-3，Claude 开始编写；全部写完后作为一个 PR 提交。

## 1. 目标

让 Claude、Codex 和以后的贡献者打开仓库就知道三件事：

1. 自己该读什么、该改哪一层；
2. 常见工作有现成的 skill（流程说明）可用；
3. 界面怎么做才符合 moyyi 的样子。

现在的问题：

- 根 `AGENTS.md` 只有规则，没有仓库布局、命令和分工；
- 没有 skill 库，每次都靠对话重新交代流程；
- 界面只有从 OpenBot 改来的一组颜色变量，品牌稿（`design/brand/`，约 20 MB，未跟踪）和界面
  规定之间没有连接。

参照：DSH 的根 `AGENTS.md`（仓库布局、命令、约定、编辑本文件的规则）、`.agents/skills/`（约 20 个
仓库专用 skill）、`dsh-client-ui-ux` 和 `agent-experience` 两个 skill；OpenBot 的
`.agents/skills/openbot-{change,check,review,ui}`。

## 2. 目录与文件布局

| 位置 | 内容 | 读者 |
|---|---|---|
| `AGENTS.md` | 根规则，重写，英文，目标 150 行以内 | 所有 agent 和贡献者 |
| `CLAUDE.md` | 保持 `@AGENTS.md`，不另写规则 | Claude Code |
| `src/plugins/AGENTS.md` | 已有，补“模型体验”文档要求 | 改插件的人 |
| `apps/desktop/AGENTS.md` | 新增：桌面端层次、IPC、设计规定入口 | 改桌面端的人 |
| `evals/AGENTS.md` | 新增：评测规则（冻结、预算、不重跑、隐私） | 跑评测的人 |
| `docs/AGENTS.md` | 新增：文档规则（只写现状、一个事实一个位置、简报可用中文、数字与单位加空格） | 写文档的人 |
| `.agents/skills/<name>/SKILL.md` | skill 库的唯一来源 | Codex 直接读取 |
| `.claude/skills` | 指向 `../.agents/skills` 的符号链接 | Claude Code |
| `docs/design.md` | 桌面界面设计规定 | 做界面的人 |
| `design/brand/` | 只跟踪 README 和已选定的品牌稿 | 设计参考 |

`.claude/skills` 用符号链接，保证两边读到同一份 skill。写完后在 Claude Code 和 Codex 里各确认一次
skill 能被列出；不能被读取的一方改用复制，并由检查保证两份一致。

## 3. 根 AGENTS.md 结构

保留现有全部规则（层次检查、持久化格式、`contracts` 与 `core` 不做 I/O、能力进插件、副作用要求、
eval 证据、来源记录、交付前检查），并重新组织为：

1. **What moyyi is**：一句话定位，链接 system overview 和 architecture。
2. **Repository layout**：`src/` 各层、`apps/desktop`、`evals`、`docs`、`.agents/skills`，每行一句。
3. **Commands**：`npm run check`、各 `eval:*`、`verify:package`、桌面构建和验收命令，每条注明
   是否需要密钥和付费。
4. **How we work**：Claude 写设计和交付简报，Codex 按简报整块实现；交付粒度、交付结束统一验收、
   集中修复；简报保留给 owner 的决定必须停下来问。
5. **Rules**：现有规则原样保留，每条链接到它的出处。
6. **Learning from other projects**：DSH 是第一参照、OpenBot 是补充；读法见
   `moyyi-learn-from-dsh` skill；复用代码必须记录来源。
7. **Before handing off**：现有交付前检查，加“报告只写实际运行过的命令”。
8. **Editing these instructions**：一条规则只写一处；详细流程放 skill，不放这里。

## 4. Skill 库（第一批 9 个）

每个 skill 用同一格式：frontmatter 写 `name` 和一句话 `description`（写清什么时候用、什么时候不用），
正文写输入、步骤、完成标准、常见错误，链接仓库文档而不复制其内容。

| Skill | 用途 | 主要参照 |
|---|---|---|
| `moyyi-brief` | Claude 写给 Codex 的交付简报：目标、参照、落点、完成标准、可集中修复的问题、不做的事、保留给 owner 的决定 | 本计划的三份简报 |
| `moyyi-change` | 按简报实现：先定位层或插件，按 recipe 改，核心变更写 ADR，复用代码记来源，文档同步 | OpenBot `openbot-change`、DSH 约定 |
| `moyyi-check` | 选择检查：先跑相关的单项测试，再跑 `npm run check`、相关 `eval:*`、安装包和桌面验收；只报告实际运行的 | DSH `dsh-pre-push-checks` |
| `moyyi-review` | 审查固定 diff：分层、授权、持久化格式、证据说法是否夸大；一个有根据的阻断胜过一串小毛病 | DSH `dsh-code-review` |
| `moyyi-desktop-ui` | 做或审查桌面界面：按 `docs/design.md` 用设计变量和已有组件，覆盖所有状态，窄窗口可用 | DSH `dsh-client-ui-ux`、OpenBot `openbot-ui` |
| `moyyi-model-experience` | 写或改模型能看到的东西（工具描述、参数、提示词段）：说明模型看到什么、token 成本、对前缀缓存的影响 | DSH `agent-experience`、各包 README 的“模型体验”节 |
| `moyyi-live-eval` | 跑付费真实评测：先冻结任务、配置和预算，零重试，不为求通过反复重跑，结果和隐私怎么记录 | 本仓库评测规则、质量门 |
| `moyyi-learn-from-dsh` | 研究 DSH 某块能力：固定提交，读 README 的使用、实现、模型体验、限制四节，对照 moyyi 扩展点，决定采用、借鉴或不采用，记录来源 | DSH `docs/architecture`、`capability-seams` |
| `moyyi-handoff` | 中断与换号换模型（2026-10-29 owner 追加）：每完成一部分就写交接文件并做 `wip:` 提交；额度快用完时停在可恢复点；新账号或另一个模型按交接文件继续，付费预算账本随交接文件走，不重复花费 | Claude 的 handoff 做法 |

交接文件放在交付分支上的 `.agents/handoff/<分支名>.md`，合并前移除，持久内容转入 delivery record。
Claude 和 Codex 读同一套 skill 和 AGENTS.md，所以任何一方额度用完时，另一方或另一个账号都能
接着做。

第一批之后，skill 只在同一流程第二次被重新交代时才新增，不预先铺开。

## 5. 设计规定（`docs/design.md`）

把品牌稿和现有界面连起来，写成可以照着做的规定：

1. **品牌**：名称 moyyi / 墨一；形象是鲨鱼女孩（冷静、聪明、带一点俏皮）；logo 用已选定的圆润 `m`
   加尾巴方案（`design/brand/2026-10-28-brandkit`），蓝白配色。被否决的方向只在 README 里一句话
   带过。
2. **设计变量**：以 `apps/desktop/renderer/styles.css` 现有变量为基础，补品牌主色和它的悬停、选中、
   焦点色；所有颜色、间距、圆角、字号只用变量。暗色模式：写明当前不支持，需要时整体加，不逐个
   组件加。
3. **组件清单**：现有组件（审批卡、结果卡、来源面板、材料面板、历史、设置、维护对话框、富文本
   消息、图片预览）各一行：用途、状态、来自 OpenBot 还是自建。新界面先复用，再新增。
4. **状态**：每个界面都要覆盖加载、空、错误、等待审批、已取消、结果未知；不能在没有回执时显示
   成功。
5. **反馈放在哪里**：参照 DSH 的做法，区分就地提示、对话框、全局通知；错误文案写清发生了什么、
   用户能做什么。
6. **文案**：界面语言、语气（简短、直接、不拟人化），中英文混排规则。
7. **可访问性和窗口**：键盘焦点可见、减少动画偏好、最小宽度 560 px，窄窗口布局。
8. **验收方式**：界面改动要附正常和窄窗口两张截图。

`design/brand/` 只跟踪 README 和 `2026-10-28-brandkit` 中选定的文件（约 3 MB）。zip 包、被否决的
`v1`、`logo-directions` 和中间稿加入 `.gitignore`，本地保留。是否改用 Git LFS 由 owner 决定，本交付
不引入。

## 6. 由 Codex 在交付二顺带接上的检查

- 每个 `.agents/skills/*/SKILL.md` 都有 `name` 和 `description`，且 `name` 与目录名一致；
- `.claude/skills` 指向 `.agents/skills`；
- AGENTS.md 和 skill 中的仓库内链接都能解析。

## 7. 完成标准

- 上表文件全部写好；根 `AGENTS.md` 不超过 150 行；没有一条现有规则被删掉（逐条对照旧文件）。
- Claude Code 和 Codex 都能列出这 9 个 skill。
- `npm run check` 通过。
- owner 读一遍根 `AGENTS.md` 和 `docs/design.md`，确认看得懂、符合自己的意图。

## 8. 需要 owner 决定

| 编号 | 决定 | 推荐 |
|---|---|---|
| Z-1 | 按第 2–5 节的布局和第一批 skill 执行 | 是 |
| Z-2 | `design/brand/` 只跟踪 README 和选定品牌稿，其余本地保留，不进 git | 是 |
| Z-3 | 界面文案保持现状的中文（技术名词保留英文），暂不做多语言 | 是 |
