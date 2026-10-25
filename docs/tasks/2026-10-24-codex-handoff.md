# Codex 交接：phase 0 收尾与 phase 1

写于 2026-10-24，最初基于 `main` 的 `8e977f0`。2026-10-25 更新 D1、D3、D5 和开工前置；核对的
`main` 为 `e7e270a`。由 Claude 起草，owner 审阅后交给 Codex；审查者由 owner 指定，owner 决定是否合并。

**当前授权只有记录决定和提交文档 PR。批次 3 仍未获准开始。** D1–D5 已有结论，不代表相关实现已完成，
也不解除下文对持久化格式、付费调用、凭据、推送 main 和合并的限制。

## 0. 先读

按顺序读：[AGENTS.md](../../AGENTS.md)、[architecture.md](../architecture.md)、
[roadmap.md](../roadmap.md)、本批相关的 [ADR](../decisions/)、[recipes](../recipes/)、
[evals/README.md](../../evals/README.md)、[evals/corpus.md](../../evals/corpus.md)。写插件时再读
[src/plugins/AGENTS.md](../../src/plugins/AGENTS.md)。

## 1. 现在有什么

`main` 当前已有：

- Node 26、TypeScript 7、Biome、Vitest；`npm run check` 包含类型检查、lint、97 项测试
- 持久化格式 `src/contracts/persisted`，版本 1，由 `fixtures/v1.ts` 锁定
- 模型、工具、插件、客户端协议契约和端口；`checkModelStream`
- 插件注册表（原子加载、归属清理、只能更严格的权限规则、隔离的事件监听）；`provider-scripted`
- 分层边界检查 `tests/boundaries.ts`
- 评测框架和 14 道题，每道题都有标准答案和"差一点"用例

还没有：核心循环、存储、上下文组装、基础权限策略、文件和命令插件、真实模型供应商、CI。
`createRuntime` 目前对所有命令回复 "not implemented"。

2026-10-25 核对的独立 PR 均尚未合并，不能当成 main 已有能力：

