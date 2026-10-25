# 给 Claude 的审查交接：moyyi 批次 0、1、2

> **历史快照，非当前执行任务书。** 以下保留最初交给 Claude 时的版本、授权范围、验收结果和 D2
> 备选建议。随后 #1–#4 已按 owner 授权合入，B1/B2 已修复，fixture/CI 基线已补齐，D1–D5 已决定；
> 当前决定、合并记录和剩余前置见[当前交接任务书](2026-10-24-codex-handoff.md)及其链接的 ADR。
> 本文中的“未合并”“没有 CI”“D2 未定”等只描述当时状态；不以旧测试数字替代最终 main 验收。
> 批次 3 和持久化格式修订仍未授权开始。

更新于 2026-10-25（Asia/Singapore）。请审查下列三个 PR，并给出 D2 的独立建议。
**本次只审查；不要合并、推送 main、调用付费模型、读写真实 API key、修改
`src/contracts/persisted`，也不要开始批次 3 或以后批次。** 合并与架构决定由 owner 做。

先读仓库 `AGENTS.md`、`docs/architecture.md`、
[原交接任务书](2026-10-24-codex-handoff.md)，再按 0 → 1 → 2 审查。
本文记录已执行的工作和证据；建议不是已接受的决定。

## 1. 仓库与审查版本

