# Codex 交接：phase 0 收尾与 phase 1

写于 2026-10-24，最初基于 `main` 的 `8e977f0`。2026-10-25 按 owner 授权依次审查、合并
#2–#5，并整合交接；本次文档整合的 main 基线为已合入 #1–#4 的 `26f2e41`。由 Claude 起草，
审查者由 owner 指定；每个 PR 的实际提交、检查与合并记录以其页面为准。

**2026-10-25 最新授权：审查并合并 #12，再推进 phase 3。** #12 固定 head 审查、122 项定向测试
（含 13 项真实 SIGKILL）及 CI 通过后，已合并为 `801175f`，main CI 通过。
本轮从该最新 main 开 `codex/phase-3-sandboxed-shell`，**新 PR 不自动合并，phase 4 先不开始**。
Owner 已在研究后确定 D6：原生系统沙箱默认、Docker 可选，并授权继续完成 phase 3。
本轮沿用该分支及 PR #13，交付受控命令工具；Docker 实现保留为后续可选后端，不作为本轮前置。
不做付费调用，不访问真实凭据，不直接推送 main。
当前范围和证据见 [phase 3 记录](2026-10-25-phase-3-shell.md)；[phase 2 记录](2026-10-25-phase-2-writes.md)、[批次 7 记录](2026-10-25-batch-7-cli.md)、
[批次 6](2026-10-25-batch-6-deepseek.md)、[批次 5](2026-10-25-batch-5-files.md)、
[批次 4](2026-10-25-batch-4-core.md)和[D2／批次 3](2026-10-25-v1-and-storage.md)记录保留历史证据。

## 0. 先读

按顺序读：[AGENTS.md](../../AGENTS.md)、[architecture.md](../architecture.md)、
[roadmap.md](../roadmap.md)、本批相关的 [ADR](../decisions/)、[recipes](../recipes/)、
[evals/README.md](../../evals/README.md)、[evals/corpus.md](../../evals/corpus.md)。写插件时再读
[src/plugins/AGENTS.md](../../src/plugins/AGENTS.md)。

## 1. 现在有什么

已合入 #1–#12 的 main `801175f` 为本轮基线，包含：

- Node 26、TypeScript 7、Biome、Vitest；最新 main 基线检查包含类型检查、lint 和 1,081 项测试
- 持久化格式 `src/contracts/persisted`，版本 1，由 `fixtures/v1.ts` 锁定
- 模型、工具、插件、客户端协议契约和端口；`checkModelStream`
- 插件注册表（原子加载、归属清理、只能更严格的权限规则、隔离的事件监听）；`provider-scripted`
- 分层边界检查 `tests/boundaries.ts`
- 30 道公共评测题及多轮框架，每道题有参考答案和针对失败原因的反例；B1、B2 已修复并复核
- PR 和 main push 的 CI；缺失的 `remaining-work/fixture/progress.log` 已跟踪，不再依赖本地补件
- 三种协议的内容映射、手写合成样例和完整性测试；D2 选 B 的 ADR 已合入

D2 修订和事务存储、blob、写进程锁、工作区租约、备份已通过 #6、#7 合入。
自研核心、执行器、审批、取消、插话、重试／预算、恢复、上下文、只读策略和运行时接线已通过 #8 合入。
真实只读文件能力和 `read/list/search` 已通过 #9 合入。
DeepSeek Responses 文本/推理/函数调用适配器、固定地址 HTTP、录制回放与离线整体验证已通过 #10 合入。
已合并的批次 7 提供交互会话、流式输出、审批、Ctrl-C/EOF 收尾、插话与恢复，
以及显式开发插件的空闲重载。`npm run moyyi -- --demo` 可运行有限的离线脚本，真实模型通过
显式 `--host FILE` 配置；不自动发现工作区配置，不新增凭据后端。原有 DeepSeek 离线 demo/eval 保留。
这些不证明远端 API 已接受请求或真实 Agent 任务能力。真实冒烟及 phase 1 能力评测仍待 owner。
phase 2 已合并，提供受控创建/编辑/撤销与快照。phase 3 已按 D6 推进原生沙箱命令工具，当前交付和验收见 phase 3 记录。
计划中的 project-instructions 插件仍未交付；本轮离线结果不替代 phase 1 真实模型验收。

