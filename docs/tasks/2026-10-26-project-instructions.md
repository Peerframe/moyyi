# 默认工作指令与项目规则交付

日期：2026-10-26。基线：已合并并安装的 `main@87a239f`（PR #19）。
分支：`codex/project-instructions`；目标：一个到 main 的独立 PR。

## 范围与结果

Owner 在基础真实只读验收通过后授权“继续”。本轮交付两项原生 context-source 插件：

- moyyi 自己编写的默认工作指令：查证、执行授权任务、保留无关改动、按证据验收与汇报。
- 工作区根目录 `AGENTS.md` 自动读取：每个模型请求刷新，相对来源、作用域与哈希进入实际请求，
  并由现有 request blob 留存；修改、删除、重启、压缩后的行为可检查。

只自动读取 root AGENTS.md；子目录规则由普通工具按目标路径显式读取，不递归全仓、不读取 home
或父工作区，不自动解释别名、链接和 imports。16 KiB 完整 UTF-8 上限，不接受符号链接或硬链接，
不截断规则后假装成功。`projectInstructions: false` 可以关闭自动读取。

新增非持久化 `beforeContextRead` 授权方法；现有只读 grant、读取审批和插件的收紧规则继续适用。
自定义策略未实现新授权方法则不自动读取；不伪造 effect、digest 或批准。取消、撤权、生命周期和
安全错误信息由 runtime 保证；规则文字不能开放写入、命令或网络。

决策、一手来源、兼容性和取舍见 [ADR 0017](../decisions/0017-working-and-project-instructions.md)，
用户说明见 [instructions.md](../instructions.md)。没有复制 OpenBot 或第三方实现，没有新增依赖。

## 验收

本机执行结果（Node 26，全部离线）：

- `npm run check`：typecheck、Biome 215 文件、**1,579 / 1,579 测试（72 文件）**通过，使用未修改的默认并发命令。
- `npm run eval:instructions`：**26 / 26** 场景通过，网络请求为 0。
- `npm run verify:package -- --offline`：**10 CLI、9 客户端、5 PTY、严格安装类型及卸载**通过。
  新增一个安装后 root AGENTS 更新场景，原有检查不变；215 个包文件，隔离安装未替换本机版本。
  该本机验收针对提交前工作树（receipt 明确标记 dirty），没有冒称来自旧 main 的干净构建。
  CI 会在实际 PR 提交上重新构建并执行同一验收。
- `git diff --check` 与 9 份变更文档本地链接检查通过；persisted v1、分层检查和公共 checker 无 diff。
- 一手资料定向研究和独立代码复核完成，未发现阻断；未复制上游代码。

PR CI 结果以 PR 页面对应 head 的检查为准；本地证据不冒充远端通过。

离线场景使用实际 runtime、SQLite、临时文件和 scripted model，检查真实 request/blob、规则刷新、
root-only 作用域、deny/ask、恶意规则不能授权写入、取消、文件边界、录制重放、压缩与总预算。
它们是接线/权限证据，不是 DeepSeek 理解规则的能力得分。原 30 题和 checker 均保持不变。

## 未做与边界

- 不做付费模型调用，不读取真实 API Key，不更新本机已安装版本，不自动合并、不正式发布。
- 不改 `src/contracts/persisted`、分层检查、公共题判分与 D1–D6。
- 不做 nested/JIT 自动规则加载、Skills、OpenBot 能力迁入、MCP 或训练模型。
- 新默认提示改变请求身份；旧录制仅能在原版本/原上下文重放，不自动迁移或放宽精确匹配。
- 真实模型遵循程度和日常项目任务未验证；需后续单独有界授权。

当前没有新增需要 owner 选择的架构事项。PR 的合并与本机安装仍等待下一步授权。