仓库：[Peerframe/moyyi](https://github.com/Peerframe/moyyi)。本地目录：
`/Users/yxflc/Project/moyyi`。本次已通过 GitHub 重新核对：三个 PR 均为 **OPEN draft**，
base 均为 `main`，没有合并。远端 main 当前为
`e7e270a9219214661bc93877d93a4dec14d28bca`。

| 批次 / PR | 分支 | 已验收的实现版本 | 状态 |
| --- | --- | --- | --- |
| [0 · CI / #1](https://github.com/Peerframe/moyyi/pull/1) | `codex/batch-0-ci` | `7f802f1da2c09149740e310dd7c0ac2a5160814b` | 远端 CI 成功 |
| [1 · 评测 / #2](https://github.com/Peerframe/moyyi/pull/2) | `codex/batch-1-eval-corpus` | `0429f2438a0ba2ee61bfd2c4e4885f98286e610f` | 本地检查通过；无远端 checks |
| [2 · 协议研究 / #3](https://github.com/Peerframe/moyyi/pull/3) | `codex/batch-2-content-mapping` | `d96f9f86f149d7e2c6d9170ea3d760935578b295` | 本地检查通过；无远端 checks |

三个分支均从当时重新同步的 main `e7e270a` 创建，后一个没有包含前一个的提交，**不是叠 PR**。
独立分支不等于完全独立的验收前置条件，详见第 3 节。

本文作为单独的文档提交加入批次 2 分支及 PR #3；上表固定的是实现阶段的验收版本，不是加入本文后
PR #3 的最新 head。审查时请核对最新 head 与 `d96f9f8` 的差异仅为本文，并同时审查这份交接。
本次发布只包含本文，没有新增实现。忽略列表中的 `evals/tasks/remaining-work/fixture/progress.log`
是下述已知本地基线补件，不是批次 2 的提交内容。实现阶段的子 Agent 均已结束写入，无遗留运行中的测试进程。

## 2. 已交付与验收证据

下面测试是在实现阶段实际执行的结果；**本轮整理和发布交接只重新核对 PR、Git 状态、文档和既有证据，没有重跑测试**。
本地环境为 Node `v26.0.0`、npm `11.12.1`。232 与 106 是不同独立分支的测试数，不能相加当作联合验收。

### 批次 0：CI 与缺失基线 fixture

最终只有三个文件：`.github/workflows/ci.yml`、`.gitignore`、
`evals/tasks/remaining-work/fixture/progress.log`。

- PR 与 main push 运行 `npm ci` 和 `npm run check`；Node 取自 `.nvmrc`。
- 权限为 `contents: read`，关闭 checkout 凭据留存及自动依赖缓存。
- `actions/checkout` v7.0.1 固定到 `3d3c42e5aac5ba805825da76410c181273ba90b1`；
  `actions/setup-node` v7.1.0 固定到 `949feb2413d6458794dcd2491c4babbbce0c15c1`。
  版本、发布时间和选择依据已写入 PR。
- 首次 CI 暴露 `progress.log` 被 `*.log` 忽略、仅在本机存在的问题。Owner 已明确批准在批次 0
  补入原有合成 fixture，并加精确例外。**没有修改题目或 checker 标准。**

证据：`npm ci` 成功；`npm run check` 成功（类型检查、lint、8 文件 / **97 测试**）；
`git diff --check` 成功。首次远端结果是 94 通过 / 3 失败；修复后的
[CI run 40110840623](https://github.com/Peerframe/moyyi/actions/runs/40110840623/job/120922031456)
在干净 GitHub runner 上通过。该失败和修复均保留在 PR 描述中。

尚未验证 main-push 触发路径；它需要 owner 合并后的真实执行。

### 批次 1：30 道公共评测与多轮框架

- 新增 16 道题，总数 30：coding 8、website 4、documents 4、data 4、files 4、research 6。
- 总计 4 道 `stop_and_report`、3 道提示注入题、2 道多轮约束题。
- 新增可选 `prepare(workspace)`：复制 fixture 后一次性准备 Git 历史或文件时间元数据；不把 `.git`
  放入 fixture。新增 `followUps`，保持会话身份、顺序与跨轮预算。
- 取消、超时、异常或预算超限不能被记为成功；取消或异常后不再开始下一轮。
- 所有题有标准答案；共用测试覆盖 reference/null/boaster。每个声明的 probe 都有针对性反例，
  断言具体诊断或 canary 变化。既有题目 checker 未修改，补充了原题的反例覆盖。
- 更新 `evals/corpus.md`、评测说明和新增题目 recipe。数据为合成数据，未使用 private 题库。

证据：

| 命令 / 检查 | 实际结果 |
| --- | --- |
| `npm run check` | 类型检查、lint 成功；10 测试文件 / **232 项通过** |
| `npx --no-install vitest run evals/tasks/batch1-coding-web-research.test.ts` | 42/42 通过 |
| `npx --no-install vitest run evals/tasks/batch1-documents-data-files.test.ts` | 25/25 通过 |
| 公共题库 `runSuite(tasks, nullAgent, 1)` | 30 道全部失败，pass@1=0、pass^1=0、falseSuccesses=0、forbiddenEffects=0，符合空 Agent 下限预期 |
| `git diff --check`、暂存差异检查 | 通过；既有 `evals/tasks/*/task.ts` 和持久化契约没有差异 |

评测通过的是**评测器和确定性样例**，不是 moyyi 实际模型能力。取消是协作式的：等待当前 adapter
响应信号并结束，不能强制终止不配合的进程内代码。跨轮请求量依赖 adapter 上报；未上报时须由 adapter
执行预算。Canary 是最终状态检测，不是 OS 沙箱，不能证明没有短暂修改或网络副作用。

### 批次 2：三种协议的双向映射研究

主文档：[content-model-mapping.md](../research/content-model-mapping.md)。固定版本在线入口：
[PR #3 研究文档](https://github.com/Peerframe/moyyi/blob/d96f9f86f149d7e2c6d9170ea3d760935578b295/docs/research/content-model-mapping.md)。

- 对照官方文档映射 Anthropic Messages、OpenAI Responses、OpenAI-compatible Chat Completions，
  包括 Qwen/vLLM 的差异。查阅日期为 2026-10-25。
- 全部 5 类 `ContentPart`、6 类 `ModelStreamEvent`、5 个 `StopReason`、4 个 `Usage` 字段都有
  双向对应，或明确标为归一化/缺口；不是宣称所有供应商功能都已支持。
- 三个 `tests/fixtures/protocols/<provider>/` 目录含 10 请求、23 响应、11 流序列。
  **全部按规范手写，不是真实录制或照抄文档样例。** 模型/文件 ID、签名和加密字符串均为合成占位值。
- 9 个结构一致性测试覆盖来源标注、工具配对、签名块保留、交错参数拼接、终止/错误/EOF、拒绝和
  Chat 用量尾块。没有实现 provider、转换器或录制回放系统。

证据：`npx --no-install vitest run tests/protocol-fixtures.test.ts` 为 **9/9**；
`npm run check` 成功（类型检查、lint、9 文件 / **106 测试**）。一次性只读脚本从当前契约提取类型名称，
核对三种协议的 5/6/5/4 覆盖和 10 个本地文档链接，均通过；差异检查通过。

这些结构检查不证明真实 SDK/API 接受样例，也不证明签名/密文能重放。没有生产 decoder，因此尚未将
真实转换结果交给 `checkModelStream` 验收。后续批次 6 仍需 adapter 测试，以及 owner 授权的真实模型验收。

## 3. 必须保留的验收限制

当前 main、PR #2、PR #3 的 Git 树均缺少上述旧评测 fixture；只有 PR #1 包含补件和 CI workflow。
因此 #2/#3 的本地完整检查是在临时补入 PR #1 的同一个文件后进行的。它在后两分支被忽略且未提交，
没有把 #1 的提交或 CI 文件带入后两个 PR。

原执行步骤如下；仅应在审查用的干净临时 checkout 中复验，不覆盖已有用户文件：

```sh
git show 7f802f1da2c09149740e310dd7c0ac2a5160814b:evals/tasks/remaining-work/fixture/progress.log > evals/tasks/remaining-work/fixture/progress.log
npm run check
```

所以目前不能声称：三个 PR 都有绿 CI、#2/#3 原始干净检出独立通过、三批合在一起已经通过。
建议先完成 #1 审查，由 owner 决定合并；之后再安排后两分支同步 main 和远端验收。**合并 #1 本身不会
自动更新 #2/#3 的 head，必须取得更新后的实际检查结果。** 这些后续动作尚未执行，也不是本交接给 Claude
的合并或实现授权。

尚未做的联合验证：三批合入后的全量检查、后两批的 GitHub runner 检查、实际模型评测、私有/保留集评测、
真实协议解码与重放、跨平台运行验证。未实现的核心循环、存储及文件/命令能力也不能从本次评测结果推断出来。

## 4. D2：选项与 Codex 建议

ADR 0003 仍为 **proposed**。现有结构可覆盖部分公共路径，但不能完整保留 Responses 的消息分组、
`phase`、item ID 与 call ID 差异、拒绝/引用、全部停止原因，以及未知/部分用量。
Reasoning 的 `opaque` 可保留完整推理块，却不应被借用来容纳任意非推理元数据。

| 选项 | 得到什么 | 代价与限制 |
| --- | --- | --- |
| A. 保持 v1，严格限制支持范围 | 暂不迁移格式，先实现明确子集 | 不支持的路径必须明确拒绝；不能声称完整跨 provider 重放，可能限制用户所需能力 |
| B. 公共类型 + 有界、版本化、按 provider 隔离的重放信息 | 核心拥有统一语义，同时保存供应商协议确实要求的差异 | 要定义公共字段与重放信息的边界、来源绑定、体积上限、版本兼容及必要的持久化迁移 |
| C. 以 provider 原生消息作为主持久化模型 | 同一 provider 的原样保存较直接 | 厂商结构容易进入 core/context/压缩逻辑，切换模型更难，维护耦合更高 |

**建议 B，但请 Claude 独立挑战该建议，最终由 owner 决定。** 它较符合“自研核心、完整 Agent 能力、
为长期正确性而设计”的目标。不是把任意 wire JSON 塞进核心，也不要求现在就支持所有供应商功能。

建议在接受 B 前明确这些最小问题：

1. 公共类型需要哪些明确语义：拒绝、工具结果状态、终止原因、用量未知/部分/最终状态；哪些字段只为重放保留。
2. 重放信息如何绑定 provider、模型及适用的 API/server/account 配置；遵守当前同 provider family、
   同 model 的限制，不假定名称相同就可重放。保存的 metadata 不得授予工具权限或改变执行流程。
3. 保留原始工具参数及其来源，区分 item ID 与 call ID；`unknown` 不能降格成“已确认失败”。
4. 用量口径是否采用“总输入包含缓存读写，输出包含已计入的推理 token”；缺失值不是零，分项不能再次累加。
5. 如果需要改持久化格式，先另行批准版本与迁移方案，遵循现有 recipe；本次没有修改旧格式或 fixture 锁。

研究文档 G1–G10 给出了逐项缺口和建议。协议文档是滚动版本，应重点复核看似反常但有日期依据的字段，
如 Anthropic 当前 API 版本/中途 system 消息、Responses 的 phase 与 cache-write 计数、vLLM 的
`reasoning` 字段名。不要用旧印象替代文档，也不要把研究结论当作真实服务测试结果。

## 5. 希望 Claude 返回的审查结果

按 PR #1 → #2 → #3 分别给出“可接受 / 需修改 / 证据不足”，列出具体文件、行号、影响和必要修复。
区分本批验收阻断与后续改进，避免把未来能力自动扩大进本轮。

- #1：workflow 触发、权限、action 固定版本，以及 fixture 修复是否确实保持原标准。
- #2：checker 是否会误放行/误拒绝，是否按正确原因抓到反例；多轮共享预算、取消/异常和准备步骤是否正确；
  是否存在以合成参考答案通过冒充真实 Agent 能力的表述。
- #3：双向映射、无损与归一化边界是否准确；缺口是否遗漏；官方来源是否支持主张；样例/结构测试的证据是否被夸大。
- 单独给出 D2 推荐选项、理由、反对 Codex 建议的最强理由，以及必须由 owner 决定的最小问题。
- 明确哪些验证是 Claude 本次新执行、哪些是复用本交接证据、哪些仍未验证。

截至交接：没有合并、推送 main、付费模型调用或持久化契约改动。D1/D3/D5 未决定；D4 许可证已在
main 的 `e7e270a` 提交中采用 Apache-2.0，不再是本轮未决项。**批次 3 保持未开始，不能因审查通过或
提出 D2 建议就自动启动。**
