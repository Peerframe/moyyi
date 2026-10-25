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
