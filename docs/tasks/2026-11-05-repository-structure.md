# 仓库结构升级：对照 DSH 与开源 agent 仓库

- 日期：2026-11-05。执行：Claude（应 owner 要求直接实现）；分支 `claude/adoring-maxwell-rad278`。
- 范围：只改仓库结构、生成文档和检查，不改产品行为、持久化格式、权限或模型可见内容。
- 对照来源（只读，克隆在仓库外，未运行其脚本、未安装其依赖）：
  - DeepSeek Harness `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`（2026-11-04，MIT）
  - openai/codex `529d965d80a36f7b5d9d9ab218d88daf41106748`（2026-11-05）
  - sst/opencode `b9e8b04d2180728eda73fd2f87b0bcc7b740f8cb`（2026-11-04）
  - block/goose `bfe8ccd23de1d2c47a4cb2970d522f093ae7f2ba`（2026-11-04）

## 1. 本次完成

| 部分 | 内容 |
|---|---|
| A runtime 分目录 | `src/runtime/` 原来平铺 32 个源文件，现按职责分为 `providers/`、`files/`、`processes/`、`web/`、`documents/`、`guidance/`，组装代码留在根目录；文档夹具收到 `documents/fixtures/`。纯搬迁，导入路径、打包夹具路径和文档链接同步更新。编译后 `document-dependencies` 指向 `dist/vendor` 的相对路径相应加深一级 |
| B 工具目录 | 借鉴 DSH `gen-tool-catalog`：`scripts/tool-catalog.ts` 通过真实插件注册表加载内置工具插件，生成 [docs/tool-catalog.md](../tool-catalog.md)（名称、描述、参数 schema、效果类别，逐字照录）。`npm run check` 会核对它是否过期；`src/plugins/*/index.ts` 里只要出现 `registerTool(`，却没登记在生成脚本中，检查就失败 |
| C 文档 | architecture 增加 runtime 目录表；AGENTS.md、docs/AGENTS.md、`moyyi-model-experience` skill 写入工具目录的用法；provenance 记录 DSH 借鉴；`moyyi-learn-from-dsh` 更新最后审阅的提交 |

工具目录的作用：工具描述或参数一改，PR 的 diff 里就能直接看到模型实际看到的变化，审查不必再去源码里拼字符串。

## 2. 检查（实际运行）

环境：Linux 容器，Node 26.13.0。

- 搬迁前在原始 main 上跑 `npm run check`：类型检查和 lint 通过；测试 2999 个通过、96 个失败。失败原因是容器里没有 bubblewrap，原生沙箱无法启动。搬迁后结果相同，96 个失败的测试名逐一比对一致。
- 安装 bubblewrap 后，原始代码和搬迁后代码各跑一次全量 `vitest run`：
  - 原始代码 36 个失败，搬迁后 27 个失败。
  - 搬迁后失败的测试，都在原始代码同样失败的范围里，没有新增。
  - 失败全部在两个文档解析测试文件里，错误都是 "Document parser failed without producing a valid bounded result"。沙箱里的解析进程在这个容器里不稳定；单独再跑一次文档测试，原始 36 个、搬迁后 28 个失败。
  - 进程和 shell 相关测试两边都全部通过。
  - "不执行 PDF 里的 JavaScript"等测试需要解析进程真正跑起来，它们在新位置能通过，说明解析进程从新路径正常启动。
- 离线套件：core 25/25、files 19/19、deepseek 18/18、shell 8/8、long-sessions 4/4、anthropic 5/5、kimi 4/4、web 9/9、instructions 36/36、runtime、skills 31/31、writes 8/8 通过，公开任务集（null agent）通过。`eval:documents` 失败，原始 main 上同样失败，原因同上。
- `node scripts/tool-catalog.ts --check` 通过。

### owner 的 Mac 上实际运行（2026-11-05）

环境：macOS arm64，Homebrew Node 26.13.0 / npm 11.20.0。在仓库外新克隆的分支上运行，提交 `82018dc`，工作树干净（`dirty: false`）。

- `npm ci --ignore-scripts`，然后运行 `node node_modules/electron/install.js`。
- `npm run check`：
  - 功能注册表、工具目录、类型检查、lint 全部通过。
  - 测试 3110 个通过，2 个失败，都是 5000 ms 超时：`apps/desktop/host/service.test.ts` 里的编辑和撤销用例，以及 `src/runtime/documents/documents.test.ts` 里识别损坏和加密文件的用例。
  - 这两个文件单独重跑，40/40 通过。属于交付一记录过的"全量并发下偶发超时"，和这次搬迁无关。
  - 容器里失败的文档解析测试，在 Mac 上全部通过。
- `npm run verify:package`：`passed: true`。文档隔离（seatbelt）、类型声明、7/7 PTY 场景、卸载检查都通过，没有调用真实模型。
- `npm run desktop:package`：
  - ZIP SHA-256 `96feb9a0a851915a1606e78eed52b486c6c0064e1616562291778bcc297dec98`。
  - runtime tarball SHA-256 `911030ea8967ecfc756eb5e6009136f39d8f4d0231942531c6b93921568c03c1`，共 428 个文件。
  - 编译 Keychain 帮助程序时，有一条 `SecKeychainOpen` 已弃用的警告，是原有代码，这次没有改动。
