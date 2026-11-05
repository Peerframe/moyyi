# DeepSeek Harness 第二轮对照（2026-11-05）

- 参照：`deepseek-ai/deepseek-harness`，提交 `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`
  （2026-11-04）。方法按 [moyyi-learn-from-dsh](../../.agents/skills/moyyi-learn-from-dsh/SKILL.md)：
  读每个候选包 README 的用途、模型体验和已知限制；本轮没有读或复制任何源码。
- 对照对象：`main`，含已合并的 #59、#60（Chat 界面）和 #66。
- 编写：Claude。用途：给主人挑选下一批交付；每批开工前再写正式简报。

## 1. 已经有的，不再重复

| DSH 包 | moyyi 对应 | 说明 |
|---|---|---|
| `guard/repeat-tool-reminder` | `src/runtime/tool-results.ts` 重复调用提醒 | 交付一已对齐 |
| `compaction/compaction-tool-result-pruner`、`spill/*` | 旧工具输出预览缩短、`read_tool_output` | 原文都能取回 |
| `compaction/compaction-basic`、`command-compact` | 自动压缩（ADR 0049）、`/compact` | |
| `todo/tool-todo` | `todo_write` | |
| `subagent/subagent-spawn-in-process`、`tool-subagent` | 只读子 agent（ADR 0051） | moyyi 子 agent 只能读 |
| `mcp/mcp-client` | MCP 工具（ADR 0050） | MCP 资源读取（`mcp-resources`）未做 |
| `jobs/tool-jobs`、`shell/tool-bash` 后台命令 | `shell_output`、`shell_stop` | |
| `plan/plan-mode` | 计划模式（ADR 0054） | DSH 只靠提示、工具照常可用；moyyi 真正拒绝修改，更严格 |
| `fs/tool-fs-search` 的 `grep` | 正则搜索（ADR 0055） | DSH 打包 ripgrep；moyyi 用受限线程 |
| `context/agent-instructions` 的嵌套部分 | 子目录 AGENTS.md（ADR 0052） | 文件名和全局文件见第 2 节第 2 项 |
| `web/*`、`skill/*` | `web_fetch`、`web_search`、Skills | |

## 2. 候选，按建议优先级

### P1：小、离线可测、收益直接

1. **`edit` 全部替换与一次多处修改**
   - DSH：`fs/tool-fs` 的 `edit` 有 `replace_all`；`fs/fs-patch` 支持 Codex 风格的多文件补丁。
   - moyyi 现状：`edit` 每次只能替换唯一的一处，改名或批量修改要多次调用。预算按请求次数算，这很费请求。
   - 决定：采用 `replaceAll`；借鉴"多处修改"，但用 moyyi 自己的 `edits` 数组（同一文件，全部成功或全部不改，一个效果、一次审批、一个快照）；不采用补丁格式（模型要学新格式，审批预览也难读）。
   - 落点：fs 插件、`src/runtime/files/writes.ts`、写入预览、`eval:writes` 新场景。模型可见改动，需要离线评测证据和工具目录更新。
2. **指令文件兼容**
   - DSH：`context/agent-instructions` 读用户全局 `~/.dsh/AGENTS.md`，项目链里 `AGENTS.md` 和 `CLAUDE.md` 都是候选，另有 `*.local.md` 本地覆盖。
   - moyyi 现状：只读工作区根目录的 `AGENTS.md`（加嵌套）。只有 `CLAUDE.md` 的仓库拿不到任何项目说明。
   - 决定：采用"根目录没有 `AGENTS.md` 时读 `CLAUDE.md`"，规则（读取授权、大小上限、不跟随链接）不变。用户全局文件见第 4 节，需要主人拍板。
3. **时间上下文**
   - DSH：`context/time-context` 在请求末尾追加当前时间、时区和距上一条消息的间隔，只追加、不改前缀，不影响缓存。
   - moyyi 现状：模型不知道今天的日期，"最新""本周"之类的说法只能猜。
   - 决定：借鉴。每次运行开始时加一条 turn 级上下文（当前时间和时区），记录在请求里可复现；不做每一步刷新。
4. **每轮改动汇总**
   - DSH：`deliverables/workspace-changes` 在每轮结束列出改过的文件和行数，并能看前后对比。
   - moyyi 现状：效果记录里有每次修改和快照，但没有"这一轮改了哪些文件"的汇总。
   - 决定：借鉴，直接从效果记录生成，不依赖 git。CLI 在运行结束时打印；Chat 在回答下方显示，点开进"成果与记录"。
5. **用量统计**
   - DSH：`experimental/client-ui-stats`、`llm/token-meter` 显示每步的上下文大小、缓存命中率、首字延迟。
   - moyyi 现状：CLI 用量行有缓存命中 token；桌面没有。
   - 决定：借鉴，在 Chat 的"预算"页和每轮结束提示里显示本轮请求数、token 和缓存命中。只显示服务商实际报告的数字，没报告就写"未报告"。

### P2：中等，需要 ADR，部分需要主人拍板

