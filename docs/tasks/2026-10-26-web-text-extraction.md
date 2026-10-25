# 网页正文提取交付

2026-10-26。基线 PR #20；分支 `codex/web-text-extraction`。属于 owner 授权连续完成的
基础能力检查点；按独立 PR、审查无阻断且 CI 通过后合并并安装。仍不做付费调用和正式发布。

## 做了什么

`web_fetch` 把 HTML 转成有标题和段落的纯文本；保留来源、状态、内容类型与截断标记。
使用固定版本 htmlparser2 的流式解析器，限制输入、深度、节点/事件、子项与 UTF-8 输出，
不执行脚本、不跟随资源、不回退原始 HTML。不改变搜索、JSON/文本、网络权限、审批和重试规则。

OpenBot 贡献的是正文去噪与资源边界的测试经验，在 moyyi 新契约下独立重写。没有移入旧控制面、
Python/BeautifulSoup 进程或业务数据。来源与版本见 [ADR 0020](../decisions/0020-bounded-html-text.md)
和 [provenance](../openbot-provenance.md)。

## 验收证据

- `npm run check`：typecheck、Biome 217 文件、1605/1605 测试（73 文件）通过；默认并发未改。
- `npm run eval:web`：9/9 离线实际 runtime/SQLite 场景通过。保留原有 7 个判据，增加正文与深度拒绝；
  检查一次发送、持久化顺序、来源、权限与重启不重放。
- `npm run verify:package -- --offline`：隔离安装 CLI 10、client 9、PTY 5、严格类型与卸载通过；
  提交前 dirty 工作树构建，未冒称干净 main，最终安装另从已验收合并提交构建。
- `git diff --check` 与本地链接检查通过。
- 单元测试覆盖 Unicode 截断、标题/表格/代码、隐藏内容、畸形标签、原文攻击、媒体类型与上游截断。
- `src/contracts/persisted`、公共 30 题判分及分层规则不变。

本机证据不冒充远端 CI；PR 对应提交的 CI 需另行通过。完整安装包与最终安装验收由连续交付检查点
记录。没有读取真实 API Key 或调用模型。

## 尚未验证与决定

没有真实模型网页任务质量得分；SearXNG 和本机实际公网路由验收仍受既有条件限制。
本功能不是浏览器、CSS 可见性计算、文章排名或提示注入过滤器。普通恶意正文仍作为不可信数据。
没有需要 owner 新决定的事项；核心、权限和已定 D1–D6 不变。

## 与 Skills、runtime 评测组合后的验收

当前基线为 PR #22 合并后的 `main@95637f25c739ddfdfad8368c8f1c24984677f07e`。
依赖清单/lock 保留 htmlparser2 12.0.0 和 yaml 2.9.1；来源记录保留 Skills 改编声明/MIT
notice 与网页提取独立重写记录。独立复核 `git range-diff`：产品实现与已审版本一致。

- `npm ci --offline --ignore-scripts --no-audit --no-fund`：55 packages，通过。
- `npm run check -- -- --maxWorkers=4`：typecheck、lint、80 文件 **1730/1730** 测试通过。
  本机并发设置用于避免此前已记录的录制枚举/watcher时序失败；CI继续使用原默认命令，
  没有改断言、超时、题目、判分或检查标准。
- `npm run eval:web`：9/9；`npm run eval:skills`：31/31，通过。全部离线。
- `git diff --check`、本地链接、合并依赖和所有 CI gate 的独立审查通过。

## 本轮连续交付的检查点

Owner 已明确授权：审查无阻断且 CI 通过后逐个合并，并更新本机；付费调用和正式发布不包含在内。

| 项目 | 当前结果 |
|---|---|
| PR #20 项目指令 | 已合并、main CI通过并安装；根 AGENTS.md 实际安装版离线验收通过 |
| PR #21 runtime 任务评测 | 已合并、main CI通过并安装；现有公共题可使用真实 runtime，无真实模型成绩 |
| PR #22 显式 Skills | 已审查、PR CI通过并合并；包构建验收通过，合并后CI/本机更新由主控执行 |
| 本 PR 网页正文提取 | 实现与独立审查完成；等待本PR对应提交CI，之后按授权合并、安装及组合验收 |

剩余主要是实际项目任务质量、同模型基线/成本测量、真实网页/SearXNG与更长期稳定性验证。
这些不能用合成脚本成绩代替；需要后续具体使用范围和真实模型预算。Skills 目录发现/引用资源、
GUI、MCP、多Agent、训练、正式发布不属于本检查点，未开始。所有原有数据、配置与会话需保留。
