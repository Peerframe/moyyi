# 界面交付二：回执与对账

- 日期：2026-11-01。
- 上级计划：[M6 之后的计划 v2](2026-10-28-post-m6-plan.md)。owner 在
  [界面交付一](2026-10-30-ui-delivery-1-design-foundation.md)之后追加，不改变交付零至四的内容和顺序。
- 方向：owner 于 2026-11-01 确认"对账"方向（画板与设计系统见第 2 节）。
- 执行：Codex。**等交付三（[PR #56](https://github.com/Peerframe/moyyi/pull/56)）和界面交付一都合并后**，
  从最新 main 新建分支 `codex/ui-receipts`，整块实现，一个 PR。
- 审查与验收：Claude。

## 1. 目标

每一轮结束，用户在回答下方看到一张**本轮回执**。回执里有：

- 这一轮读了什么、改了什么、运行了什么、用了多少次请求和多少时间；
- 一个**印章**，表示回答里的说法和内核记录是否对得上。

回执的每一项都来自内核记录，不来自模型的回答。界面同时换成 v2 的外壳和组件，把现在分散的
面板、免责声明和内部工具名收拢成一个对象。

为什么做这个：2026 年 agent 产品的公开反馈里，用户抱怨最集中的是五件事：

1. 说做完了，其实没做；
2. 做错了撤不回；
3. 批准提示多到变成条件反射；
4. 花了多少，事后才知道；
5. 引用看着像证据，其实没核对过。

调研摘要见画板 Research。moyyi 的内核本来就记录每一次请求和每一个副作用，所以可以把"模型说的"
和"实际发生的"对照起来，别的 agent 很难做到这一点。现在的界面没有用上这个底子。

在 main `60b1e11` 上，结果页的实际状态如下（画板 v1「结果与操作记录」）：

- 回答、「报告成果」面板、「操作记录」面板是三块互不相连的灰色面板。同一屏有 4 段"不代表……"
  的说明：outcome 行、两段面板说明和输入区底部。
- 工具活动直接显示内部名和状态，例如 `read_file · 已返回`（`toolStateLabel`）。
- 顶栏有五个分量相同的按钮，下面还有一行约 60 字的参数说明。780 宽时工作目录路径会折成两行。
- 批准卡不说明这个动作能不能撤销。`EffectProfile.reversibility` 已经记录在 effect 上，
  但 `DesktopApproval` 没有把它传给界面。
- 没有任何地方把回答里的说法和记录对照。模型说"检查已通过"，而记录里检查超时、结果未知时，
  两者分别出现在不同面板，靠用户自己发现。

## 2. 参照

| 位置 | 看什么 |
|---|---|
| 画板 [moyyi 界面设计](https://claude.ai/artifact/L4in47dfwdoSWSb2LqYoy6)（owner 私有，可能打不开） | Research、Principles、v2 回执（已核对 / 有出入）、计划与决定、780 × 560、组件规范 |
| 设计系统 [moyyi Design System](https://claude.ai/artifact/HUoK1edN87Quu38Zk2gazc)（同上） | `tokens.json` v2，以及 Receipt、Stamp、DecisionCard、Plan、Step、Citation、ScopeChip、Send、SessionSidebar、Composer、Message 的 README；`components/index.d.ts` 里的 `TurnReceipt` 草案 |
| `src/contracts/receipts.ts` | 现有执行回执只从匹配的记录里抽取有界字段，不读回答正文；新的对账沿用同样的做法 |
| `src/contracts/history.ts` | `SessionManagement` 端口、`SessionHistoryMessage`；新的投影加在这里 |
| `src/contracts/persisted/effects.ts` | `EffectProfile.class` / `reversibility` / `verification`、`EffectState` |
| `apps/desktop/features/effects/`、`artifacts/`、`conversation/`、`sessions/`、`todos/`（交付三新增） | 现有面板、批准卡、消息、会话列表、记录的任务清单 |
| `apps/desktop/renderer/view-state.ts`、`slot-types.ts` | 状态文案、插槽；ADR [0045](../decisions/0045-desktop-feature-modules.md) 规定的功能模块写法 |
| [design](../design.md)、`apps/desktop/AGENTS.md` | 现行界面规则；本交付会更新 design.md |

如果画板和设计系统打不开，以本简报为准，本简报包含实现所需的全部决定。画板里的类名只是设计名，
可以改成别的名字，但 token、尺寸和规则以本简报和设计系统 README 为准。

## 3. 不变的边界

- **持久化格式不变。**回执和对账都在读取时由记录算出，不写入存储；session format 和 SQL schema
  都不变。如果确实需要存新字段，立即停下（第 7 节）。
- **模型看不到任何新东西。**不改提示词、工具名、工具描述、上下文分段，也不把回执或对账结果放进
  请求。新增测试要证明：同一份 scripted 会话在改动前后渲染出的模型请求逐字节相同。
- **授权不变。**每个写入和命令仍然逐次批准，不加"本会话不再询问"。撤销仍然走现有方式：准备草稿、
  由模型调用 `undo`、用户批准；宿主不直接改文件。
- **对账是确定性的。**不调用任何模型，不读取工作区文件。打开回执时"当前文件是否一致"沿用现有的
  `effect.inspect`。
- core、policy、provider 不改；不新增 npm 依赖；CSP 不变。
- 重新打开的历史会话仍是只读的；回执只能查看，"准备撤销"在只读会话里不可用，并在旁边说明原因。
- token、对比度和 `styles.test.ts` 规则沿用界面交付一。新增的 token 必须登记，并通过对比度测试。

## 4. 工作内容

### A. 回执投影与对账（`src/contracts`，纯函数）

新文件 `src/contracts/turn-receipt.ts`，不做 I/O，不引用任何包，写法和 `receipts.ts` 一样：

```ts
export function buildTurnReceipt(input: TurnRecords): TurnReceipt;
export function reconcileAnswer(answer: string, records: TurnRecords): readonly ReceiptClaim[];
```

`TurnRecords` 是一次 run 的有界记录：

- 本 run 的最终 `assistant_message` 正文。不含 reasoning，也不含中间轮次的正文。
- 本 run 的工具调用参数和结果。
- 本 run 的 effect 记录。
- 本 run 的请求预算 notice。
- 本会话在本 run 之前已经记录的读取，只要 path 和 range。

`TurnReceipt` 和 `ReceiptClaim` 的字段以设计系统 `index.d.ts` 为起点，可以按实现调整，但下面的
含义不变。

**回执内容**

- `reads`：本 run 里的 `read`、`read_document`、`web_fetch`。记录 path 或 URL，有 range 时一并记录，
  再加上回答里引用它的次数。`list` 和 `search` 只计入步骤，不算来源。
- `changes`：`create`、`edit`、`undo` 的 effect，带 `reversibility` 和状态。如果有报告成果，
  合并到对应的那一行上。
- `commands`：`shell` 的 effect，带 termination、exitCode，以及输出是否被截断。
- `requests`：从记录的预算 notice 取"第 N 次 / 共 M 次"。没有记录时不显示上限。
- 用时：从本 run 的第一条记录算到最后一条记录。时限只有在本 run 有记录时才显示，
  **不能用当前设置去补历史 run 的数值**。

**对账规则（全部写进 ADR）**

1. **范围和上限。**扫描回答前 64 KB。按 `。！？!?.` 和换行切句，最多取 50 条说法，每条
   `quote` ≤ 120 字。
2. **跳过否定句和条件句。**句子里有下面这些词就跳过：未、没有、没、不、无法、失败、尚未、如果、
   若、假如、一旦、not、n't、never、failed、unable、if、once、unless。
3. **主体识别。**
   - 路径：在反引号里，或者符合"含 `/`，或以常见扩展名结尾"。按 run 的工作目录归一化成相对路径。
   - 命令：反引号里的文本，且第一个词和本 run 某条 shell 命令的第一个词相同。
   - 网址：`http(s)://` 开头的 URL 或主机名。
4. **改动说法：**同一句里有路径，也有改动动词（已创建、创建了、已写入、写入了、已修改、改好了、
   已更新、已保存、保存到、已删除、created、wrote、written、updated、modified、saved、deleted）。
   - **对得上**：本 run 有这个路径的 `create`/`edit`/`undo` effect，状态是 `succeeded`。
   - **有出入**：本 run 对这个路径没有成功的写入 effect，包括被拒绝、失败、取消、结果未知或完全
     没有写入。
5. **检查说法：**句子里有通过类短语（测试通过、检查通过、已通过、全部通过、运行成功、编译通过、
   tests pass、tests passed、all checks pass、build succeeded）。
   - 选哪条命令：句子里点名了命令，就用那一条；没点名，就用本 run 最后一条 shell effect。
   - **对得上**：termination 为 `exited` 且 exitCode 为 0。
   - **有出入**：其他任何情况，包括本 run 没有 shell effect。
6. **来源说法：**一句话里有路径或网址，但不是改动说法。
   - **对得上**：本会话截至本 run 有这个路径或网址的读取记录。
   - **未找到记录**：没有这样的记录。这一档不算有出入。
7. **印章只有一个，按优先级取：**
   - 有出入（任意一条说法有出入）；
   - 结果未知（任意 effect 是 `unknown`）；
   - 进行中（run 还没结束）；
   - 已撤销（本 run 的每一条改动后来都被撤销，并且撤销成功）；
   - 已核对（至少有一条说法或一个 effect，并且全部对得上）。

   既没有识别到说法、也没有 effect 时，不盖章。
8. **措辞。**"已核对"的意思是"和记录一致"，不是"回答正确"。界面和文档都不能写成"已验证正确"。

### B. 存储读取与桌面宿主

- **端口。**`SessionManagement` 新增只读方法：`receipt({ sessionId, runId })`，返回 `TurnReceipt`。
  实现放在 `src/store`/`src/runtime` 现有的 history 实现旁边，只读已有的表。单个 run 不超过
  500 条记录时，从 store 读取到算完要在 50 ms 内（测试里量）。
- **消息。**`SessionHistoryMessage` 和桌面 `DesktopMessage` 新增两个字段：
  - `runId`；
  - `subject?`：只有工具消息有，≤ 256 字，取自记录的工具参数，是 path、命令首行或主机名。

  验证器负责拒绝超长或类型不对的值。
- **批准。**`DesktopApproval` 新增 `reversibility`，取自待批准 effect 的 `EffectProfile`。
- **新功能模块** `apps/desktop/features/receipts/`，按 ADR 0045 的结构写：
  - 包含 contract、host、validation、state、renderer 和 README；
  - 命令 `receipt { sessionId, runId }`；
  - state 按 runId 缓存最近 20 张回执；
  - 运行中，effect 状态变化时更新指标，印章为"进行中"；
  - run 结束时计算最终回执；
  - 打开历史会话时，按需计算可见的回执。
- **会话列表。**会话行新增 `attention?: "decision" | "mismatch" | "unknown"`。
  - 当前会话：实时状态。
  - 其他会话：只算列表可见页的前 20 个，取各自最新 run 的印章，按最新 runId 缓存。
  - 不为了这个字段去打开更早的页。

### C. 界面（renderer，按设计系统 v2）

**外壳**

- 侧栏宽 248，按今天、本周、更早分组。每行最多一个状态点：
  - 橙色实心点：等你决定，或有出入；
  - 橙色虚线圈：结果未知。

  每个点都带 `title` 和读屏文字。
- 窗口宽度小于 900 时，侧栏收成 56 的竖条：标记、新会话、会话列表开关、设置。
- 顶栏高 56。左边是工作目录名，路径用等宽字体，单行省略。右边是 **ScopeChip** 和"更多"：
  - 写入权限：显示"写入需批准"或"只读"；
  - 网页：显示"网页 关"或"网页 · N 个站点"；
  - 模型和预算：显示"Flash · 4 次 · 120 秒"；运行中显示"3 / 4 次"，到上限时变橙。
- 每个 chip 打开原来对应的对话框，自己不改任何权限。"使用帮助"和"切换目录"放进"更多"。
  窄窗口只保留写入权限和请求次数两个 chip。
- `permission-line` 插槽里的长句删除，信息改由 chip 显示。
- `header-actions` 的现有贡献改成 chip 或"更多"里的菜单项，插槽名可以重命名为 `header-scope`。

**对话**

- 用户消息是右侧的 `fill` 气泡，不再显示"你"标签。回答没有气泡，也不再显示"moyyi"标签。
- 工具消息改成 **Step**：
  - 默认收成一行摘要，例如"读取 2 个文件 · 修改 1 个 · 运行 1 条命令 · 41 秒"；
  - 展开后逐条显示，每条是图标、动词、`subject`、状态。
- 动词对照：

  | 工具 | 动词 |
  |---|---|
  | read, read_document | 读取 |
  | list | 列出 |
  | search | 查找 |
  | create | 创建 |
  | edit | 修改 |
  | undo | 撤销 |
  | shell | 运行 |
  | web_fetch | 访问 |
  | web_search | 搜索 |
  | read_tool_output | 查看输出 |
  | read_skill | 读取技能 |

  `todo_write` 不显示成步骤，画成 Plan。
- 状态对照：

  | 原状态 | 显示 |
  |---|---|
  | succeeded | 完成 |
  | approved | 你已批准 |
  | denied | 你已拒绝 |
  | started | 进行中… |
  | unknown | 结果未知（橙色） |

  其余状态沿用现有中文。
- 以后新增的工具，必须在同一个映射表里登记动词，否则测试失败。
- 回答里"对得上"的来源说法，在句末显示为 **Citation**，点开看记录的读取。"未找到记录"的说法
  加橙色虚线下划线，后面跟一个描边标签。

**回执**

- **Receipt** 显示在每轮最后一条回答下方，结构和优先级按设计系统 Receipt README。它取代
  对话流里的"报告成果"面板、"操作记录"面板和 outcome 行。
- 两个面板原有的功能都要保留：
  - 打开报告、另存副本、核对当前文件：放到对应的改动行上；
  - 分页查看全部操作：从"更多 → 全部操作记录"打开，放在对话框或 `right-panel`。
- 改动行的按钮叫"**准备撤销**"，沿用现有的 `undoDraft`。
- 回执底部有"**撤销本轮全部改动…**"：生成一份按逆序撤销本轮全部改动的草稿，每一步仍要批准。
- 有出入时，有出入的行排在最前面，每行显示"回答说 / 记录显示"，并带一个只读操作：
  "只读查看输出"或"核对当前文件"。

**决定和计划**

- **DecisionCard** 取代 ApprovalCard：
  - 显示可逆性标签：可撤销 · 已留快照；不可撤销 · 将运行命令 / 将发送请求；
  - 标题是动作本身（例如"创建 budget/merged.csv"）；
  - 下面依次是一句说明和原有预览；
  - 底部说明"只批准上面显示的内容"，按钮是"拒绝"和"批准这一步"；
  - 有任务清单时，眉题写"需要你决定 · 第 N 步"。
- **Plan** 显示交付三 `todos` 模块记录的本 run 最新清单，等待批准的那一步高亮。

**输入区**

- 一个圆角 16 的框：先是文本，然后一条操作栏，依次是"材料"、状态提示和 **Send**。
- 运行中，Send 变成停止，提示写"正在处理 · 第 N / M 次请求"；等待批准时提示写"等你决定"。
- 删除输入区底部的免责声明。

**文案**

- 删除以下文案和类似说法："已返回"、"不代表正确"、"不代表任务已全部通过"、"生成回执"、
  "刷新记录"、"本轮已结束，请核对回答与来源。"
- 状态只用设计系统 README 的状态词表。
- `UsageGuide` 随之更新。

**token**

在 `tokens.css` 新增：

| token | 值 |
|---|---|
| `--danger-soft` | `#fbefee` |
| `--added` | `#1f6b3a` |
| `--added-soft` | `#eef6f0` |
| `--radius-full` | `999px` |
| `--shadow-card` | `0 1px 2px rgb(29 29 31 / 6%), 0 4px 16px rgb(29 29 31 / 4%)` |

`--shadow-card` 只用于 DecisionCard 和输入区。`styles.test.ts` 增加以下对比度组合，全部要
≥ 4.5:1：

- danger 在 danger-soft 上；
- brand 在 brand-soft 上；
- attention 在 attention-soft 上；
- muted 在 brand-offwhite 上；
- added 在 added-soft 上；
- text 在 fill 上。

### D. 测试和离线评测

- `src/contracts/turn-receipt.test.ts` 至少 40 个表格用例，覆盖以下情况：
  - 中文和英文；
  - 反引号路径、裸路径、带扩展名的文件名；
  - 否定句和条件句（必须跳过）；
  - 同一句里有多个路径；
  - 写入被拒绝、失败、取消、结果未知；
  - 检查超时、非零退出、没有命令；
  - 点名的命令和最后一条命令不同；
  - 撤销全部改动；
  - 只有回答、没有 effect；
  - 64 KB 和 50 条说法的上限；
  - Unicode 截断。
- 新增离线套件 `npm run eval:receipts`（`evals/receipts/run.ts`，不发请求），用 `provider-scripted` 生成至少 8 个录制会话，
  在真实 store 上跑 `receipt()`。必须包括：
  1. 如实创建文件；
  2. 写入被拒绝，却说"已创建"；
  3. 检查超时，却说"测试通过"；
  4. 中途取消；
  5. 撤销本轮全部改动；
  6. 引用读过的文件和没读过的文件；
  7. 英文回答；
  8. 含条件句的回答。
- 通过标准：
  - 任何含有出入的会话都不能盖"已核对"；
  - 如实的会话不能出现"有出入"；
  - 每个会话的印章和逐条判定都与固定期望一致。
- `render.test.ts`：
  - 被取代的断言改成对应的新断言，并在 PR 里列出替换对照，不能只删除；
  - 新增断言覆盖：印章、可逆性标签、Step 不出现任何内部工具名、只读会话里"准备撤销"不可用
    且旁边有原因；
  - 新增 host、IPC 验证测试，覆盖新字段的边界值和拒绝情况。
- 第 3 节要求的"请求逐字节不变"测试。

### E. ADR

新增 ADR（编号取合并时的下一个空号，交付三已占用 0048–0050），题目为"Turn receipts and
deterministic reconciliation"。写清：

- 回执在读取时计算，不持久化，模型看不到；
- 放在 contracts 的纯函数里；
- 第 4 节 A 的全部规则和上限；
- "已核对"的含义；
- 为什么不用模型判断；
- 以后要让模型看到对账结果，需要另立 ADR，并补评测证据。

`docs/architecture.md` 登记新端口方法和新功能模块。

## 5. 文档

- **执行方更新：**
  - [design](../design.md)：v2 原则、颜色含义、状态词表、组件清单和尺寸，并删除已经失效的规则；
  - [desktop](../desktop.md)：给用户的回执和对账说明；
  - 新模块的 README；
  - `UsageGuide`；
  - ADR 和 architecture。
  - handoff 文件按 moyyi-handoff 写。
- **Claude 验收后更新：**system overview 的"What the user can do"一行；设计系统和画板如果与实现
  不一致，以实现为准同步回去。

## 6. 完成标准（交付结束时统一验收）

1. `npm run check`、`npm run eval:receipts`、`npm run desktop:build`、`npm run desktop:package`、
   `npm run verify:desktop` 全部通过。
2. 第 4 节 D 的评测通过标准全部满足，PR 里贴出 8 个会话的印章和逐条判定。
3. 在 1120 × 800 和 780 × 560 两种尺寸下，各截一组原生截图：
   1. 空会话；
   2. 运行中（Step 展开、印章为"进行中"）；
   3. 等你决定（Plan 和 DecisionCard，可撤销与不可撤销各一张）；
   4. 回执·已核对；
   5. 回执·有出入；
   6. 回执·结果未知；
   7. 只读历史会话；
   8. "更多 → 全部操作记录"；
   9. 模型设置对话框。

   与界面交付一的截图放在一起对照。
4. 键盘走查：顶栏 chip、Step 展开、Citation、回执里的每个按钮、DecisionCard、Send 都能用键盘
   到达，焦点环可见，Esc 不会关闭 DecisionCard。
5. `git diff --stat` 只涉及第 4 节点名的区域、文档和测试。没有改动 `src/core`、`src/policy`、
   `src/plugins/provider-*` 或 `src/contracts/persisted`。
6. 整个交付发出的真实模型请求为 0 次。只报告实际运行过的命令。

## 7. 先做完，再集中修复

可以记下来、最后一轮集中修的问题：文案细节、间距微调、截图里的视觉瑕疵、测试命名、文档措辞。

遇到以下情况，**立即停下问 owner**：

- 对账需要调用模型，或需要读取工作区文件；
- 需要改持久化格式，或在存储里新增表或列；
- 需要改变授权，包括批量放行、宿主直接撤销、自动重试或重放；
- 需要改 IPC，但改动超出第 4 节 B 列出的字段和命令；
- 回执计算达不到第 4 节 B 的 50 ms 上限；
- 新 token 的对比度不达标；
- 交付三合并后的结构，与本简报假定的 `todos` 模块或会话列表不一致。

## 8. 不做

- 批量放行"本会话可撤销的写入不再逐次询问"、宿主一键直接撤销：见第 10 节。
- 把对账结果告诉模型，或用它自动重试、纠正。
- 改动的增删行数（例如 +12 −0）：现有记录没有这个数据。
- 暗色模式、动效设计、矢量 logo、CLI 端的回执显示。CLI 可以以后复用 `buildTurnReceipt`。
- 侧栏搜索，以及会话行的其他元数据。

## 9. 与其他工作的关系

- **交付三（PR #56）**：本交付依赖它的 `todos` 模块、`preferences` 和新设置结构，并占用它之后的
  ADR 编号。交付三合并前不开始。如果交付三的验收结论改变了这些模块，按合并后的实际结构执行；
  结构差异大到影响第 4 节时，停下来。
- **界面交付一**：本交付的 token、对比度测试和角色图都建立在它之上，必须在它合并后开始。
- **交付四（按条件触发的能力）**：以后新增的工具，必须在 Step 动词表里登记，并给出它的
  `EffectProfile`，回执和对账才能正确归类。

## 10. Owner 决定

| 编号 | 问题 | 推荐 | 状态 |
|---|---|---|---|
| U2-1 | 有出入时，下一轮是否自动告诉模型 | 本交付不做。先观察真实会话里有出入的频率和误报，再单独立项并补评测 | 待确认 |
| U2-2 | 可撤销的写入是否允许"本会话不再逐次询问" | 本交付不做。有了回执和可逆性标签后，再用批准率数据决定 | 待确认 |
| U2-3 | 是否允许宿主一键直接撤销，不经过模型 | 本交付不做。保持"准备撤销 → 模型调用 undo → 用户批准"的授权链 | 待确认 |
| U2-4 | 侧栏是否为非当前会话计算状态点 | 做，限可见页前 20 个，按最新 runId 缓存 | 待确认 |

上表的推荐就是本简报的默认做法。owner 不改，Codex 就照推荐执行；owner 改了某一项，先改本简报，
再开始。
