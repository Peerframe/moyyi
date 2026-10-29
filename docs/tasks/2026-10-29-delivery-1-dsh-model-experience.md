# 交付一：模型表现对齐 DSH

- 日期：2026-10-29。
- 上级计划：[M6 之后的计划 v2](2026-10-28-post-m6-plan.md)，决定 D-F、D-G、D-H 已接受。
- 执行：Codex。M6 合并后，从最新 main 新建分支 `codex/delivery-1-model-experience`，整块实现，
  一个 PR。
- 审查与验收：Claude。
- 状态：2026-10-29 验收通过，见[实现与验收记录](2026-10-29-delivery-1-model-experience-record.md)。
- 执行中的 owner 决定（2026-10-29）：D 按第 7 节停下后，owner 批准最小持久化变更——类型化输出引用，
  持久化格式升为 2，SQL schema 仍为 3，配套迁移、备份和回滚处理。

## 1. 目标

用 DeepSeek Harness 已经在用的部件，提高 moyyi 完成真实任务的质量。现状：

- 原始源码分析题仍是严格 FAIL（6 项里 1/2/3/5 满足，4/6 部分）；
- 过去主要靠诊断单次试验和调整默认提示词推进；
- 默认指令（`src/plugins/default-instructions/index.ts`，约 2 KB）里有几条是针对那道题写的分析
  建议，容易过拟合。

本交付不追求某一道题通过，而是把 moyyi 的模型侧工作方式整体对齐一个成熟的 DeepSeek harness，
再用质量门和那道题的一次对照如实衡量。

## 2. 参照

DSH：`deepseek-ai/deepseek-harness`，固定提交 `f3803c96974ad4a94195fb97e5c637e9c2a3afe3`（MIT）。
开工时如果上游已更新，可以改用更新的固定提交，在 PR 和 provenance 里写明。

| 本交付部分 | DSH 包（`packages/` 下） | 先读 |
|---|---|---|
| A 任务清单 | `todo/tool-todo` | README 的“使用本包”和“模型体验” |
| B 重复调用提醒 | `guard/repeat-tool-reminder` | 同上，注意提醒文本和阈值 3/5/8 |
| C 只读工具超时 | `guard/timeout-policy` | 同上 |
| D 超大输出外存与修剪 | `spill/spill`、`spill/spill-policy`、`compaction/compaction-tool-result-pruner` | 同上，加实现节 |
| E 提示词组装 | `core/system-prompt`、`context/time-context`、`context/agent-instructions`、`preset/persona` | README 全文 |
| F DeepSeek 适配对照 | `llm/llm-deepseek`、`llm/token-meter`、`docs/deepseek-llm-api-wire-extensions.md` | 全文 |
| G 不需要密钥的回放测试 | `test-support/llm-replay`、`test-support/agent-loop-testkit` | README |

DSH 的整体约束（`docs/architecture.md`）里有一条直接适用：**模型能看到的内容，必须能从记录中
重建**。moyyi 已经记录完整请求，新加的任何模型可见文字都必须进入记录。

## 3. 不变的边界

- 不引入 Cordis 或任何 DSH 包作为依赖；按 MIT 改写，在 `docs/openbot-provenance.md` 新增 DSH 节，
  逐文件记录来源和提交。
- 能做成插件就做成插件；需要运行时组合的放 `src/runtime`；`core` 只在第 4 节明确允许的地方改，
  并写 ADR。
- 默认 Flash + Responses + low、零重试、现有请求、时间和输出上限都不变。
- 持久化格式（`src/contracts/persisted`）原则上不改。如果实现中发现必须改，**停下来**写明理由，
  交给 Claude 和 owner 决定，不要自行升级格式。

## 4. 工作内容

### 0. 开工第一步：质量门基线

在当前 main 上按计划第 5.2 节，用冻结的五题各跑一次。owner 提供私有 host 模块的位置。结果按
`moyyi-live-eval` 的方式记录。基线 FAIL 的题移出门。基线跑完再开始改代码。

### A. 任务清单插件 `todo`

- 新插件 `src/plugins/todo/`，注册 `todo_write` 工具：参数是完整列表
  `todos: [{ content, status: pending | in_progress | completed }]`，每次调用替换整个列表。
- 校验与 DSH 一致：内容非空、不重复、默认最多一个 `in_progress`。错误文本固定，写进 README。
- 结果是一行固定摘要（几项待做、进行中、已完成）。列表本身就在调用参数里，随历史进入后续请求，
  不另外注入上下文。
- 效果档案：不改外部状态，按只读类声明，并在 README 说明理由。
- 工具描述写清什么时候用：三步以上的任务、用户给了多项要求时，逐项对应、完成一项勾一项。这是
  针对“漏答要求”这类失败的主要手段。
- 已知限制写进 README：显式压缩后，清单只保留在摘要里。压缩提示要求摘要保留最新清单。

### B. 重复调用提醒

- 在 `src/runtime` 实现一个工具结果装饰：同一次运行中，同一工具、规范化后参数完全相同的连续调用
  达到 3、5、8 次时，在该次工具结果末尾追加提醒（文字参照 DSH，写成 moyyi 自己的版本）。
- 只是建议，不阻止调用。计数只在内存里按运行保存，用户新消息清零。
- 提醒追加在结果末尾，所以只往历史后面加内容，不破坏已有前缀缓存；它随工具结果一起被记录。
- 阈值是主机配置项，有默认值。

