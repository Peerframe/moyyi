# Phase 5: Anthropic and web

## 授权与当前交付

Owner 授权审查并合并 #14，再推进 phase 5。目录 `/Users/yxflc/Project/moyyi`，分支
`codex/phase-5-anthropic-web`，直接从 main `25aff55d4d34c7f06e47ed6320ca89c1f950a453` 切出。
新 PR 不自动合并，不做付费模型调用，不读取真实凭据，不直接推送 main。**phase 6 不开始。**
D1–D6 保持原决定；persisted v1、分层规则、原有 30 道公共题及其判分标准不改。
本记录是当前摘要；最终提交和 CI 链接以本分支 PR 为准，不把合成测试称为真实模型验收。

## #14 审查与合并

- 固定 head：`9c93707e536319f12344dc2647469441a89f7e62`；独立代码审查无阻断问题。
- `npx vitest run src/context/index.test.ts tests/runtime-compaction.test.ts tests/core-recovery.test.ts tests/compaction-process.test.ts tests/compaction-publication.test.ts tests/cli-compaction.test.ts`：**64/64，6 个文件通过**。
- [原 head CI](https://github.com/Peerframe/moyyi/actions/runs/40179377387) 通过后，使用
  `gh pr merge 14 --merge --match-head-commit 9c93707e536319f12344dc2647469441a89f7e62` 合并。
- 合并为 `25aff55`；[main CI](https://github.com/Peerframe/moyyi/actions/runs/40179790747) 通过。
  未直接推送 main，未改变仓库保护规则。

## 做了什么

- 新增 opt-in Anthropic Messages 适配器，支持文本、思考、签名／redacted replay、函数调用、
  拒绝、用量和取消；固定 host HTTP 单独获取凭据，插件没有 SDK、网络权限或自动重试。
  目标为 `claude-sonnet-5-5`、API `2023-06-01`；DeepSeek 保持可用。
- D2 opaque payload 增加 prefix/account 绑定和失效信息，压缩或来源改变后剥离失效 thinking，
  保留合法文本／工具对，不伪造签名、不重做工具；不修改持久化格式。已有录制／离线重放可用。
- 新增 `web_fetch`／`web_search`，都是 `external / none / none`。默认无网络授权；显式配置
  exact-origin grant，执行默认审批。准备阶段无 DNS；执行绑定审批的 payload、digest、run 和
  durable started，单次使用，撤销／取消／调用结束后失效。外部工具拿不到本地文件能力。
- 生产 HTTPS 校验所有 A 记录、固定实际连接地址、正常校验证书；拒绝内网／保留地址、代理继承、
  自动跳转、压缩响应和不支持的类型，限制输入、响应与时间。搜索使用显式配置的 SearXNG JSON
  端点，不选公共实例、不安装服务、不开户；搜索结果不会自动授予后续 fetch 权限。
- 新增 Anthropic 与网页离线 eval，接入 CI；使用真实 runtime、SQLite、文件与 canary，网络数据
  和模型动作是合成的。保留现有 CI、shell/长会话验收，不修改或放宽旧检查。
- [ADR 0015](../decisions/0015-anthropic-and-web.md)、[模型用法](../anthropic.md)、
  [网页用法](../web.md)及研究记录说明来源、配置、成本边界和限制。没有复制 OpenBot／上游源码，
  没有新依赖；复用本仓库既有 SSE framing、core、store、policy 和录制端口。

## 验收证据

以下均为本轮实际执行，早期结果与最终结果明确区分：

- 初次 Anthropic 插件：`npx vitest run src/plugins/provider-anthropic`，**50/50**。
- Web 独立审查复核：`npx vitest run src/runtime/web-http.test.ts src/runtime/web.test.ts src/plugins/web/index.test.ts src/policy/web.test.ts tests/runtime-web.test.ts`，**98/98**，含真实本地 TLS／证书／hostname 拒绝探针。
- 整合：`npx vitest run src/runtime/anthropic-http.test.ts src/plugins/web src/policy/web.test.ts tests/runtime-web.test.ts tests/runtime-anthropic.test.ts`，**27/27**。
- 修复独立审查问题前的 `npm run check`：typecheck、Biome **195 files**、**1,360/1,360 tests in 64 files** 通过。
- `npm run build`、`node dist/cli/main.js --help`：通过。
- `npm run eval:anthropic` **4/4**；`npm run eval:web` **7/7**；`npm run eval:deepseek` **6/6**；
  `npm run eval:core` **8/8**；`npm run eval:long-sessions` **4/4**；`npm run eval:shell` **7/7**。
  全部无付费调用，shell 使用真实原生沙箱。
- 首次全量检查在新增 executor 测试的 readonly 字段赋值处 typecheck 失败；改为构造新 host 后通过。
  没有改类型约束或检查规则。
- 独立审查发现：失效 thinking 后本轮 refusal/max_tokens/error 没有 envelope，恢复旧 prefix 时可能
  重新发送旧签名。已通过持久化历史预扫描屏障修复，不依赖进程内状态；独立复现与复核关闭该问题。
  代价是普通连续 user／steering／notice 也可能舍弃此前 thinking，保留文本／完整工具对与后续新思考。

最终修复后的验收：

- `npx vitest run src/plugins/provider-anthropic src/runtime/anthropic-http.test.ts tests/runtime-anthropic.test.ts`：
  **68/68，4 files**，由独立审查执行；另用独立最小复现验证 refusal/max_tokens/error
  经 JSON 还原与新 client 后旧签名不复活、新签名继续可用，当前范围无剩余阻断。
- 新增第 5 个 Anthropic eval：真实 runtime 更换上下文→refusal→关闭 SQLite→恢复原上下文并
  用新 runtime 重开会话，断言旧签名不再出现、正文与拒绝仍在。
- 最终 `npm run check`：typecheck、Biome **196 files**、**1,365/1,365 tests in 64 files** 通过。
- 最终 `npm run build`、`npm run eval:anthropic` **5/5**、`npm run eval:web` **7/7** 通过。
  前述 DeepSeek/core/长会话/shell eval 的相关实现未再改变，沿用本轮已通过证据。
- 修改文档的相对链接检查：**130 个，无缺失**；`git diff --check` 通过；
  `git diff --quiet -- src/contracts/persisted tests/boundaries.ts evals/tasks evals/harness` 通过。
- 新分支 CI 在 PR 上单独记录，必须通过后才交付为可审查状态。新 PR 保持未合并。

真实公网探针：`node scripts/probe-web.ts` 使用 scripted model、真实 runtime/SQLite、一次
`https://example.com/` GET，没有网络替身、凭据或模型请求。**当前环境未通过**：系统 DNS 返回
`198.18.3.70`（保留地址），runtime 拒绝连接，效果为 unknown、run 为 failed，没有改成成功。
`node --input-type=module -e "import {lookup} from 'node:dns/promises'; console.log(await lookup('example.com', {all:true,family:4}));"`
确认该解析结果。保留原边界，不增加绕过或关闭 TLS 的开关；这不证明正常公网路由下的服务可用性。

## 尚未验证与范围限制

- 无真实 Anthropic／DeepSeek 请求、真实签名续接、计费／延迟／缓存命中测量、真实模型抗注入或
  任务能力分数。合成场景证明受测契约与权限边界，不证明模型会正确理解网页。
- 无已部署 SearXNG JSON 端点验收；默认没有搜索服务。公网读取在当前 DNS 环境被正确拒绝；
  真实服务验收需要符合既定公网边界的网络环境，不能靠关掉校验解决。
- Web 首版仅 IPv4 HTTPS 文本／HTML 源码／JSON，不能读取 IPv6-only、私网、需登录、必须跳转、
  压缩或 JS 渲染的站点；不是浏览器。允许的 URL／query 仍可携带敏感内容，origin 校验不等于语义脱敏。
- interrupted tool history 保守拒绝续接，不执行或伪造结果；可能需要新会话。已知原生沙箱停止
  限制和 DeepSeek continuation 限制不变。没有 GUI、安装发行流程或 phase 6 工作。
- `project-instructions` 插件及 phase 1 真实模型验收仍是原有缺口，本轮未顺带扩大范围。

## 需要 owner 决定

本轮限定实现无新增 D 类架构决定；既定 D1–D6 不变。新 PR 保持打开等待审查，不自动合并。
真实模型调用需要以后明确授权和预算；搜索需 owner 选择／配置实际端点，当前没有默认实例。
phase 6 必须等待新的指示。
