# 交付三：个人设置、Skills 与搜索

- 日期：2026-10-30。
- 上级计划：[M6 之后的计划 v2](2026-10-28-post-m6-plan.md) 第 4 节“交付三”，决定 D-A 至 D-H 已接受；
  本简报第 10 节的四项 owner 决定已于 2026-10-30 定下；同日因搜索计费变化补充了 D3-1a 和 D3-3a。
- 执行：Codex。从最新 main（含交付一、二，`dde4e1b` 或之后）新建分支
  `codex/delivery-3-settings-skills-search`，整块实现，一个 PR。
- 审查与验收：Claude。

## 1. 目标

日常每次都会用到的配置和查资料能力，在桌面端一次做完：

1. 配置多个**模型连接**（同一厂商可以有多个，例如两把 DeepSeek 密钥），在会话里切换；
2. 某个连接**额度用完**时，运行停在可恢复的状态，用户换一个连接后在同一会话继续；
3. 写一份**个人指令**，每个会话都带上；
4. 有一个 **Skills 库**：从本机导入、审查、启用、撤销，模型按需读取；
5. 桌面端能**搜索网页**，搜索结果作为来源记录下来，可以写进报告；
6. 在对话里**看到任务清单**（交付一的 `todo_write`）。

现状（main `dde4e1b`）：

- 设置只有三个固定预设（`flash`、`kimi-cn`、`kimi-global`），每个预设一把钥匙串密钥；
  `~/.moyyi/desktop/settings.json` 为格式 1，上限 16 KiB（`apps/desktop/host/settings.ts`、
  `settings-schema.ts`）。改设置会重开运行时并重新载入当前会话（`features/settings/host.ts`）。
- 余额不足时 DeepSeek 返回 402，被归为 `auth`；429 归为 `rate_limited`
  （`src/plugins/provider-deepseek/index.ts`）。日常零重试，失败即结束本次运行，历史保留。
- Skills 只能在 CLI host 模块里按名字显式启用，每次请求全部载入（[skills](../skills.md)）；
  桌面端没有 Skills。
- `web_search` 只支持 SearXNG，且只在 CLI；桌面端搜索关闭（[web](../web.md)）。
- 桌面端已按交付二拆成九个功能模块，新增功能按
  [新增桌面功能](../recipes/add-a-desktop-feature.md) 只加模块目录和 `feature-list.json` 一项。
- 交付一的 `todo_write` 已在运行时注册，但界面只显示为普通工具调用。
- 会话库已是持久化格式 2（交付一）；日常安装仍是 M6，尚未升级。

## 2. 参照

DSH 固定提交 `f3803c96974ad4a94195fb97e5c637e9c2a3afe3`（MIT）。先按
[moyyi-learn-from-dsh](../../.agents/skills/moyyi-learn-from-dsh/SKILL.md) 读，再动手：

| 部分 | DSH 路径 | 看什么 |
|---|---|---|
| A 连接 | `packages/llm/llm`、`packages/client/ui-settings-models`、`packages/client/ui-model-selection` | 密钥只写不读、按厂商分组的连接列表、会话内切换模型的界面 |
| B 额度 | `packages/llm/llm`、`packages/llm/llm-deepseek` | 错误分类、失败后会话状态 |
| D Skills | `packages/skill/skill`、`packages/skill/tool-skill`、`packages/skill/skill-filesystem`、`packages/client/ui-skill` | 目录（名字＋描述）注入、按需加载工具、同名处理、“模型体验”一节的措辞 |
| E 搜索 | `packages/web/web-search-deepseek`、`packages/client/ui-settings-web-search`、`docs/subsystems/web.md` | 只从结构化 `web_search_tool_result` 取来源、不信任模型散文、失败代码 |
| F 清单 | `packages/client/ui-conversation`、`packages/todo/tool-todo` | 按工具名注册的会话节点渲染 |