| PR | 当前提交 | 状态与后续 |
|---|---|---|
| [#1：批次 0](https://github.com/Peerframe/moyyi/pull/1) | `7f802f1` | 已补 fixture 和精确忽略例外，远端 CI 通过；等待 owner 审查合并 |
| [#2：批次 1](https://github.com/Peerframe/moyyi/pull/2) | `0429f24` | 30 道题已提交；B1 多轮指标误判、B2 题面泄露答案仍需修复 |
| [#3：批次 2](https://github.com/Peerframe/moyyi/pull/3) | `7bf3857` | 协议映射和手写样例已提交；不等于真实 API 或适配器验收 |
| [#4：D2 ADR](https://github.com/Peerframe/moyyi/pull/4) | `d5fa03c` | 选 B 及一次性 v1 修订例外已记录；格式修订尚未执行 |

main 的干净检出仍缺 `evals/tasks/remaining-work/fixture/progress.log`，修复在 #1。本地忽略文件补齐后
通过，不等于该分支的干净检出或远端 CI 通过。PR #2、#3、#4 的历史通过证据带有这一前提。

## 2. 规则

- **分支与 PR**：每批一个分支 `codex/<批次名>`，从最新 `main` 切出，开一个 PR 到 `main`。不要基于另一个
  未合并的分支开 PR。不推送 `main`，不合并，不改仓库设置。
- **检查**：每个 PR 的 `npm run check` 必须全绿。新行为要有测试，包括拒绝、取消和中断的情况。
- **边界**：`tests/boundaries.ts` 报错时改导入，不改规则。确实要改规则，就同时改 `architecture.md`，并在
  PR 里说明原因。
- **持久化格式**：本交接不授权修改 `src/contracts/persisted`。D2 已允许存储落盘前的一次性 v1 修订，
  但必须另写并获准执行修订任务书；不能借批次 3 顺带修改。
- **不替 owner 做决定**：第 3 节的事项由 owner 决定。依赖这些决定的批次，在决定之前不开始；遇到新的同类
  问题，在 PR 描述里列出选项和建议，然后停下。
- **模型调用**：不做付费模型调用，不读取也不写入真实 API key。需要真实模型的验收由 owner 做。
- **新依赖**：按 AGENTS.md 的研究要求比较候选，选发布满两周的确切版本，把候选、版本和理由写进 ADR 或
  PR 描述。
- **复用代码**：不复制 OpenBot 或其他项目的源码；确实要复制，按 [openbot-provenance.md](../openbot-provenance.md)
  记录来源。
- **隐私**：不提交个人数据。`evals/private/` 不进 git，也不要往里面写东西，那是 owner 的私有题目。
- **回报**：每个 PR 描述写清四件事：做了什么、验收证据（运行的命令和结果）、没做完的、需要 owner 决定的。

## 3. Owner 已定事项与实施边界

| 编号 | 决定 | 影响批次 | 已定结论（2026-10-25） |
|---|---|---|---|
| D1 | [ADR 0002](../decisions/0002-storage.md)：本地存储 | 3 | SQLite＋blob；三类权威记录同事务；不可变对话树；正式记录默认 WAL＋FULL；每数据目录单写进程、每会话单运行、同工作区写租约 |
| D2 | [ADR 0003](../decisions/0003-provider-neutral-content.md)：内容模型；已定版本在 [#4](https://github.com/Peerframe/moyyi/pull/4) | 3 前置、4、6 | B：统一内容＋供应商重放信息；绑定内容哈希和来源，编辑/压缩/截断后作废；允许落盘前直接修订 v1 一次，需独立任务书 |
| D3 | [ADR 0006](../decisions/0006-security-boundaries.md)、[威胁模型](../threat-model.md)：安全边界 | 4、5，后续命令阶段 | 工作区内按能力自主、敏感路径例外；范围授权可撤销；命令真实隔离；工具网络与模型 API 分开控制；凭据受控保存；会话加密非首版前置 |
| D4 | 开源许可证 | 不影响开发 | Apache-2.0（`e7e270a`） |
| D5 | [ADR 0007](../decisions/0007-first-model-provider.md)：首个真实模型 | v1 修订参考、6 | DeepSeek 官方 API，首接 `deepseek-flash` 的 Responses 子集；当前目标是 Agent，Qwen/shasha 及训练留待以后 |

本 PR 从 main 独立切出，不包含 #4 的提交，也不修改 ADR 0003 正文；因此合入 #4 前，仓库内该 ADR
仍是旧版。两个 PR 都修改本交接表，后合入者必须同步最新 main、保留双方决定并重跑检查，不能覆盖掉
已定内容。D2 的重放失效处理需按下述前置工作澄清，不能把丢弃必需状态当成通用降级办法。

### 3.1 开始批次 3 之前

按顺序关闭以下事项。复用已有通过证据，但更新后的提交必须满足原检查标准，不降低门槛：

1. **建立干净基线。** owner 审查合入 #1，让 fixture 和 CI 进入 main；后续独立分支同步 main 后取得
   干净检出和远端 CI 的通过结果。不在其他 PR 里重复夹带 #1 的修复。
2. **关闭批次 1 的 B1、B2。** 在 #2 修复每轮完成声明的残留，覆盖后续轮次错误/超时；重写 8 道泄露
   陷阱或停止答案的新题，补足注入标记与有效探针，保持原有题目的标准。按 owner 提供的 Claude
   审查结论完成复核，不能只靠题目数量宣称验收。这是待执行的修复，不属于本次文档 PR。
3. **整合前置 PR。** #2 修复后、#3 研究、#4 D2 决定和本次 D1/D3/D5 文档经审查、检查通过后由 owner
   合入；解决交接文档重叠，形成一个可复现的 main 基线。不得把模拟合并的结果当作已合入。
4. **独立完成 D2 的 v1 修订。** 先写任务书并获 owner 授权，确认尚无真实存储数据；按 B 方案修订
   契约与 `fixtures/v1.ts`，补齐需要持久化的用量、终止原因、拒绝、参数来源及推理/重放信息，并验收。
   DeepSeek 的最低内容要求须在这一步核清：完整推理续接、角色映射、滚动模型别名的来源识别；若重放
   作废，只有统一内容仍可构成合法请求时才降级，否则明确拒绝或按另行验证的规则重建上下文，不自动
   重做工具动作。同步澄清 ADR 0003 的相关描述。实现完整供应商适配器留在批次 6。
5. **明确放行。** 上述前置完成、修订后的 v1 锁定且 main 检查通过后，等待 owner 明确授权开始批次 3。
   若已经存在真实存储数据，一次性例外失效，改按升版本和迁移流程处理，不覆盖旧 fixtures。

SQLite 驱动比较、建表/迁移、blob、事务和锁实现，以及存储崩溃测试，是**批次 3 内**要完成的工作，
不再拆成额外开工前项目。完整错误映射/重试处理在批次 4、6 完成；会影响持久化字段的结论提前纳入
第 4 项。真实 API 冒烟与模型能力评测在批次 6／phase 1 验收，不是存储开工的技术前置。

命令沙箱、后续写入能力、第二模型、自部署、Qwen/shasha、模型训练和会话加密，不是批次 3 的前置实现。
具体平台的隔离方案与验收需在相应能力开放前完成，不能以暂缓实现为由提前开放未隔离的命令。

## 4. 批次

以下保留各批的目标和验收。批次 0–2 已提交 PR，当前是审查收尾；批次 3 及以后仍需满足前置并获放行。

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

### 批次 3：存储（依赖 D1、D2 v1 修订和 3.1 节全部前置；尚未授权）

- 目标：`src/store` 基于经比较选定的 SQLite 驱动实现 `SessionStore`：
  - schema v1 和迁移运行器
  - 按 sha256 寻址、存在磁盘上的 blob 存储
  - `commit` 是原子的；拒绝不合法的效果状态转换（`effectTransitions`）
  - `durability` 的 `normal` 和 `before_side_effect` 都用 WAL＋FULL；前者不等于 SQLite NORMAL，
    后者保留副作用执行前的持久化屏障语义；不逐 token 提交
  - 引用 blob 的记录提交前，blob 已可靠发布；备份包括一致的数据库快照和引用的 blobs
  - 每个数据目录只允许一个写进程，用 OS 文件锁保证
- 验收测试：
  - 提交中途出错时整体回滚
  - 非法状态转换被拒绝
  - `fixtures/v1.ts` 的记录写入再读出，内容不变
  - 子进程在提交中途被杀，数据库仍然一致
  - 第二个进程拿不到锁
  - 相同 blob 只存一份
  - 两个 durability 标签都落实 FULL；blob 发布/事务中断不留下已提交但缺失 blob 的引用
  - 区分进程被杀的实测与尚未证明的物理断电保障，不作 exactly-once 副作用承诺
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
- 同时验证 D3：工作区外与敏感路径不会被普通工作区授权放行，撤销授权后不能沿用旧授权。phase 1
  仍只读，不因为 D3 已决定就开放写入或命令。

### 批次 6：DeepSeek 供应商和录制回放（依赖 2、D2、D5）

- 目标：按 [ADR 0007](../decisions/0007-first-model-provider.md) 补充 DeepSeek 专用映射，实现
  `src/plugins/provider-deepseek`，首接官方 `deepseek-flash` 的 Responses 子集。用 SDK 还是直接 HTTP
  要做选择；无论哪种都不能自动重试。实现模型响应的录制和回放，用于确定性重跑。
- 补齐 DeepSeek 的无状态历史、推理续接、角色和被忽略参数差异，以及 `ModelErrorKind`／可见部分输出
  的错误映射。工具执行上限由 moyyi 保证，不能依赖供应商忽略的参数；不支持的路径明确拒绝。
- 验收：受支持的 DeepSeek 样例经适配器解码后通过 `checkModelStream`；不支持的路径明确拒绝；回放的
  运行结果和原运行一致。其他厂商样例保留研究完整性，不要求本批实现其适配器。真实调用这一步停下，由
  owner 按既有凭据限制跑一次冒烟测试。记录模型别名、时间和已知服务版本；手写样例和本地回放不能
  冒充 API 接受或真实 Agent 成功。不开启供应商托管搜索、命令或其他新工具能力。

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

Qwen 和 shasha 仅保留为未来方向。当前不训练模型、不选训练底座或购买/租用算力；先把 Agent 做好。