6. **向用户提问的工具 `ask_user_question`**
   - DSH：`interaction/tool-ask-user`。模型给出一到多个问题和选项，推荐项放第一个并标"（推荐）"，然后等待回答；没有人能回答时返回错误；子 agent 不能调用。
   - moyyi 现状：没有。模型遇到需要主人决定的事只能猜，或者停下来结束本轮。Chat 界面本来就设计了"选项消息""你选了……"，正好可以直接用。
   - 决定：采用阻塞模式，不做定时模式。核心要加"等待主人回答"的状态，和审批共用同一套等待、取消、中断恢复的保证，需要新 ADR。CLI 用编号选择；桌面用 Chat 的选项消息。
7. **可拦截的钩子（兼容 Claude Code `hooks.json` 的子集）**
   - DSH：`experimental/hook-protocol`。钩子退出码 2 可拦截提示或工具调用，原因给模型看；还能附加上下文；请求停止这一项 DSH 自己也没实现。
   - moyyi 现状：ADR 0053 规定钩子只观察，输出不进模型。
   - 决定：借鉴，分两步：
     - (a) 工具调用前的钩子只能拒绝，相当于主人加的一层更严格的规则，不放宽任何权限；
     - (b) 附加上下文（工具完成后、用户发消息时）会让钩子输出进入模型请求，需要主人拍板。
   - "改完文件自动跑检查（类型检查、测试），把结果交给模型"就是 (b) 的一个用法，不再单独做一套。
8. **读图片 `read_image`**
   - DSH：`fs/tool-fs` 的 `read_image` 读 PNG、JPEG、WebP、GIF；模型没声明支持图像输入时拒绝；会自动缩小。
   - moyyi 现状：模型档案没有"支持图像输入"的声明；桌面只能本地预览图片，模型看不到。
   - 决定：采用。先给声明支持图像的模型用（逐个核实 Anthropic、Kimi、DeepSeek 接口）。要加模型档案字段、图像 blob 记录和上下文渲染。

### P3：较大，之后再看

| 候选 | DSH 包 | 价值 | 主要代价 |
|---|---|---|---|
| LSP 代码导航（定义、引用、悬停文档） | `lsp/tool-lsp`、`lsp-stdio` | 对"读了代码却理解错"有直接帮助 | 主人配置的语言服务器进程，新进程类型，需 ADR |
| 分叉子 agent（带上父会话已完成的轮次） | `subagent/subagent-fork-in-process` | 子 agent 不用重新读 | 每次子请求都带父上下文，花费高 |
| 跨会话检索（同一工作目录的旧会话） | `experimental/tool-session-query` | 延续之前的结论 | DSH 用 5 个工具，每次请求都多出这些说明；moyyi 最多做 1 个 |
| 目标与自动续跑 | `goal/*` | 长任务不用人盯 | 花费风险高，需主人拍板 |
| 常驻 shell（命令间保留目录和环境变量） | `shell/tool-bash-persistent`、`terminal/*` | 多步命令更自然 | 沙箱和取消都更复杂 |
| 会话标题自动生成 | `session/session-title-*` | 会话列表更好找 | 每个会话多一次请求 |

## 3. 不采用

- 程序化工具调用（`ptc-runtime`、`tool-executor-ptc`）、编排脚本（`workflow/*`）、agent 团队任务板（`team/*`）：复杂度高，moyyi 现在的瓶颈不在这里。
- 插件市场、liveshare、webhook、SSH 远程、语音输入、computer-use：超出个人 agent 当前范围，或要引入新的外部服务。
- `experimental/auto-review`（每次工具调用前让模型自审）：多花请求，而且概览已经记录"模型读回自查不算独立验证"。
- `exit_plan_mode` 工具：继续坚持只有主人能批准计划（ADR 0054）。它的"计划审阅"形式已经由"按计划执行"覆盖。
- DSH 计划模式"工具照常可用、只靠提示"的做法：moyyi 保持真正拒绝。

## 4. 需要主人拍板

| 决定 | 推荐 |
|---|---|
| 是否读用户全局指令文件 `~/.moyyi/AGENTS.md`（工作区外的新读取来源） | 做，由 host 配置开启，规则和根目录 `AGENTS.md` 相同 |
| 是否让钩子输出进入模型请求（附加上下文、改完自动检查） | 做，记录在请求里，限制大小，默认关 |
| 是否做"目标与自动续跑" | 暂不做 |
| 是否自动生成会话标题（每个会话多一次请求） | 暂不做；以后做也默认关 |

## 5. 建议的下一批

- **批次 A（一个 PR，离线可测）**：第 2 节第 1–5 项。
- **批次 B（需要 ADR 和第 4 节的决定）**：第 6、7 项。
- **批次 C**：第 8 项和 LSP。
- **答题质量**（概览里的头号问题）单独走：先按
  [验证清单](2026-11-05-verification-checklist.md) 跑质量门（开、关最终核对清单各一次），
  再决定要不要试"最后成文那次请求换更强的模型"。