OpenBot 的 P07/P09/P10 界面（[provenance](../openbot-provenance.md#complete-transfer-inventory)）可作
第二参照。只借鉴设计和小段代码，不引入 Cordis、DSH 或 OpenBot 包；复用的代码逐文件记入 provenance。

## 3. 不变的边界

- 默认连接仍是 DeepSeek Flash + Responses + low，零重试；现有请求数、时间、输出和工具上限不变。
- **不自动换连接，不静默回退，不自动重试已发出的请求。** 切换只由用户发起。
- 权限规则不变：重开运行时（包括切换连接）后，写入、检查和网页授权回到默认只读，需要用户
  重新开启。界面要如实说明这一点。
- 个人指令、Skills 文本和搜索结果都只是数据，不能授予权限、扩大来源或跳过批准。Skill 的
  `allowed-tools` 继续只当元数据；引用文件、资源和脚本不读取、不执行。
- 会话库持久化格式保持 2，SQL schema 保持 3。**本交付唯一计划内的格式变化是桌面设置文件格式
  1 → 2**（第 4 节 A、G）。
- 桌面端新增功能都按交付二的模块结构写：模块之间不互相导入，IPC 通道由契约声明并在外壳统一校验。
- 不改 CLI 的配置方式：CLI 仍用 host 模块，不读桌面设置。

## 4. 工作内容

### A. 模型连接（P07/P08）

- 设置文件 `~/.moyyi/desktop/settings.json` 升为**格式 2**：
  - `connections`：命名连接列表，每项含 `id`、显示名、厂商（`deepseek`、`kimi-cn`、`kimi-global`）、
    推理强度（DeepSeek 固定 low；Kimi low/high，沿用现有规则）、钥匙串引用；
  - `activeConnectionId`；请求数、超时、`evidenceAnswer` 等现有字段保持原含义和范围；
  - 第 C、D、E 部分的设置字段（见各节）。
- 首次读到格式 1 时，在内存中迁移：现有预设和它的密钥引用变成一个连接，设为当前连接。只在
  用户第一次保存时写出格式 2，并先把原文件复制为 `settings.format1.json`（不覆盖已有副本）。
  其余检查（目录归属、权限、不跟随符号链接、单链接）全部保留；大小上限可提到 64 KiB。
- 同一厂商可以有多个连接，各自一把钥匙串密钥；密钥只写不读，界面只显示“已配置”。删除连接时
  删除它的钥匙串项；当前连接不能删除。
- 只支持现有提供方插件已支持的模型（DeepSeek Flash、Kimi K3.1 Pro）。**不加 Anthropic**，
  不加新模型，不做端点发现。
- 界面：设置里新增“模型连接”分区（列表、添加、改名、删除、设为默认）；对话区顶部显示当前连接，
  可在空闲时切换。切换走现有“重开运行时、重载当前会话”路径。

### B. 额度用完时停下与切换（2026-10-29 owner 追加）

- 在 `src/contracts/model.ts` 的 `ModelErrorKind` 增加 `quota`（这不是持久化格式）。分类：
  - DeepSeek：402 → `quota`；
  - Kimi：402，以及响应体明确表示余额或套餐用尽的 429 → `quota`；
  - 其余 429 仍为 `rate_limited`。
  每条规则配合成测试；只依据状态码和响应中的结构化字段，不匹配自由文本。
- 运行因 `quota`、`rate_limited` 或 `auth` 结束时，桌面端显示“连接不可用”卡片：连接名、原因
  （额度用完、被限流、密钥无效）、“本次运行已停止，历史已保留”、“切换连接”按钮。不显示原始
  错误正文和密钥。
- 用户切换连接后，在会话里追加一条 `notice`（`code: "connection_switched"`），文本写明从哪个
  连接换到哪个连接（只写显示名和厂商/模型，不写密钥引用），并说明之前的提供方推理内容不可用。
  `notice.code` 本就是自由字符串，不改持久化格式。随后用户正常发消息继续；界面可以预填
  “继续完成上一个任务”，但不替用户发送。
- **跨厂商续接**：同一会话里前面是 DeepSeek 的回答、后面换成 Kimi（或反过来）时，编解码器把
  其他来源的助手消息按纯文本加工具调用渲染，丢弃提供方专属的推理和 replay 数据，工具调用 ID
  保持配对。同厂商不同密钥时全部保留。写一份 ADR。
  如果做不到而必须改会话库格式，**立即停下**。
- 用合成提供方覆盖：402、额度类 429、普通 429、401；切换后续接；跨厂商续接；取消和中断。

### C. 个人指令（P09）

- 桌面设置新增个人指令文本，UTF-8，最多 8 KiB，保存在
  `~/.moyyi/desktop/personal-instructions.md`（与 settings.json 相同的文件检查）；
  settings 里记录它的 SHA-256。
- 作为运行时上下文来源，放在默认指令之后、项目 `AGENTS.md` 之前。来源块写明“个人指令”、
  SHA-256 和全文，不写绝对路径。它与安全段冲突时，安全段优先；它不能授予权限。
- 修改后从下一次模型请求生效，与现有 Skills 刷新方式一致；已记录的请求不改写。
- 写进 `src/plugins/` 下的插件（建议 `personal-instructions`），README 写“模型体验”。

### D. Skills 库（P10）

- **存储**：导入的 Skill 按内容寻址保存为不可变副本
  `~/.moyyi/desktop/skills/<sha256>/SKILL.md`。只复制 `SKILL.md`，同目录其他文件不复制，在审查
  界面列出“未导入”的文件名。settings 记录库索引：名字、描述、摘要、导入时间、是否启用。
  同名再次导入是新版本，启用时选定一个摘要。
- **导入与审查**：原生对话框选一个本机目录，复用 `src/plugins/skills/parse.ts` 的解析和现有大小
  上限。审查页显示名字、描述、摘要、全文，以及固定提示：“`allowed-tools` 不改变权限；引用和
  脚本不会读取或执行。”用户确认后才写入库。启用和撤销都在库页面完成。
- **模型怎么用**（参照 DSH `tool-skill`）：
  - 有已启用 Skill 时，上下文里放一个目录：每项是名字加截断后的描述（总量设上限），并说明
    “任务匹配时先调用 `read_skill` 读全文，目录只是摘要”；
  - 新增只读工具 `read_skill(name)`，只能读已启用 Skill 的当前摘要版本，返回来源块（名字、摘要、
    全文）；撤销后再读会如实报告不可用；
  - 目录变化追加在已有前缀之后，不改写早先的请求。
- 实现放在插件里，可以扩展现有 `skills` 插件或新建插件；读取能力由运行时注入，插件不直接碰
  文件系统路径。CLI 现有的显式启用方式保持不变。

### E. 网页搜索（P15）

- **后端：DeepSeek 原生搜索**（owner 2026-10-30 决定）。参照 DSH `web-search-deepseek`：
  - 用当前连接列表里的一个 DeepSeek 连接的密钥，在设置里选定；没有 DeepSeek 连接时，搜索不可用，
    界面说明原因；
  - 请求发到 DeepSeek 的 Anthropic 兼容端点 `https://api.deepseek.com/anthropic/v1/messages`，
    模型 Flash，关闭思考，`max_tokens` 4096，原生 `web_search` 每次最多使用 5 次；
  - 只从结构化 `web_search_tool_result` 中取标题、URL、发布时间和摘录，按 URL 去重，最多 10 条；
    **不使用模型的散文内容**。没有结构化结果就报错，不降级；
  - 搜索用的提示固定为一句话加搜索词，不含会话内容。
- 作为 `web_search` 的一个后端接入现有 `src/plugins/web`，CLI 的 SearXNG 后端保持不变。HTTP
  请求复用现有提供方的传输限制；不跟随重定向。
- **权限与预算**：桌面端“网页访问”里单独开启“搜索”，开启后每次搜索仍按 M5 的逐次批准，批准
  界面显示搜索词和“将产生一次 DeepSeek Flash 付费调用，外加最多 5 次计费搜索”。每次运行最多
  5 次产品搜索（即 `web_search` 工具调用）。搜索返回的链接不等于抓取授权，抓取仍按 M5 的站点授权。
- **计费**（DeepSeek 官方说明，2026-11-01 00:00 北京时间起）：除模型 token 外，每次成功且非空的
  原生搜索另收 USD 0.75/1000 次；失败、空结果、超时不计费。一次产品搜索最多触发 5 次计费搜索。
  每次产品搜索从响应的 `usage.server_tool_use` 读取成功搜索次数，连同 token 用量写进该次工具结果的
  记录，界面在搜索卡片上显示；读不到时如实写“未知”，不估算。依据：
  [Search & Fetch billing](https://api-docs.deepseek.com/guides/search/#billing)、
  [Anthropic server-tool usage](https://api-docs.deepseek.com/guides/anthropic_api/#server-tool-usage)。
- **来源**：每条搜索结果作为来源记录，进入 M5 的来源面板和报告流程；报告中的来源能对应到
  记录的搜索结果或已抓取页面。
- 写一份 ADR：搜索后端、凭据复用、计费可见性、为什么不信任散文。在 `docs/web.md` 写清楚用法和限制。

### F. 任务清单显示

- 在会话节点渲染器插槽中按工具名 `todo_write` 注册：显示该次调用的完整清单和状态（待办、进行中、
  已完成），较早的清单默认折叠，最新的展开。
- 只依据记录里的工具调用参数和结果显示，不另存状态。标题写“模型的任务清单”，并注明“这是模型
  自己报告的进度，不代表已核实”。
- 按 [design](../design.md) 的组件和状态规则做，复用现有卡片样式。

### G. 备份、恢复与回滚（P25）

- 备份包含设置格式 2、个人指令文件和 Skills 库，并写入清单哈希；不含钥匙串密钥。
- 恢复仍只替换会话库，现有规则不变；救援备份同时保存当前的个人指令和 Skills 库。
- 软件回滚：目标版本读不了设置格式 2 或会话库格式 2 时拒绝，并提示需要对应的升级前备份；
  不丢弃或降级当前数据去迁就旧版本。

### H. 合成与外部包验收

- 合成提供方覆盖：连接增删改、切换、额度卡片、跨厂商续接、个人指令生效、Skill 导入→启用→
  `read_skill`→撤销、搜索批准→结果记录→报告、清单显示。
- 加进 `npm run verify:desktop`。原有 M1–M6 和交付二的断言不删、不放宽。

## 5. 文档

Codex 更新：

- 新 ADR（从 0048 起顺延）：跨厂商续接与额度切换；桌面 Skills 库与 `read_skill`；DeepSeek 原生
  搜索后端。需要时把个人指令并入 Skills 那份。
- 新插件和改动插件的 README 都写“模型体验”：模型看到什么、token 成本、对前缀缓存的影响。
- `docs/desktop.md`（连接、额度、个人指令、Skills、搜索、清单）、`docs/web.md`、`docs/skills.md`、
  `docs/installation.md`（设置格式 2 的升级和回滚）、provenance、各功能模块 README。
- 本交付的实现记录 `docs/tasks/2026-10-30-delivery-3-record.md`，写法同交付二的记录。

Claude 在验收后更新 system overview、roadmap 和历史交付记录，Codex 不改。

## 6. 完成标准（交付结束时统一验收）

1. `npm run check` 通过，包括新边界和贡献约定检查。
2. 相关离线套件通过（至少 `eval:core`、`eval:deepseek`、`eval:kimi`、`eval:web`、`eval:skills`、
   `eval:instructions`、`eval:runtime`），`npm run verify:package -- --offline`、
   `npm run desktop:package`、`npm run verify:desktop` 通过。
3. **质量门**：交付一结束时的候选结果作为基线（六题全过），在本交付候选上每题跑一次，不低于基线；
   某题失败时，只在 main 上对该题做一次基线对照。上限 71 次请求。
4. **安装版验收**（在隔离副本上，用真实 DeepSeek，必要时 Kimi）：
   1. 用连接 A 开始一个多步任务，中途切换到连接 B，在同一会话完成；记录里有
      `connection_switched`，结果正确；
   2. 从仓库内的测试 Skill 导入、审查、启用，完成一项必须遵循该 Skill 才能通过检查的任务，记录里
      有 `read_skill` 调用；撤销后再试读如实报告不可用（这一步不需要模型请求）；
   3. 开启搜索，搜索一个公开主题，抓取一条结果，写出报告；检查器核对报告中每个来源 URL 都在记录
      的搜索结果或已抓取页面中；
   4. 重启后连接、个人指令、Skills 库、来源和会话历史都正确，权限回到只读。
   三项任务的检查器在付费运行前写好并冻结。合计最多 20 次模型请求和 3 次产品搜索（每次底层最多
   5 次计费搜索，即最多 15 次），零重试，失败不重跑，
   如实记录。
5. 额度路径（402、额度类 429）只用合成提供方验证，不为此真的耗尽额度。
6. 正常窗口和窄窗口截图（1120 × 800、780 × 560），覆盖新增的设置分区、连接不可用卡片、Skills 审查页、
   搜索批准和清单节点。
7. 用户数据和日常安装在验收前后不变（沿用交付二的哈希核对方式）。

## 7. 先做完，再集中修复

允许先记下、交付结束后集中修：

- 界面细节、文案、截图里的小差异；
- 质量门个别题目退步（按第 6 节第 3 条做一次基线对照后定性）；
- 文档和 README 缺漏；
- 测试组织。

必须**立即停下**交给 Claude 和 owner：

- 需要改会话库持久化格式或 SQL schema；
- 需要放宽任何权限、上限、IPC 或路径检查；
- 需要 DeepSeek 原生搜索以外的新外部服务，或新的密钥种类；
- 估计付费用量超过第 6 节的上限（质量门 71 次，验收 20 次请求加 3 次产品搜索）；
- 发现 DeepSeek 原生搜索不能返回结构化来源，或其计费方式与第 4 节 E 的描述（2026-10-30 版）明显不同。

## 8. 不做

- Anthropic 或其他新厂商、新模型、端点发现、自动换连接或自动回退；
- Skill 脚本执行、引用文件读取、从网络安装 Skill、Skill 市场；
- 自建或公共 SearXNG 的桌面配置、其他搜索服务。owner 以后可能自部署搜索服务，届时另行立项；
  本交付的 `web_search` 后端接口要能再接一个后端，但不预先实现；
- 记忆、MCP、OCR、受控浏览器、定时任务（交付四）；
- 模板导入导出、语音、加密 PDF、MCP Apps、审计导出、其余偏好（owner 暂缓）；
- CLI 读取桌面设置；暗色模式、多语言、视觉重设计。

## 9. 与其他工作的关系

- 依赖交付一（`todo_write`、输出外存、会话库格式 2）和交付二（模块结构），两者均已合并。
- 交付四的每项新存储，照本交付 G 部分的方式扩展备份、恢复和回滚。

## 10. Owner 决定（2026-10-30 已定）

| 编号 | 问题 | 决定 |
|---|---|---|
| D3-1 | 桌面搜索后端 | DeepSeek 原生搜索，复用现有 DeepSeek 密钥；每次搜索是一次额外的 Flash 付费调用 |
| D3-2 | 是否在桌面连接中加 Anthropic | 这次不加 |
| D3-3 | 付费验收预算 | 质量门最多 71 次请求；安装版验收最多 20 次模型请求加 3 次搜索；零重试，失败不重跑 |
| D3-1a | 原生搜索另收 USD 0.75/1000 次成功搜索（2026-11-01 起），Codex 按第 7 节停下 | 接受，继续用 DeepSeek 原生搜索；`max_uses` 保持 5；额外搜索费用一并授权 |
| D3-3a | 验收“3 次搜索”的计数口径 | 按产品侧 `web_search` 调用计；每次底层最多 5 次计费搜索；其他预算和约束不变 |
| D3-4 | 合并后是否替换日常安装 | 是。Claude 验收、合并后，先备份会话和设置，再把 CLI 和桌面端一起升级；保留 M6 和升级前备份供回退 |