| PR | 已核对的合并记录 | 结果与后续 |
|---|---|---|
| [#1：批次 0](https://github.com/Peerframe/moyyi/pull/1) | `f8a81cd` | fixture、精确忽略例外和 CI 已合入；PR 与 main CI 均通过 |
| [#2：批次 1](https://github.com/Peerframe/moyyi/pull/2) | `b030053` | 30 道题、B1/B2 修复已合入；原有 14 题标准未改，合并前 262 项测试及 CI 通过 |
| [#3：批次 2](https://github.com/Peerframe/moyyi/pull/3) | `9bc5476` | 协议研究已合入；与 #2 联合检查为 271 项通过，CI 通过 |
| [#4：D2 ADR](https://github.com/Peerframe/moyyi/pull/4) | `26f2e41` | B 方案及重放失效边界已合入；集成检查及最终 head CI 通过；v1 修订仍未执行 |
| [#5：D1/D3/D5 与交接整合](https://github.com/Peerframe/moyyi/pull/5) | `1470a69` | 保留全部已定决定；PR CI 和合并后的 main 检查均通过 |
| [#6：D2 v1 修订](https://github.com/Peerframe/moyyi/pull/6) | `f92c623` | 固定 diff 审查及定向复核通过，CI 通过后合并 |
| [#7：批次 3 存储](https://github.com/Peerframe/moyyi/pull/7) | `2f5968d` | 转向 main 后新 CI 通过，合并后 main CI 通过 |
| [#8：批次 4 核心](https://github.com/Peerframe/moyyi/pull/8) | `4cc8b3a` | 修复异常流覆盖和 Unicode 截断；648 项测试、新 head CI 与 main CI 通过 |
| [#9：批次 5 文件](https://github.com/Peerframe/moyyi/pull/9) | `15ac933` | 固定 head 审查、88 个文件测试、原 head CI 与合并后 main CI 通过 |
| [#10：批次 6 模型](https://github.com/Peerframe/moyyi/pull/10) | `8fce38e` | 固定 head 审查与 153 项定向检查通过，原 head CI 和 main CI 均通过 |
| [#11：批次 7 CLI](https://github.com/Peerframe/moyyi/pull/11) | `cda24d4` | 固定 diff 审查、70 项定向测试、5 项 PTY、原 head 与 main CI 通过 |
| [#12：phase 2 写入](https://github.com/Peerframe/moyyi/pull/12) | `801175f` | 固定 diff 审查、122 项定向测试、原 head 与 main CI 通过 |

[给 Claude 的交接](2026-10-25-claude-review-handoff.md)保留原始独立分支的历史验收，已标为历史快照。
其中缺 fixture、未有 CI 和 D2 未定等状态不再是当前状态；不把旧的覆盖文件诊断冒充新检查结果。

## 2. 规则

- **分支与 PR**：每批一个分支 `codex/<批次名>`，从最新 `main` 切出，开一个 PR 到 `main`。不要基于另一个
  未合并的分支开 PR；D2／存储的依赖 PR 例外已结束。不直接推送 `main`，不改仓库设置。
  #12 已按最新授权合并；phase 3 的新 PR 不自动合并，phase 4 不开始。D6 已定，继续 phase 3 实现与验收。
- **检查**：每个 PR 的 `npm run check` 必须全绿。新行为要有测试，包括拒绝、取消和中断的情况。
- **边界**：`tests/boundaries.ts` 报错时改导入，不改规则。确实要改规则，就同时改 `architecture.md`，并在
  PR 里说明原因。
- **持久化格式**：D2 的一次性 v1 修订已完成并锁定，本轮不改 `src/contracts/persisted`；
  之后不兼容变更必须升版本和迁移。phase 2 快照使用独立 SQLite schema 2 增量迁移，不改已锁定格式。
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
| D2 | [ADR 0003](../decisions/0003-provider-neutral-content.md)：内容模型；已由 [#4](https://github.com/Peerframe/moyyi/pull/4) 合入 | 3 前置、4、6 | B：统一内容＋供应商重放信息；绑定内容哈希和来源，编辑/压缩/截断后作废；允许落盘前直接修订 v1 一次，需独立任务书 |
| D3 | [ADR 0006](../decisions/0006-security-boundaries.md)、[威胁模型](../threat-model.md)：安全边界 | 4、5，后续命令阶段 | 工作区内按能力自主、敏感路径例外；范围授权可撤销；命令真实隔离；工具网络与模型 API 分开控制；凭据受控保存；会话加密非首版前置 |
| D4 | 开源许可证 | 不影响开发 | Apache-2.0（`e7e270a`） |
| D5 | [ADR 0007](../decisions/0007-first-model-provider.md)：首个真实模型 | v1 修订参考、6 | DeepSeek 官方 API，首接 `deepseek-flash` 的 Responses 子集；当前目标是 Agent，Qwen/shasha 及训练留待以后 |
| D6 | [ADR 0013](../decisions/0013-native-process-sandbox.md)：命令执行后端 | phase 3 | 原生系统沙箱默认（Mac Seatbelt、Linux bubblewrap），直接使用授权工作区；Docker 为可选后端；明确进程组停止保证与 Mac 脱离组后代／宿主硬杀限制 |

本次同步保留了 #4 的 D2、D4 和本 PR 的 D1、D3、D5。ADR 0003 已澄清：重放信息作废后，只有
统一内容仍能形成受支持的合法请求时才能继续，否则明确拒绝或使用另行定义并验证的上下文重建；
不修补旧重放信息，不自动重做工具动作。字段修订已交付 PR #6；真实供应商适配器已通过 #10 合入；真实 API 验收仍待 owner。

### 3.1 开始批次 3 之前（历史前置，已完成）

已关闭：#1 的干净基线、#2 的 B1/B2 修复、#3 的研究及 #4 的 D2 决定，均已按顺序审查合入。
PR #5 完成交接冲突和 D1/D3/D5 文档整合；最终 head CI 与合并后的 main 均已通过，结果记录在 #5。
既有通过证据可以复用，但新提交的检查标准不能降低。

文档整合已在 main `1470a69` 验收（271 项测试及 CI 通过）。Owner 已授权依次完成以下两项：

**当前状态：两项均已完成并合入。** PR #6 完成格式修订，PR #7 完成存储及故障验收；
#7 转向 main 后的新 CI 及合并后的 main CI 均通过。以下条目保留当时的执行顺序及格式边界；
本轮最新授权已推进至 D6 已定后的 phase 3 实现，见文档开头与 phase 3 记录。

1. **独立完成 D2 的 v1 修订。** 依已授权的本轮任务书确认尚无真实存储数据；按 B 方案修订
   契约与 `fixtures/v1.ts`，补齐需要持久化的用量、终止原因、拒绝、参数来源及推理/重放信息，并验收。
   DeepSeek 的最低内容要求须在这一步核清：完整推理续接、角色映射、滚动模型别名的来源识别。落实
   ADR 0003 的合法降级或明确拒绝规则，不自动重做工具动作；实现完整供应商适配器留在批次 6。
   若已经存在真实存储数据，一次性例外失效，改按升版本和迁移流程处理，不覆盖旧 fixtures。
2. **按已授范围推进。** 修订后的 v1 锁定、D2 分支检查及 CI 通过后，继续批次 3。
   当时 owner 允许一次依赖 PR，要求完成存储后交付第二个 PR 并暂缓批次 4。该次依赖已随 #6、#7
   合并结束；后续授权已推进至批次 7；这一段仅保留批次 3 的历史顺序。

SQLite 驱动比较、建表/迁移、blob、事务和锁实现，以及存储崩溃测试，是**批次 3 内**要完成的工作，
不再拆成额外开工前项目。完整错误映射/重试处理在批次 4、6 完成；会影响持久化字段的结论提前纳入
第 1 项。真实 API 冒烟与模型能力评测在批次 6／phase 1 验收，不是存储开工的技术前置。

命令沙箱、后续写入能力、第二模型、自部署、Qwen/shasha、模型训练和会话加密，不是批次 3 的前置实现。
具体平台的隔离方案与验收需在相应能力开放前完成，不能以暂缓实现为由提前开放未隔离的命令。

### 3.2 Phase 3 的 D6 已定

Owner 已根据 [Codex / Claude / OpenCode / OpenHands / Goose 对比](../research/phase-3-execution-backends.md)
选择原生 OS 沙箱默认、Docker 可选；见 [ADR 0013](../decisions/0013-native-process-sandbox.md)。
命令直接操作授权工作区，保留 D3 的文件／网络强制边界、干净环境和失败时拒绝执行。
进程组取消不等于任意后代的绝对清除；Mac 主动脱离组和宿主 SIGKILL 后清除不在保证内。
Docker 不是默认依赖、自动回退或本轮复制回写子系统；作为后续可选后端独立验收。
该决定已授权 phase 3 实现，无需再次批准同一事项。新 PR 不自动合并，不做付费调用，phase 4 不开始。

## 4. 批次

以下保留各批的历史目标和验收。批次 0–7 和 phase 2 已合入；本轮放行 phase 3，phase 4–6 尚未放行。

### 批次 0：CI

- 目标：GitHub Actions 在 PR 和 `main` 上运行 `npm ci` 和 `npm run check`，Node 版本取自 `.nvmrc`。
- 范围：`.github/workflows/ci.yml`；owner 另批准补入缺失的合成 fixture 和精确 `.gitignore` 例外，原题标准不变。
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

### 批次 3：存储（已授权，先完成 D2 v1 修订和 3.1 节前置）

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

当前不包含 phase 4–6（长会话、第二个供应商和网页、发布）。phase 3 已获推进授权，
D6 已确定并推进实现；不因此宣布 phase 1 真实模型验收完成。

Qwen 和 shasha 仅保留为未来方向。当前不训练模型、不选训练底座或购买/租用算力；先把 Agent 做好。
