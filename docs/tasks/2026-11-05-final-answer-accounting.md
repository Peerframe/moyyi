# 交付简报：最终回答逐项交代要求

- 日期：2026-11-05。上级计划：[post-M6 计划 v2 第 5 节质量门](2026-10-28-post-m6-plan.md#5-质量门)、
  [roadmap 质量线](../roadmap.md#quality-lane)。
- 执行：Codex。审查与验收：Claude。分支：`codex/final-answer-accounting`。
- **2026-11-05 进展**：owner 让 Claude 直接编写代码。A、B、C 已实现为默认关闭的选项
  `RuntimeOptions.finalAccounting`（CLI `--final-accounting`），默认请求一字不变；ADR 0021、0042
  已加修订。第 6 节的质量门和原题运行尚未进行，需要在 owner 的机器上用私有 host 跑：在 host 模块里设
  `finalAccounting: true`，执行 `npm run eval:gate -- --host <私有 host 模块> --allow-live`（六题，
  最多 71 次请求；`--dry-run` 只打印命令）。通过后再讨论是否改为默认开启。
- 前置：[PR #61](https://github.com/Peerframe/moyyi/pull/61)（runtime 分目录、工具目录）已合并；
  核心循环里"请求阶段和提示文字抽成纯函数"的整理（`src/core/request-plan.ts`）已合并。
  这份简报的改动只落在那个文件、`src/context/evidence-answer.ts` 和它们的测试上。

## 1. 目标

原始源码分析题至今严格判 FAIL。最近一次冻结运行（交付一记录）里，证据已经送到模型，失败在两处：

- 读到了实现，结论却说反了（第 3 项）；
- 漏掉了两个结论（选择后重建运行时、引用和脚本行为）。

交付一的补充任务里，模型主动调用了一次 `todo_write`，但把六个主题并成一项，之后再也没有更新。
system overview 已经关掉的路线有：更多检索、隔离复核、读回自查、同题加请求或换 effort。
还没试过的是：**在只能回答的最后一次请求里，要求模型把用户的每一项要求都交代清楚**。
没有证据支持的项要明说"未完成"或"未核实"，不能悄悄略过。

这次只针对"漏项"这一种失败，用一次冻结质量门判断它有没有用、有没有副作用。
"读到了却说反"属于解读错误，这次不处理，也不把它算作验收条件。

## 2. 参照

- DSH `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`：`packages/todo/tool-todo/README.md` 的
  Model Experience 一节。DSH 的 todo 工具只做整表替换，没有"收尾时逐项交代"的机制；
  这里只借鉴它记录模型可见文字的写法，不移植任何代码。
- moyyi：`src/core/request-plan.ts`（`requestBudgetNotice` 的最后一次请求分支）、
  `src/context/evidence-answer.ts`（`instruction` 常量）、`src/plugins/todo/README.md`、
  [交付一记录](2026-10-29-delivery-1-model-experience-record.md)。

## 3. 不变的边界

- 默认 Flash、Responses、low、输出 8192、零重试，请求和时间上限都不变。
- 不新增工具、上下文来源、插件接口、持久化字段或权限。core 和 context 仍然不认识任何具体插件，
  文字里只能用"如果你维护过任务清单"这种通用说法，不能按 `todo_write` 的记录做特殊计算。
- 不改原题、fixture、checker 和质量门任务集。
- 中间请求的提示文字（非最后一次）一字不改，只在最后一次请求和证据回答的说明末尾追加。

## 4. 工作

### A 最后一次请求的交代要求

在 `requestBudgetNotice` 最后一次请求那一支的末尾，追加下面这句（英文，模型可见）：

> Before answering, list each requirement the user stated and account for it: done, with the
> observation that shows it; not done; or unverified. If you kept a task list, report every
> item's final status the same way.

只追加在 `finalRequest` 为真的那一支。中间请求和"最后一次可调工具"那两支的文字保持不变。

### B 证据回答的同一要求

`src/context/evidence-answer.ts` 的 `instruction` 末尾追加：

> Account for every requirement in the original question and steering: answer it from quoted
> evidence, or say it is not done or unverified.

### C 测试与文档

- `src/core/request-plan.test.ts`：断言追加的句子只出现在最后一次请求里，另外两支的文字逐字不变。
- `src/context/evidence-answer.test.ts`：断言新的说明文字，并确认已有的证据投影不受影响。
- 需要重新录制的离线回放（`evals/replay`、DeepSeek 等夹具），如果比对的是请求字节，按现有流程
  更新夹具，并在 PR 里列出每个被改动的夹具和原因。不允许为了让测试通过而放宽比对规则。
- 用 [moyyi-model-experience](../../.agents/skills/moyyi-model-experience/SKILL.md) 的格式，
  在 `docs/instructions.md`（请求预算提示和证据回答都在这里说明）里写出：新的原文、
  每次请求增加的大致 token 数，以及对缓存的影响（只影响最后一次请求的尾部）。
- 在 [ADR 0021](../decisions/0021-request-budget-closeout.md) 和
  [ADR 0042](../decisions/0042-direct-evidence-answer.md) 末尾各加一节带日期的修订，
  说明追加了什么、为什么，不改动原有正文。

## 5. 文档

- 执行方：更新 C 中列出的文档，写交付记录 `docs/tasks/<日期>-final-answer-accounting-record.md`。
- 审查方（Claude）：验收后更新 system overview 的 Answer quality 一节和交付状态表。

## 6. 验收

1. `npm run check` 通过；离线套件 core、instructions、deepseek、long-sessions、runtime 通过。
2. **质量门**：按 post-M6 计划第 5.2 节，在候选提交上跑一遍冻结的六题。设置为 Flash、Responses、
   low、8192、`write` 档，零重试，每题跑一次。
   - 上次的基线（交付一候选）是 6/6，共 27 次请求。这次没有新的基线，直接拿那次比较。
   - 任何一题从 PASS 变成 FAIL，就进入修复环节，并且只允许在当前 main 上做一次对照运行。
3. **原始源码分析题**：用交付一的冻结配置跑一次（8 次请求、300 s、零重试，只开
   read/list/search 和导航）。按原来的六项标准严格判分，写进交付记录。
   - 重点看第 4、6 项是否从"部分达到"变成"达到"，以及答案里有没有出现逐项交代。
   - 不论结果好坏都不重跑，这道题本身不作为通过条件。
4. **付费上限**：质量门最多 71 次请求（各题上限之和），原题最多 8 次，合计不超过 79 次。
   实际用量记进交接文件的账本。

## 7. 先做完再修

- 可以收集起来最后统一修的：措辞的小问题、文档遗漏、夹具更新。
- 必须立刻停下来找 owner 的：质量门出现退步；需要改动 core 或 context 的结构；
  需要增加付费用量；需要改原题或 checker。

## 8. 不在范围内

- 解读错误（读到了却说反）的修复。
- todo 计数注入、按 `todo_write` 记录自动生成清单、自动复核或第二个评审模型。
- 桌面界面展示清单（交付三的 todo 显示另行处理）。

## 9. owner 决定

| 决定 | 建议 |
|---|---|
| 是否批准 79 次请求的付费上限 | 批准。这是交付一之后唯一针对答案质量、而且还没试过的方向 |
| 证据回答（B）是否一起改 | 一起改。否则开启证据回答时，这条要求不会生效 |
| 如果质量门无退步，但原题仍然 FAIL，是否保留这次改动 | 只要答案里确实出现了逐项交代、漏项减少，就保留；如果没有任何变化，就撤回，并在总览的"已关闭路线"里记一笔 |
