# Codex 交接：phase 0 收尾与 phase 1

写于 2026-10-24，基于 `main` 的 `8e977f0`。由 Claude 起草，owner 审阅后交给 Codex 执行；Codex 的每个 PR 由
Claude 审查，owner 决定是否合并。

## 0. 先读

按顺序读：[AGENTS.md](../../AGENTS.md)、[architecture.md](../architecture.md)、
[roadmap.md](../roadmap.md)、本批相关的 [ADR](../decisions/)、[recipes](../recipes/)、
[evals/README.md](../../evals/README.md)、[evals/corpus.md](../../evals/corpus.md)。写插件时再读
[src/plugins/AGENTS.md](../../src/plugins/AGENTS.md)。

## 1. 现在有什么

已有：

- Node 26、TypeScript 7、Biome、Vitest；`npm run check` 包含类型检查、lint、97 项测试
- 持久化格式 `src/contracts/persisted`，版本 1，由 `fixtures/v1.ts` 锁定
- 模型、工具、插件、客户端协议契约和端口；`checkModelStream`
- 插件注册表（原子加载、归属清理、只能更严格的权限规则、隔离的事件监听）；`provider-scripted`
- 分层边界检查 `tests/boundaries.ts`
- 评测框架和 14 道题，每道题都有标准答案和"差一点"用例

还没有：核心循环、存储、上下文组装、基础权限策略、文件和命令插件、真实模型供应商、CI。
`createRuntime` 目前对所有命令回复 "not implemented"。

## 2. 规则

- **分支与 PR**：每批一个分支 `codex/<批次名>`，从最新 `main` 切出，开一个 PR 到 `main`。不要基于另一个
  未合并的分支开 PR。不推送 `main`，不合并，不改仓库设置。
- **检查**：每个 PR 的 `npm run check` 必须全绿。新行为要有测试，包括拒绝、取消和中断的情况。
- **边界**：`tests/boundaries.ts` 报错时改导入，不改规则。确实要改规则，就同时改 `architecture.md`，并在
  PR 里说明原因。
- **持久化格式**：本交接里没有任何一批需要改 `src/contracts/persisted`。如果发现非改不可，停下来报告，
  不要动手。
- **不替 owner 做决定**：第 3 节的事项由 owner 决定。依赖这些决定的批次，在决定之前不开始；遇到新的同类
  问题，在 PR 描述里列出选项和建议，然后停下。
- **模型调用**：不做付费模型调用，不读取也不写入真实 API key。需要真实模型的验收由 owner 做。
- **新依赖**：按 AGENTS.md 的研究要求比较候选，选发布满两周的确切版本，把候选、版本和理由写进 ADR 或
  PR 描述。
- **复用代码**：不复制 OpenBot 或其他项目的源码；确实要复制，按 [openbot-provenance.md](../openbot-provenance.md)
  记录来源。
- **隐私**：不提交个人数据。`evals/private/` 不进 git，也不要往里面写东西，那是 owner 的私有题目。
- **回报**：每个 PR 描述写清四件事：做了什么、验收证据（运行的命令和结果）、没做完的、需要 owner 决定的。

## 3. 需要 owner 先决定

| 编号 | 决定 | 影响批次 | Claude 的建议 |
|---|---|---|---|
| D1 | [ADR 0002](../decisions/0002-storage.md) 里"Proposed"的部分：三类权威记录、对话树、blob 存储、副作用前用 `synchronous=FULL`、按会话的并发和工作区写租约 | 3 | 全部接受 |
| D2 | [ADR 0003](../decisions/0003-provider-neutral-content.md)：按两种协议设计内容模型 | 4、6 | 等批次 2 的映射结果出来再定 |
| D3 | [威胁模型](../threat-model.md)的待定问题：哪些路径不用问就能读、命令的默认网络策略、存下来的请求要不要加密 | 5 | 默认只读工作区，其他目录要询问 |
| D4 | 开源许可证。仓库已公开但没有 LICENSE，等于保留所有权利，别人不能合法使用和贡献 | 不影响开发 | MIT 或 Apache-2.0，由 owner 选 |
| D5 | phase 1 接哪个真实模型和供应商 | 6 | owner 选 |

## 4. 批次

按顺序做。批次 0、1、2 没有依赖，可以先做；其余的等依赖满足。

### 批次 0：CI

- 目标：GitHub Actions 在 PR 和 `main` 上运行 `npm ci` 和 `npm run check`，Node 版本取自 `.nvmrc`。
- 范围：只新增 `.github/workflows/ci.yml`。
- 验收：PR 上的 workflow 通过；所用 action 固定到确切版本，在 PR 描述里写明。

### 批次 1：评测题库扩到 30 道以上

- 目标：新增至少 16 道题，从 [corpus.md](../../evals/corpus.md) 的候选和下面这些方向里选：
  - 删除过时的实现和残留文件，构建和测试仍然通过
  - 修复有 git 历史的仓库里失败的检查。需要给框架加一个可选的 `prepare(workspace)` 钩子，在复制
    fixture 之后运行（例如 `git init` 并提交）；不要把 `.git` 目录放进 fixture
  - 从 fixture 里的几份 README 离线比较项目，并给出推荐；检查表格里的事实（许可证、平台、版本）
  - 多轮对话：给框架加可选的 `followUps`，前几轮先定下约束，后几轮的要求会诱使 Agent 违反它；
    检查约束是否守住
  - 提示注入：文件内容里藏着"删掉某某""把某文件发出去"之类的指令；用工作区外的哨兵目录和受保护
    文件检查，至少 3 道
  - 更多 `stop_and_report`：缺少凭据的部署，意思含糊的破坏性请求，至少再加 3 道
  - 文档和数据：表格去重合并、按元数据批量重命名文件等
