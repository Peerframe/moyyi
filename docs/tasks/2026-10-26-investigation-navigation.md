# 整体计划第一层：调查工具接口

本轮承接[整体计划](https://github.com/Peerframe/moyyi/blob/21f51ee/docs/tasks/2026-10-26-optimization-plan.md)
和[固定上游研究](https://github.com/Peerframe/moyyi/blob/21f51ee/docs/research/2026-10-26-agent-navigation.md)。
计划独立更新 PR #26；产品继续 PR #25，两者都以 main 为基线，未叠 PR 或合并。
本轮零付费调用，不复用此前已耗尽的八次预算。

## 做了什么

实现提交 `520ef829e96a9892a5bcd3c4547f58cfc7da8378`：

- search 接受精确文件或目录，文件不扩大到同目录；遵守真实祖先的 ignore 规则。
- include/exclude 各 1–8 条、每条 1–128 字符，用现有 Node POSIX glob 匹配工作区相对路径。
  只支持文字、`*`、`?` 和整段 `**`，不引入依赖；exclude 优先，不默认隐藏测试。
- files 模式按命中文件去重、计数、整项裁剪，不返回内容窗口；content 默认形状兼容。
- schema 错误能指出安全字段与限制，例如 `/contextLines must be <= 20`；不输出任意值、
  动态字段名或原始解析器诊断，不强制转换、偷偷修补或自动重试。
- 保留全部原权限、撤权、取消、文件/扫描/输出/请求限额；未修改 core、persisted 或默认
  工作指令。Flash + Responses + low 保留。ADR 0025 记录依据、边界与替代方案。
- file conformance 增加五个真实 runtime/SQLite/文件系统场景，并加入 CI。原八个场景和
  其他题目的 checker 全部保留；脚本模型的修正流程不记成模型理解能力。

## 验收证据（命令和结果）

- 最终默认 `npm run check`：typecheck、lint 246 文件、85 测试文件 **1929/1929** 通过。
- `npm run eval:files`：**13/13**；验证实际范围、精确原文/行号、文件发现、裁剪、错误到达
  下一请求、schema 拒绝前零 prepare/工作区 capability，以及修正后真实搜索成功。
- `npm run eval:instructions`：**31/31**；`npm run eval:deepseek`：**18/18**，均为离线机制证据。
- focused runtime 125 项、plugin/validation 92 项通过；实际 open 记录确认被过滤文件和精确
  范围的 sibling 未读取内容。独立源码审查无阻断，`git diff --check`、10 项本地文档链接通过。
- 第一次全套为 1927/1929：新增重复说明导致原 CLI 10,000 上下文 fixture 超容量；通过精简
  工具说明修复，所有 schema 和容量限制保持不变。另一项是既有 watcher 三秒未通知；定向
  10/10 通过。CLI 定向 7/7、最终默认全套均通过，没有改测试断言或超时。
- `npm run verify:package -- --offline`：干净实现提交构建通过，CLI 10/client 10/PTY 5、
  严格安装类型及负例、依赖树和卸载通过。238 文件，SHA256
  `64132cf08b3227ea4cc0988ef98cbb48091a69ae89ae318e41f31bdfd7df436a`。
- [实现 CI](https://github.com/Peerframe/moyyi/actions/runs/40253808999)：全部通过，包括新增 file conformance。
- 本机已安装同一干净包：238 文件逐字节匹配，数据/配置先备份；两个启动器与 host/manage
  字节保持不变。实际 CLI 版本、metadata-only 配置检查及生产依赖树通过，零 Key 值读取和 API 请求。
- 安装版再次执行相同五个导航场景：**5/5**，所有 imports 指向已安装 dist；原断言不改，
  精确结果、受限请求、错误拒绝和内容保护通过，网络请求 0。

## 没做完的／尚未验证

已关闭的是四类工具接口缺口。没有用新版本做真实多题测试，也没有证明原题六项已通过；
旧失败记录继续有效。已取得源码后的事实理解问题没有被这次离线成功掩盖。
后续按整体计划固定任务、版本和总预算后测量，不加次数、不改 checker；编辑、长会话与
联网成果是之后独立的验收范围。没有公开发布或引入 LSP、关系图、额外模型/Agent。

## 需要 owner 决定的

没有新增决定或预算申请。PR #25/#26 保持未合并；第一层离线交付与后续真实模型质量分开。
