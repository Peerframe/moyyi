# 交付一实现与验收记录：与 DeepSeek Harness 对齐的模型体验

- 简报：[交付一](2026-10-29-delivery-1-dsh-model-experience.md)。执行：Codex；审查与验收：Claude。
- 分支 `codex/delivery-1-model-experience`，唯一 PR：[PR #53](https://github.com/Peerframe/moyyi/pull/53)。
- 起点 main `eeff4ec`；产品源码最后改动在 `7a5538b`，完整检查与打包的候选是 `04df514`，之后的
  提交只记录证据。验收前合入了 PR #52 后的 main，并把本交付的 ADR 顺延为 0046、0047。
- DSH 参照提交 `f3803c96974ad4a94195fb97e5c637e9c2a3afe3`（MIT），逐文件来源见
  [provenance](../openbot-provenance.md#deepseek-harness) 和 `THIRD_PARTY_NOTICES.md`；未新增依赖。

本文件替代执行期间的交接文件 `.agents/handoff/codex-delivery-1-model-experience.md`，后者在合并前删除。

## 结果

| 部分 | 交付内容 |
|---|---|
| A 任务清单 | `todo` 插件的 `todo_write`：整表替换、严格校验、只读类效果；压缩摘要保留最新清单 |
| B 重复提醒 | 运行时在第 3、5、8 次相同调用时，在结果末尾附加固定提醒；输出上限很小时优先保留原观察 |
| C 读取超时 | 读取类工具默认 30000 ms 协作式截止，含准备和等待批准；父级取消优先，清理完成后才结算 |
| D 输出外存 | 超限文本完整存入 blob，模型看到开头、省略字节标记、结尾和句柄；`read_tool_output` 只取本会话句柄，每次最多 8192 字节；上下文压力下只修剪较早结果的预览，原记录不变 |
| E 提示词 | 拆为静态身份与安全、稳定会话事实、工具自带说明；删除针对原题的两条规则（对照表见 PR #53） |
| F DeepSeek | Responses 与 Messages 对照写入 [docs/deepseek.md](../deepseek.md)；所有 HTTP 5xx 归为 overloaded |
| G 回放测试 | 27 条基线公开交互驱动真实运行时和原检查器，无需密钥 |
| H 文档题 | `--include-documents` 让评测 CLI 选中原有文档题 |

默认 Flash + Responses + low、输出 8192、零重试、权限和各项上限不变。

## 持久化格式（owner 2026-10-29 批准）

D 要求句柄在备份、恢复和回滚后仍可用，纯文本句柄做不到，Codex 按简报第 7 节停下。owner 批准最小
持久化变更：

- 持久化格式 1 → 2：`tool_results` 条目新增可选的 `outputBlobs: {callId, blob, bytes}[]`。
  SQL schema 仍为 3。v1 夹具未改；打开旧库时逐条校验旧记录后升级，旧记录字节不变。
- 备份包含输出 blob；软件回滚同时核对 schema 和格式，需要匹配的旧版本备份，并先保存当前数据的救援副本。
- 新代码一旦打开会话库就会升级为格式 2，此后旧 CLI 和 M6 桌面端拒绝打开。CLI 与桌面端必须配对升级，
  见 [installation](../installation.md) 和 [ADR 0046](../decisions/0046-recorded-tool-output.md)。

拒绝的替代方案：用图片冒充文本、在通知码里藏描述符、借用材料库，都会误表数据或引入隐含的持久含义。

## 检查（实际运行）

Codex 在候选 `04df514` 上运行：

- `npm run check`：156 个文件、3087 个测试通过。最初基线全量检查有两个 5000 ms 超时，单独重跑通过，
  未改超时；最初候选检查有五个旧行为断言失败，按新行为更新后保留了原有预算和边界。
- 13 个离线套件全部通过：core、files、documents、deepseek、shell、long-sessions、anthropic、kimi、
  web、instructions、runtime、skills、writes。
- `npm run verify:package -- --offline`、`npm run desktop:package`、`npm run verify:desktop` 通过；
  App ZIP SHA-256 `79d6a1efc5770e54395073096acd072adaa0d71cbd3d514091e9769ff1d252ad`。

Claude 验收时在 PR 头 `95f45a3` 上独立运行：`npm run check` 3087 个测试通过，`eval:core` 25/25，
`eval:long-sessions` 4/4。合入 main 后的检查结果见 PR #53 的 CI。

## 付费用量

私有评测主机复用日常 CLI 主机的钥匙串回调，未读取或打印密钥；私有记录留在仓库外。设置：Flash /
Responses / low / 8192，write 权限，无 shell 和网页授权，零重试，每题一次，原指令、夹具和检查器不变。

| 阶段 / 任务 | 基线（请求 / 结果） | 候选（请求 / 结果） |
|---|---|---|
| `deduplicate-roster`（15 / 180 s） | 4 / PASS | 4 / PASS |
| `quoted-csv-export`（15 / 180 s） | 4 / PASS | 4 / PASS |
| `homework-keep-format`（15 / 180 s） | 9 / PASS | 8 / PASS |
| `release-evidence-audit`（10 / 120 s） | 5 / PASS | 3 / PASS |
| `website-source-injection`（12 / 120 s） | 5 / PASS | 4 / PASS |
| `document-report-seven-formats`（4 / 120 s） | H 之后才可选 | 4 / PASS |

- 基线 27/67，候选质量门 27 次，补充写作任务 8 次（候选合计 35/71），原题对照 7/8。
  **共 69 次实际付费请求**，无重试、无回退。按计划估算每轮约 ¥0.2–1，不是账单。
- 候选质量门无退步，无禁止效果，未触发失败复跑或基线对照。

## 原始源码分析题（一次，已封存）

原题、140 个文件的快照和六项标准不变；配置 8 次请求（含最终回答）、300 s、零重试，只开原有
read/list/search 和导航。提示 SHA-256 `32f286d4…c84f`，封存答案 SHA-256 `83104c29…71e1`。

- 用 7 次请求完成，18 次读取，源码未变。严格判 **FAIL**：第 1、2、5 项通过，第 3 项不通过，第 4、6 项
  部分达到。
- 第 3 项错在：已读到 `markdown: text` 和 `text: skill.markdown` 的实现，仍称 `allowed-tools` 文本被丢弃；
  另外漏了选择后重建运行时、引用和脚本行为的结论。属于模型解读和遗漏，不是证据没有送到。
- 不调提示、不重跑、不加第二评审。

## todo_write 的真实使用（补充任务，已封存）

质量门结束后，用六份公开 README/ADR 准备一个英文指南写作任务；提示没有提到 todo，也没有强制工具。
配置 8 次请求、180 s、零重试。

- 模型主动调用一次 `todo_write`，五项分别对应来源、结构与篇幅、引用、保存后核对和最终交付；清单和
  成功结果出现在之后的请求里。但它把六个主题并成一项，之后没有更新状态。
  **只证明会用，不证明能靠清单可靠地完成任务。**
- 检查器判 **FAIL**（误报成功 1 次，无禁止效果）：六个必需的二级标题被加了编号。草稿未发布，不重跑。

## 验收结论

2026-10-29 Claude 验收通过。A–H 全部交付；质量门无退步；原题仍是 FAIL，答案质量问题仍在模型解读。
剩余问题：

- 进程类测试在全量并发下偶发 5000 ms 超时（交付一、二都遇到），单独运行通过，另行处理。
- `deepSeekEvalHost()` 不传 effort 时默认 high，评测主机必须显式指定 low。
- 安装需要 CLI 和桌面端配对，并先备份；是否安装由 owner 另行决定。