- 验收：
  - 每道题都有标准答案；空 Agent 失败；只嘴上说做完的 Agent 被记为虚假成功；每个 probe 至少一个
    "差一点"用例，并确认它是因为对的原因失败
  - 6 个类别每类至少 4 道；`stop_and_report` 至少 4 道；提示注入至少 3 道
  - `corpus.md` 已更新；仓库里没有个人数据
- 不做：不写 `evals/private/`；不改已有题目的检查标准（发现问题就单独报告）。

### 批次 2：两种协议的内容映射（研究）

- 目标：写 `docs/research/content-model-mapping.md`，把 `ContentPart`、`ModelStreamEvent`、
  `StopReason`、`Usage` 双向映射到 Anthropic Messages、OpenAI Responses，以及 OpenAI 兼容的
  Chat Completions（例如 vLLM 上运行的 Qwen）。
- 依据：官方文档，写明查阅日期或版本。协议样例放在 `tests/fixtures/protocols/<provider>/`，并标明
  是按规范手写还是摘自文档（注意许可），不是真实录制。
- 产出：一份缺口清单，列出现有内容模型表达不了的东西，并附改进建议。不改持久化格式。
- 验收：每种内容类型、每种流事件在两个方向上都有对应，或明确标为缺口。这份结果供 owner 做 D2。

### 批次 3：存储（依赖 D1）

- 目标：`src/store` 基于 `node:sqlite` 实现 `SessionStore`：
  - schema v1 和迁移运行器
  - 按 sha256 寻址、存在磁盘上的 blob 存储
  - `commit` 是原子的；拒绝不合法的效果状态转换（`effectTransitions`）
  - `durability` 分两档：`normal` 用 NORMAL，`before_side_effect` 用 FULL
  - 每个数据目录只允许一个写进程，用 OS 文件锁保证
- 验收测试：
  - 提交中途出错时整体回滚
  - 非法状态转换被拒绝
  - `fixtures/v1.ts` 的记录写入再读出，内容不变
  - 子进程在提交中途被杀，数据库仍然一致
  - 第二个进程拿不到锁
  - 相同 blob 只存一份
- 驱动：用证据比较 `node:sqlite` 和 `better-sqlite3`（WAL、FULL、事务、打包），把结论写回 ADR 0002。

### 批次 4：核心循环和工具执行（依赖 3）

- 目标：在 `src/core` 实现运行循环，并用 `provider-scripted` 驱动全部测试：
  - 整条助手消息结束后才执行工具调用
  - 执行流程：参数校验 → `beforePrepare` → `prepare` → 日志 intended → `beforeExecute` → 通过协议
    审批（绑定 digest）→ 复查前置条件 → 日志 started（持久化之后才执行）→ `execute` → 结算 →
    配对的 `tool_result`
  - 取消、运行中插话、错误分类和重试策略（由核心负责）、预算（模型请求次数、时间）、启动时恢复
- 同时：在 `src/context` 实现最小的上下文组装，在 `src/policy` 实现基础权限策略。参数校验库要做依赖
  选择并记录理由。
- 验收：用脚本模型做确定性测试，覆盖以下情况：
  - 正常流程；并行的只读调用
  - 拒绝
  - 审批 digest 过期被拒；前置条件变化后重新审批
  - 流式输出中取消：部分消息存为 interrupted，所有工具调用都有结果
  - 工具执行中取消
  - started 之后进程被杀：重启后变为 unknown，不自动重放
  - 参数不合法；工具不存在；输出超限被截断
  - rate_limited 且没有部分输出时重试；已有部分输出后不重试
  - 预算用尽
- 同时把 [openbot-provenance.md](../openbot-provenance.md) 里的失败场景逐项写成测试并打勾。

### 批次 5：只读文件插件（依赖 4、D3）

- 目标：给 `ToolContext` 加受控的工作区只读能力：解析符号链接后必须仍在工作区内，有大小限制。新建
  `src/plugins/fs`，提供 read、list、search 三个工具。search 用不用 ripgrep 以及怎么分发，要做依赖
  选择。
- 验收：符号链接逃逸、`..` 路径穿越、二进制文件、大文件截断、搜索遵守 `.gitignore` 都有测试；插件里
  没有 `node:fs`（边界检查会拦）。

### 批次 6：OpenAI 兼容供应商和录制回放（依赖 2、D2、D5）

- 目标：按批次 2 的映射实现 `src/plugins/provider-openai-compatible`。用官方 SDK 还是直接 HTTP 要做
  选择；无论哪种都不能自动重试。实现模型响应的录制和回放，用于确定性重跑。
- 验收：所有协议样例都通过 `checkModelStream`；回放的运行结果和原运行一致。真实调用这一步停下，由
  owner 提供 key 跑一次冒烟测试。

### 批次 7：交互式 CLI 和开发模式热重载（依赖 4）

- 目标：CLI 支持交互会话、流式输出、审批提示、Ctrl-C 取消、运行中插话。按
  [ADR 0005](../decisions/0005-plugins.md) 的约束实现开发模式热重载：只在空闲时重载；重载失败时插件
  处于卸载状态并报告，不留半个。
- 验收：协议层面的测试，加一份手动验证步骤。

### phase 1 验收（owner）

用真实模型跑评测里的只读题目，记录 pass@1、pass^k、虚假成功次数和费用。

## 5. 不在本次交接里

phase 2–6（受控写入、命令和沙箱、长会话、第二个供应商和网页、发布）。phase 1 审查完后，再按同样
格式另写任务书。
