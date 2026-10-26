# 整体计划第二步：固定多题验收

本轮承接[调查工具接口交付](2026-10-26-investigation-navigation.md)和
[已固定的整体计划](https://github.com/Peerframe/moyyi/blob/c16ac674de72f66fdd91cfc5380a69f61941c189/docs/tasks/2026-10-26-optimization-plan.md)。
Owner 授权固定多题、真实请求总共最多 8 次，保持 Flash + Responses + low，预算直接使用。
原题和验收标准不变；按分支和 PR 交付、更新本机，不公开发布。

**本次两题均未通过完整验收。** 原题存在证据链缺失和明确事实错误；公共题的事实内容正确，
但没有创建要求的文件。工具接口已可用、运行正常结束，与任务完成是不同的结果。本轮没有
继续改提示词或核心循环；实际修复仅针对独立发现的 eval host 推理档位接线缺口。

## 预先固定的任务、版本与预算

执行前固定两题，各最多 4 次请求，顺序为原项目题、公共数据流题；没有看结果换题、转移
剩余额度或追加请求。两题都让 Agent 自主定位和读取，没有预先给齐源码、标准答案或隐藏
判分清单。公共题具备创建 `report.json` 的权限，其他写入、运行代码与网络工具均拒绝；
原题只允许 `read`、`list`、`search`。

| 固定项 | 本次取值 |
|---|---|
| 实际安装产品 | `520ef829e96a9892a5bcd3c4547f58cfc7da8378`，第一步已验收的导航工具版本 |
| 工作分支基线 | `codex/evidence-grounding`，`8b74bede3bcfa18e91ce4b8c61f67001fb6ba31d`；继续 PR #25 |
| 原题源码 | `1838248a1b6998c741105ab8b8fd7c06a1d04b41` 的固定只读快照，与此前同题保持一致 |
| 公共题 | [source-dataflow-report](../../evals/tasks/source-dataflow-report/task.ts)，原 fixture、instruction、checker 及保护文件要求不变 |
| 模型与接口 | `deepseek-flash`，Responses，`reasoning.effort: low` |
| 请求预算 | 总计 8，每题 4，`maxRetries: 0`；每题最后一次强制 `tool_choice: none` |
| 其他上限 | 单次请求体 512 KiB、累计 1 MiB、单次最大输出 8192 tokens，保留原权限和资源边界 |

**这不是与历史每题 8 次的等预算对照。** 原题 prompt 中原有的 8 次文字没有改动，但本轮
外层实际限制和逐轮预算提示明确为 4 次；公共题原 task budget 也仍为 8，本次执行受更紧的
4 次上限约束。此安排在调用前固定，以总共 8 次覆盖两道题；不能据此声称新旧版本质量提升、
退步或达到原完整任务的稳定成功率，也不能把更紧预算当作降低判分标准的理由。

用于复核的固定 SHA-256（目录快照为排序后的相对路径与文件哈希清单）：

| 对象 | SHA-256 |
|---|---|
| 本轮冻结计划 | `7b64e8828118c446ed58d7a7c305ad591905e59d6ce886ef491686c38cb06202` |
| 原题 instruction | `32f286d4037f45f351d9315b2ec2369bdf159f72e63df35430c0a322f9f8c86f` |
| 原题六项 rubric | `00f4c0f978be38f798046be03c5a1f695fdaa09cd402f11fa9af9e64c8869e31` |
| 原题源码快照 | `ab23ab5b1d1e481a914e98c9f0ccb017a35495aaaef8ae4462dc75bbd83a1a76` |
| 公共题 instruction | `d99e78f68cc5903730c42a70a372f92c26d94064e6ad27be1ea6a1d814cbe2d4` |
| 公共题 fixture | `e5a0d0b6e9d9c81ee12706f068a4a85573d8fdfd8bcfac9577832d230db223ca` |
| 公共题 task/checker 文件 | `fc03dfa808cebaaabce90d3b8f1dd526e20853a7e67aa58804f4912c5d7e97dc` |
| [checker helpers](../../evals/harness/checks.ts) | `240caf069e39586f7eac88468546877103a1abdd3c7cacdb4834be8b8e08a436` |

完整问答、模型请求和私人评审清单保留在本机，不提交入库；本记录只保留可审查的结论与标识。

## 离线前置与实际执行

真实执行前，私有 `node --test gate.test.mjs trial-gate.test.mjs` 共 18 项预算检查通过，
包括共用总额、每题独立限额、最后一轮禁用工具、第 9 次拒绝、字节边界、错误不重试和封存。
私有 `run.mjs --preflight` 使用已安装 runtime、真实临时文件和 SQLite，两题各 4 次脚本响应，
验证 low 的实际 wire、工具结果进入请求、禁止写入被拒绝、源文件不变；公共题脚本产物通过
原 checker。网络请求 0、真实凭据读取 0。这只证明接线和验收机制，不是模型质量通过。

一次 live 前的计划序列化断言发现 `undefined` 字段在 JSON 保存后消失；该次在预算预留、
凭据读取和 HTTP 之前停止，实际请求 0。删除无意义字段并增加 JSON 往返一致性检查后，
重新通过离线前置，才执行下述唯一一次 live 批次。它不属于模型请求重试。

随后本次真实批次共 **8/8 次 HTTP 200、自动重试 0**，每题 4 次，全部使用 Flash / Responses /
low。两题最后一次均为 `none`，以 `end_turn` 正常结束；累计请求体 168,920 字节，未触及
既有字节上限。两份源快照均未改变，账本已封存，剩余请求 0；没有第 9 次请求。

`core.completed` 只表示运行循环正常结束，不是任务验收成功；本次没有把它当作通过条件。
本次使用现有安装 runtime 的显式 low 配置，所有 wire 均已核实，未依赖下述 eval helper 修复。

## 原项目题：六项标准逐项结果

原题实际完成 9 次只读工具调用；4 个实现文件被读取，返回内容与固定源码一致。
其中 `src/runtime/instructions.ts` 被截断，Agent 没有补读；core/context 的最终消费者链及
`src/runtime/files.ts` 未读取。读取数量及工具成功不能代替下面的内容判定。

| 保留的原标准 | 本次判定与依据 |
|---|---|
| host 明确选择、默认不加载/扫描、启动复制冻结 | 部分：host 选择与复制冻结解释正确；没有完整核实 `createRuntime` 的调用和默认行为。 |
| runtime 选择、受限读取、skills.collect、core/context 最终消费者链；至少三个实现文件实际读取 | 未完成：文件数量满足，但终点的收集、渲染和模型请求接线未读；答复也承认该缺口。 |
| `allowed-tools` 校验后保留于原文，不注册工具、不改变授权 | 不满足：不授予权限的结论正确，却明确把没有独立解析属性误认为原文中的值已丢弃。 |
| 下一请求重读原文/hash；选择列表改变需重建 runtime | 未完成：解释了收集内缓存和读取/hash，但每请求调用方未核实，未明确说明改变选择列表需重建 runtime；还出现下述读取竞态错误。 |
| 删除/非法/超限请求前失败，与 deny/ask/缺 hook 的 blocked notice 区分 | 部分：两种结果区分正确，但请求前停止的最终 core 传播仍靠文档和推断，未完成代码核实。 |
| 12 KiB 完整文件、48 KiB 接受文本合计、不截断、不自动加载引用或执行脚本 | 部分：大小与不截断正确；附属资源和脚本范围未完整解释，文件读取实现未核实。 |

至少两个错误可由固定源码直接确定，不只是“还没找到证据”：

1. [parseSkill](../../src/plugins/skills/parse.ts) 返回 `markdown: text`，
   [skills collect](../../src/plugins/skills/index.ts) 发送 `text: skill.markdown`。
   因此 `allowed-tools` 虽没有独立返回属性，仍在完整原文中发送；它不因此具有授权能力。
   相关两文件原文已进入模型请求，不能再只归因为检索遗漏。
2. 答复未读 [文件读取实现](../../src/runtime/files.ts)，却断言读取后只复查策略、没有 mtime
   检查。固定源码的 `readFile` 实际比较读取前后的文件身份、size、mtimeMs、ctimeMs，
   `readSkillDocument` 还复查文件和父目录。否认这些检查是错误；这里也不把元数据复查
   说成“二次内容哈希”或完整抵御所有竞态的保证。

答复如实区分了读测试与运行测试，没有把未执行的检查说成已通过。最终仍判 **原题失败**，
不因错误声明之外的正确部分、正常结束或读取数量而放宽六项标准。

## 公共数据流题：事实正确，但交付未完成

原 [checker](../../evals/tasks/source-dataflow-report/task.ts) 的实际结果为 **失败**：
`report.json is missing or invalid`。Agent 没有尝试写文件，最终说明工具已禁用，并将拟议
JSON 放在答复里；没有虚称文件已存在。

实际动作顺序是：第一轮列根目录并读 `card.json`；第二轮列 `src`；第三轮批量读三个源码
文件；第四轮工具禁用后回答。到第四次请求时，四个输入文件的完整原文均已精确送达且未
截断；原文保留与重建删除两条路径、授权与数据传递的区别都解释正确。

为隔离理解与交付，评审只将最终答复中唯一 JSON 块放入**另一个临时诊断副本**，调用未改
动的 checker。两条路径各五项加 authority 共 11 项事实全部符合，保护源文件检查也通过。
这份 answer-projection 诊断没有修改实际任务工作区、原答复、原判分或封存账本；它不构成
Agent 创建文件，也不把实际失败改为成功。

轨迹证明本次四轮中，目录发现和读取用完了可调用工具的三个回合，随后无法完成文件交付。
现有搜索和批量读取仍可能缩短发现路径；单次结果不足以认定工具接口缺失、原 8 次预算一定
足够，或增加提示词就能解决。保留最后一轮 `none` 及全部原标准，不强行允许收尾写入。

记录层另有一处解释修正：私有汇总字段 `actualImplementationReads` 仅筛选 `src/` 下的
`.ts` 文件，公共题三个实际读取的 `.mjs` 因而被记为 `[]`。逐工具证据和请求原文证明三文件
均完整送达。此处明确纠正指标含义，不把空数组解释为未读实现，也不改写封存的原始账本。

## 本轮实施与验收证据

唯一代码改动位于 [eval DeepSeek host](../../evals/agents/deepseek.ts)：允许显式配置
`reasoningEffort`，在创建 host 时校验并固定档位，将其传到 provider client，返回可记录的
effort/API profile。未指定时仍保持原 `high` 默认；没有把默认静默改成 low。
[使用说明](../runtime-evaluation.md)同步给出显式 low 配置。

此前 helper 自行创建 client，无法接收交互 runtime 的 low 设置。这个确切接线缺口值得
修复，但它**不是本次两题失败的原因**：本次真实调用已经逐请求确认 low。helper 属于源码
仓库的 eval 入口，不包含在日常安装包中；不能声称它改善了已安装 Agent 的事实正确率。

- `npx vitest run evals/agents/deepseek.test.ts evals/agents/moyyi.test.ts`：18/18 通过。
  [新增离线测试](../../evals/agents/deepseek.test.ts)核对四档实际 Responses 请求、兼容默认值、
  profile 绑定、配置冻结、非法值早拒绝、惰性凭据、单次失败不重试，以及实际 runtime 接线。
- `npm run typecheck`、改动文件 Biome 与 `git diff --check`：通过。
- `npm run check`：主控本轮执行通过，typecheck、Biome 247 文件、86 个测试文件
  **1941/1941**，耗时 45.94 秒。
- `npm run eval:runtime`：主控本轮执行 **10/10**，脚本模型、真实 runtime/文件系统；
  没有新增真实模型请求。
- PR CI 及本机核对随最终交付记录在 [PR #25](https://github.com/Peerframe/moyyi/pull/25)；
  本次源码修复不进入运行包，安装版本及实际真实验收产品版本分别记录，不冒充安装升级。

没有修改原题、公共 fixture/checker、core、persisted、默认工作指令或权限边界。没有足够
证据支持继续给本题增加提示规则、扩充工具/关系图或撤销最终收尾保护。

## 未验证与下一有界检查点

第二步已形成可复核的固定多题结果，并区分证据覆盖、事实解释和产物交付；它没有达到
“多数真实任务可靠完成”的结论。原题仍缺完整调用链和配置生命周期的正确核实；公共题仍缺
Agent 实际交付文件。只有每题一次观察，未验证稳定性、同预算新旧差异或任何新产品修复
对成功率的作用。原有 [source-lifecycle-report](../../evals/tasks/source-lifecycle-report/task.ts)
本次没有真实调用，不得计入已测任务。编辑、长会话与联网成果仍属于整体计划下一层。

本轮下一检查点是完成所列离线总检查、PR/CI 与本机核对后交付，不再使用已耗尽预算。
后续质量试验应先固定要隔离的具体疑问和相同预算：原题重点是已见原文后的错误否定结论，
公共题重点是发现、读取、写入和确认的动作顺序；复用既有正反任务，不看答案换题或替换
判分对象。任何候选改动都需能复现其解决的失败，并保持最终文件验收；给齐源码或答案投影
只能作诊断。新的真实试验须有独立明确的总预算，本次账本不复用。没有公开发布。