- `npm run verify:desktop`：`passed: true`。
  - App 包 SHA-256 `ab04a9dcb37a33847df0cb1f64d5ee101fd73e99eaf5707f97c1641ef68dacd5`，内置 Node 26.12.1。
  - host、材料与报告、导入材料与历史、取消、编辑与恢复、生产设置、网页来源、Kimi 错误、阶段截止、维护、隔离各组全部通过。
  - 读取凭据 0 次，没有调用真实模型。
  - 打包后的七种格式 `read_document` 都能读到实际内容，说明 `dist/runtime/documents/` 的新路径可用。
- 没有做：可见的 GUI 手动检查、付费模型任务。这次没有改动模型可见内容，不需要质量门。

## 3. 对照结论

| 做法 | 出处 | 决定 |
|---|---|---|
| 生成的工具目录，带新鲜度和完整性检查 | DSH `scripts/gen-tool-catalog.ts`、`docs/tool-catalog.md` | **采纳**（B） |
| 每个包 README 固定几节：用途、实现、Model experience、已知限制 | DSH 包 README | **已有规则，未落实**：14 个插件 README 里只有 4 个有 Model experience 一节。建议下一次改到哪个插件就补哪个，补齐后再在 `contributor-conventions` 里强制 |
| 编号的事后复盘目录 `docs/postmortem/` | DSH | **借鉴**：moyyi 的失败散落在交付记录和"已关闭路线"表里。建议以后真实失败按编号写成一页，总览只链接过去 |
| 其他生成目录（配置、持久化格式、模块依赖图） | DSH `gen-*-catalog` | **以后再说**：moyyi 的持久化格式已有夹具锁定，配置项也少，眼下收益不大 |
| 按能力拆细的包或 crate | DSH `packages/<group>/<pkg>`，Codex 的 `codex-rs/*` | **部分借鉴**：只在 runtime 层内分子目录（A），不拆成多个 npm 包。moyyi 是单包私有项目，`tests/boundaries.ts` 已经能管住分层 |
| 协议独立成包，后端以服务形式运行，CLI、桌面、SDK 都是客户端 | Codex `app-server` + `app-server-protocol` + `app-server-client`；opencode `protocol`/`server`/`client`/`sdk`/`tui`/`desktop`；DSH 的 Host + Web RPC、SDK JSON-RPC、ACP；goose 的 `goose-acp` 和桌面端 `goose-acp-client` | **交 owner 决定**，见第 4 节 |
| 插件可以拦截或替换主循环 | DSH `agent/*` waterfall | **拒绝**（ADR 0005） |

## 4. 前后端现状与选项

### 现状

后端和前端**分在不同进程里，但还没有独立的后端服务**。

- 桌面端有三个进程：
  - 沙箱化的 React 渲染进程，即前端。
  - Electron 主进程，负责校验 IPC 发送方和命令。
  - 由主进程派生的 Node worker（`apps/desktop/worker.ts`）。它在自己的进程里运行 desktop host，并通过 `createRuntime` 把 runtime、core 和 SQLite 都放在这个进程内。
  - 渲染进程和主进程之间走 preload bridge；主进程和 worker 之间走经过校验的 Node IPC（`wire.ts`）。前端拿不到 runtime、凭据或文件系统。
- CLI 没有单独的后端，`src/cli` 直接在本进程里创建 runtime。
- `moyyi/runtime` 的 `send`/`subscribe` 协议是给可信宿主用的进程内 TypeScript API。按 [client protocol](../client-protocol.md) 的说明，它不提供 HTTP 或 JSON-RPC 端点，也没有带认证的远程边界。
- 会话库只允许一个写入者（`src/store` 的写锁），所以 CLI 和桌面端不能同时打开同一个库。

### 和其他项目的差别

Codex、opencode、DSH 和 goose 都让一个后端进程（或守护进程）独占 agent 和存储，再把协议定义成独立的包。这样 TUI、桌面、IDE 和 SDK 都能连上同一个后端，CLI 和桌面也能同时看到同一个会话。moyyi 目前是每个客户端各自带一份 runtime。

### 选项

| 选项 | 做法 | 好处 | 代价和风险 |
|---|---|---|---|
| 0 维持现状 | 保持进程内 API | 没有新的攻击面；单用户够用 | CLI 和桌面不能同时用；以后接自动化、定时任务也得各自嵌一份 runtime |
| 1 先把协议独立出来 | 把命令和事件的类型及运行时校验从 `src/contracts/protocol.ts` 拆成单独目录，并加上不可信输入的校验；桌面 `wire.ts` 改为复用它 | 为以后的独立后端打基础；不开端口 | 中等工作量；不改权限 |
| 2 本地后端服务 | 后端以守护进程方式运行（Unix socket，按用户鉴权），CLI 和桌面都作为客户端连接 | 和主流 agent 仓库一致；可以多个客户端同时使用 | 这是新的安全边界，需要 ADR、威胁模型、鉴权和断线恢复；工作量大 |

建议：现在做选项 1，等 owner 真正需要 CLI 和桌面同时使用，或者需要定时任务时，再做选项 2。选项 2 属于"更宽的权限或安全变更"，按 AGENTS.md 必须由 owner 决定。

## 5. 留给 owner 的决定

1. 是否接受第 1 节的搬迁和工具目录并合并。Mac 上的打包和桌面验收已经通过（见第 2 节）；合并后是否安装由 owner 另行决定。
2. 前后端选维持现状、选项 1 还是选项 2。选项 1 或 2 需要另写简报。
3. 是否把"插件 README 必须有 Model experience 一节"改成自动检查。