### C. 只读工具超时

- 盘点所有工具的超时：进程、网页、文档解析已经有自己的超时，其余列表写进 PR。
- 对没有超时的**只读类**工具，在运行时加统一截止时间：到时取消，等取消完成后返回固定错误
  `tool call timed out after <ms>ms`。写入类和进程类工具不套这层，继续用自己的取消和结果未知
  处理。
- 如果实现需要改 `core/executor.ts` 的取消路径，写 ADR，并补拒绝、取消、中断三类测试（AGENTS 对
  新副作用的要求同样适用于新的取消路径）。

### D. 超大输出外存、取回与修剪

- 工具输出超过 `maxToolOutputBytes` 时，现在是截断。改为：完整文本存进已有的内容寻址 blob 存储，
  模型看到开头、`[... N bytes omitted ...]` 标记、结尾，以及一个取回句柄。
- 新增只读工具 `read_tool_output(handle, offset, length)`，按范围取回，有单次上限，只能取回本会话
  产生的句柄。
- 需要给 `ToolContext` 或运行时加一个保存能力（插件不能直接碰 store），写 ADR。确认备份、恢复和
  软件回滚都包含这些 blob，重新打开会话后句柄仍可用。
- 上下文构建（`src/context`）在超出预算时，先把**较早的**超大工具结果替换成开头、标记、结尾加
  句柄，原记录不动，再按现有规则报错或省略可选段。这和“不丢历史”的原则一致，因为原文随时可取回。
  写进同一份 ADR。

### E. 提示词组装重整

- 默认指令拆成几段，各自归属：
  - 简短身份和总原则（静态）；
  - 运行时事实（日期、时区、操作系统、工作目录、模型名，会话级稳定）；
  - 安全和授权规则（静态，保留现有内容）；
  - 工具用法说明移进各工具的描述，由工具插件负责。
- 删除只针对单道题的分析建议（例如“区分载荷传输、权限决定和刷新生命周期”）；保留通用的证据、
  核对和诚实原则。删改清单逐条写进 PR，说明每条去了哪里。
- 保持 `static → session → turn` 的段顺序，以便前缀缓存复用。

### F. DeepSeek 适配对照

逐项对照 moyyi `src/plugins/provider-deepseek` 与 DSH `llm-deepseek`，结论写成表格放进
`docs/deepseek.md`：

- 前缀缓存：请求前缀是否稳定，缓存命中的 token 是否被读出并记录（DSH `token-meter`）；
- 推理内容在工具调用之间的续写；
- 流结束和错误分类；
- 输出上限。

明确的缺陷在本交付修；**协议差异**（DSH 原生路线走 Anthropic Messages，moyyi 走 Responses）只记录，
不切换默认协议。

### G. 不需要密钥的回放测试

- 用第 0 步基线运行的真实记录（只含公开 fixture，不含私人数据）作为夹具，让真实 runtime 回放模型
  输出，断言工具调用序列和最终文件结果。
- 提示词和工具描述变化后，记录的请求会不同；回放按调用顺序取响应，并单独报告请求差异，不因请求
  不同就失败。
- 加入 `npm run check`。

### H. 评测 CLI 能选中文档任务组

让 `npm run eval` 能显式选中 `evals/documents/tasks.ts` 中的任务（例如 `--include-documents`），
任务定义和 checker 不改。完成后 `document-report-seven-formats` 按计划第 5.1 节进入质量门。

## 5. 文档要求

- 每个新插件和改动过的插件的 README 都加“模型体验”一节：模型看到什么、token 成本、对前缀缓存的
  影响。参照 DSH 包 README 的写法。
- 新 ADR 编号顺延（ADR 0044 已被 M6 使用），预计 1–2 份：工具输出外存与修剪；如改执行器，再加
  一份超时。
- `docs/openbot-provenance.md` 新增 DSH 节；system overview 和 delivery record 的更新由 Claude 在
  验收后做，Codex 不改。

## 6. 完成标准（交付结束时统一验收）

1. `npm run check` 通过，包括新回放测试。
2. 相关 `eval:*` 离线套件通过，安装包外部检查（`verify:package` 和桌面验收）通过。
3. 质量门：基线中通过的每一题，在交付候选上各跑一次，不低于基线。文档题按第 H 部分进门。
4. 原始源码分析题按 D-H，用它原有的冻结配置和预算跑**一次**，按原六项标准独立评分，结果如实
   记录。PASS 或 FAIL 都是有效结果，不重跑，也不因结果调整提示词后再试。
5. 一次真实任务中，模型主动使用了 `todo_write`，并逐项对应用户的多项要求（从记录核实）。

## 7. 先做完，再集中修复

以下问题允许在实现阶段先记下、不中断，交付结束后集中修：

- 质量门个别题目退步；
- 提示词措辞和工具描述的细节；
- 回放测试的稳定性；
- 文档和 README 缺漏。

以下情况必须**立即停下**交给 Claude 和 owner：

- 需要改持久化格式；
- 需要放宽任何授权、上限或安全检查；
- 需要新的外部服务或密钥；
- 估计付费调用超过计划第 5.2 节的预算。

## 8. 不做

- DSH 的 `goal` 自动续行、子 agent、计划模式；
- 切换默认模型或协议；
- 自动评审或第二个模型核对答案；
- 桌面端界面改动。任务清单在界面上的显示放到交付二或交付三。
