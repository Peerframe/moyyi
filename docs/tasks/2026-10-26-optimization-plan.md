# 整体计划与本轮针对性优化

Owner 已授权先做整体计划，再针对已证实的缺口优化。本计划承接
[系统总览](../system-overview.md)和[现有上游研究](../research/2026-10-26-agent-navigation.md)，
不重新打开 D1–D6，不另建全局计划体系。目标是让个人 Agent 正确、受控地完成任务；
实现了多少工具、通过多少合成测试，都不能代替这个结果。

## 持续交付：日常任务闭环（当前）

Owner 随后明确要求持续推进可用产品，授权本目标内必要付费操作；又明确选择
“允许验收后逐个合并并安装”。后续不再逐次申请测试预算，但每个试验仍先固定范围、
保存实际请求和结果，零自动重试；PR审查无阻断、CI通过才逐个合并，不叠PR，不公开发布。
GUI、OCR、MCP、长期记忆和模型训练继续后置。下面各节的旧授权/未启动状态是历史，不覆盖此更新。

有限交付顺序是：原题回归 → 受控编辑/真实检查/撤销 → 进程重开/摘要保真 → 实际联网阅读。
已经通过且未受修改影响的证据复用；重复失败时先定位证据交付、模型理解、工具或环境哪层有问题，
查维护中的公开方案后再改对应层，不围绕同题无限补提示词、增加检索或降低判分。

- PR #27 固定头 `1753b89` 经独立安全/安装接线审查无阻断，原CI通过，已按新授权合并。
  主线为 `b6e952c8f6eb0bed2ad21bd76d707488ce089b81`，
  [main CI](https://github.com/Peerframe/moyyi/actions/runs/40341366800)成功。
  当前独立分支 `codex/daily-workflows` / [PR #28](https://github.com/Peerframe/moyyi/pull/28) 从该main创建；
  产品 `487ccfb` 已安装，证据文档更新不代表另一次重装。
- 新原题4+公共题4回归已完成：8次HTTP200、零重试、两份源码快照未变；Flash+Responses+low，
  已安装 `e64fa0e`、路径导航启用。**公共 source-dataflow-report 原checker通过**，实际报告已生成。
  原Skills源码解释仍不通过：把“解析字段未返回”错误说成“原始文本丢弃”，遗漏消费者链和配置生命周期。
  请求中的原文传递已核实，不能继续将此归因给传输失败，或把新增文档通过覆盖它。
  固定题目、源码、rubric、checker与4+4预算均未改；该运行已封存。
- 长会话实际模型验收通过：8轮讨论，独立进程重开恢复，1次摘要，再重开后1次续聊。
  早期6轮确实在摘要替换区；更正后的日期/预算、禁止改动/外发、否决方案、待定事项及未执行状态，
  共10个最终字段全部正确。恢复本身发0次模型请求，原始记录仍在；总共10次HTTP200、零重试。
  首次摘要被私有runner错误要求空工具请求仍带`tool_choice:none`挡在HTTP前（只发了前8次）；
  按现有codec契约修正runner、离线复核后，用新账本复制并恢复原会话，只补摘要和续聊2次，没有重跑8轮。
  这是一例摘要保真证据，不是长期可靠率或缓存节省承诺。生产压缩实现未改。
- 编辑闭环的离线预检发现Homebrew Node兼容别名元数据被sandbox丢弃；仅扩大公共库目录仍失败，
  已局部修复为host明确别名及祖先的metadata授权，数据仍绑定已验证真实目标。真实OS29项、shell11项、
  shell eval7项通过；实际Node26启动通过。安装版编辑/检查/undo的真实模型验收已通过，见下。
- 联网预检确认系统DNS和独立UDP resolver均返回198.18虚拟IP，原地址检查正确拒绝。
  明确Cloudflare DoH后仍验证全部公有A地址、固定目标IP与原域名TLS，真实Example Domain读取通过。
  候选接入为host显式`web.dns: "cloudflare-doh"`，默认system，不改DNS/代理系统设置，
  不放宽公有地址/origin规则，不引入浏览器或新依赖；详见web文档和ADR0029。完整runtime、安装和真实RFC任务现已执行，见下。

整合检查保留一次本机默认 `npm run check` 的失败：类型和Biome通过，11项在5秒原超时下失败，
全部位于多进程/真实解析用例；其他2232项通过。未改超时、断言或跳过用例，随后用4个worker
重跑同一全套测试，**103文件/2243项全部通过**；没有更改仓库并发配置。原CI仍按原配置执行。

PR #28 产品 `487ccfb4f434952a63a890582dec3651e0751e0d` 的
[原CI](https://github.com/Peerframe/moyyi/actions/runs/40344895500)全部成功；
`npm run verify:package -- --offline` 干净打包、CLI/client/PTY、文档七格式/报告/读回、隔离和依赖图通过。
本机已安装tar SHA256 `8d8864f0a316cddbcb327f1505451c24ff3b3385b3c94ffd5b1b745d661c07db`，
360文件逐字节核验；会话/配置备份为 `~/.moyyi/backups/pre-pr28-2026-10-26T15-04-33.004Z`，
旧包保留，现有会话resume/help/exit通过。原host、manager、启动器字节未变，安装零模型请求。

- 真实编辑闭环：公开listener-leak fixture，正常工具修复→原生沙箱执行固定checker→逆序undo两次。
  修复前监听器3/3且仍响应，修复后0/0且静默，撤销后原故障恢复；原字节/权限、未改文件、固定checker、
  外部canary全部核验。8次HTTP200、零重试。没有把model生成JS拿到未隔离宿主执行。
- 实际联网：安装版通过显式DoH完整读取RFC8259（28,360字节、16页、HTTP200、未截断），
  4次请求内create+readback。5项指定事实和节号/引文均正确。初稿额外混入JSON.stringify与重复键的
  两处不准确扩展，不能称全文首次无误。人工指出后另4次正常edit删除，独立核对实际修订文件；
  模型连续3次edit后没有readback，runner正确拒绝该轮完整通过。初稿、修订稿及失败均保留，停止追加同题请求。
- 独立解释诊断：把原题已实际收到的9份工具结果和原错误答复交给一次独立复核，不补缺失代码/标准答案。
  1次HTTP200，8,192输出token全部为reasoning，无答复，按原限制停止、没有发第二次修订。
  此诊断不改变原题分数，也不支持往生产加入强制review框架。相关维护中公开方案已经查阅；
  当前先交付已证实有效的工具/入口，再用代表性任务推进准确性，避免同题循环。

PR #28 的最后证据头 `947dc6e` 独立复核无阻断，
[该头CI](https://github.com/Peerframe/moyyi/actions/runs/40349596700)成功后按授权合并；
main为 `86dc4337ea117656595af3d999da42e462051af6`，
[合并main CI](https://github.com/Peerframe/moyyi/actions/runs/40350509270)成功。

### 日常CLI入口（当前候选）

独立分支 `codex/daily-cli` 从最新main创建。正常CLI新增显式工作区写入、只读沙箱命令、
当前Node工具链、精确网页origin/DNS和请求上限选项；默认host不变，自定义policy/既有capability冲突拒绝。
`--allow-write`只开放有快照的文件工具，不把命令变为可写；命令模式进审批digest和执行重查。
Node探针复用现有文档解析逻辑，只授权当前可执行文件、实际启动库及精确别名，不开放整个Homebrew。
真实effect与tool_result匹配后才显示路径/snapshotId或命令退出回执，不把模型文字提升为验证证据。
见[ADR0030](../decisions/0030-explicit-daily-cli-grants.md)及[CLI说明](../cli.md)。

- 原 `npm run check`：类型、Biome、105文件/2287项全部通过；未改原阈值/并发/判分。
- shell相关71项、文档47项、CLI回执36项、CLI参数31项、host授权4项通过（有重叠，不累加成独立总数）；
  `eval:shell`7/7、`eval:documents`4/4通过真实原生沙箱/7格式。新增模式Linux行为仍待原CI。
- `python3 scripts/verify-cli-pty.py` 6/6：原5项+真实主CLI使用startup grants，经TTY审批create、
  只读Node检查（工作区写入/外部修改/继承canary拒绝）和按真实snapshot undo；目前是源码入口与合成模型。
- 代码范围分工后相互复核无阻断；默认authority和零重试不变。当前产品修改无新增付费调用。
  本机manager候选66项离线参数/execve/非交互/Key隔离检查通过，现已备份后应用。
- [PR #29](https://github.com/Peerframe/moyyi/pull/29) 产品 `0a539c71c4898ede49b4a4c2959807adb6788563`
  的[原Linux/macOS CI](https://github.com/Peerframe/moyyi/actions/runs/40353835298)成功。
  `npm run verify:package -- --offline` 干净包及实际独立安装PTY6/6、CLI/client、文档/隔离/依赖图全部通过。
  首次打包前漏暂存一份已测试的CLI集成测试，回执正确标dirty；该回执保留，补提交后重新干净验证，
  不把dirty包冒充干净证据。两次产物相同，最终tar SHA为
  `b57fd5e96730a0e53c1d5df67a1a2a63cc65fcf2789a219a03e7686881490554`。
- 本机363文件匹配；备份为 `~/.moyyi/backups/pre-pr29-2026-10-26T15-58-35.624Z`，旧包保留。
  生效manager已更新为经过66项测试的候选，host/模型/档位/默认权限不变；实际安装PTY6/6、
  老DeepSeek会话resume/help/exit、metadata-only配置检查通过，这些步骤零付费/零Key值读取。
- 2026-10-27正常 `moyyi-deepseek start` 真实任务：Flash+Responses+low，CLI明确8次上限，
  实际记录5次预算attempt和5份assistant请求，无retry notice；只批准city.js编辑及
  `node check.cjs`（只读Seatbelt、无网络）。打开时3/3监听器且能响应，dispose后0/0且静默；
  同一引用注册/移除的修复代码独立检查正确。最后edit之后实际checker和完整1060字节/35行readback
  均进入后续模型上下文；实际文件/快照/SQLite哈希一致，checker、其它输入、权限和外部canary未变。
  此入口没有HTTP拦截，不声称抓到了HTTP200或实际wire。
- 原私有runner在最终核对时错误假设默认全文read也有可选`lineRange`，保留其failed-no-replay账本和错误。
  没有重跑live或增加请求；独立离线补验按两种既有read契约检查，严格逐字节（不trim换行）、元数据、
  顺序、快照和context送达；显式range历史见证与6个篡改/截断反例也通过。补验结论是本次真实入口单例通过，
  不改原冻结账本，不把运行结束当作成功。实际结果、完整报告及代码在
  `~/.moyyi/acceptance/daily-cli-2026-10-26/live/supplemental-verification.json` 与 `review.md`。
- live前还修复了私有PTY driver的无界TERM等待，实际忽略TERM进程组在7.1秒内被KILL并回收；
  最终安装版离线预检5次scripted、拒绝checker修改/任意curl、正常edit/check/readback通过，之后才发唯一live。

当前余下是本PR证据提交的CI和顺序合并。安装运行代码不随纯证据文档更新重复替换。
复杂源码题的原失败继续保留；本次入口单例通过不建立广泛编码可靠率，也没有公开发布。

私有证据仍放在 `~/.moyyi/acceptance/`：`regression-2026-10-26-daily`、
`daily-work-2026-10-26`。保存真实请求/输出和失败记录，不提交凭据、会话或私人录制。

## 版本、交付与边界

- 2026-10-26 owner 已另行授权复核后合并 PR #25/#26；固定 head 均无阻断，原 CI 成功。
  顺序 squash 后主线为 `3d3beff1d70c66d4da566fbc81353e253176d7e5`，
  [合并后的 main CI](https://github.com/Peerframe/moyyi/actions/runs/40314574140)成功。
- 当前独立功能分支 `codex/document-reading` 基于上述 main，范围是七格式文档正文读取和
  两道真实任务的离线准备。新功能 PR 不自动合并，不公开发布。
- 初次实现/安装阶段未读取Key或发付费请求。Owner随后对文档真实验收回复“允许，不限制次数”，
  本轮文档测试与必要复测不再限制总次数；首个冻结基线仍按文档对照4+报告4执行，8次后已封存。
  历史原题额度仍封存；原题4+公共题4回归属于另一组，未混入本次文档结果。Flash + Responses + low、
  零重试、原checker及PR不自动合并/不公开发布边界保留。
- 安装前备份会话/配置，保留旧包；日常只读/max3/零重试及已有导航设置保留。旧安装
  `6931296` / SHA `12b2aee9c116e432ab23780c32c793adc094708995dc7d7f393a1ac1fe3774a5`
  的244文件验收是历史基线，不冒充文档候选证据。
- 后续依次是受控修改/撤销、长会话恢复、联网真实任务；再按需安排OCR、MCP、GUI、记忆。
  本轮不自动开工这些内容，也不开始Qwen/shasha训练。

## 文档候选当前摘要

工作目录 `/Users/yxflc/Project/moyyi`，分支 `codex/document-reading`。
新增 `documents` / `read_document`、非持久化只读端口、受控完整字节快照及哈希、独立原生沙箱
解析器；支持PDF、DOCX、XLSX、PPTX、ODT、ODS、ODP。提取行号、来源与截断明确分开。
依赖/打包调整与OpenBot固定提交来源见[ADR 0028](../decisions/0028-bounded-document-reading.md)
及[复用记录](../openbot-provenance.md)。不修改persisted、不引入OpenBot控制面。

目前可复用证据：Mac七格式真实解析；实际Seatbelt进程正常执行同时拒绝相邻文件/合成凭据
读取与改写、网络和继承环境；文档eval4/4通过实际SQLite和文件（脚本模型4请求读→写→核对→
none，并验证默认写拒绝）。这不等于真实模型理解能力。最终本机 `npm run check`：类型、Biome、
102个测试文件/2167项全通过；188个本地文档链接通过，未改变原任务判分与任何预算。
首轮远程CI的macOS文档/安装通过，Linux捕获运行库探针把vDSO虚拟对象误当磁盘路径，
已改为只把绝对路径用于文件授权，不给虚拟对象任何文件权限，并新增反例。
第二轮Linux CI的三个生命周期测试使用了沙箱内PID检查宿主进程，得到EPERM；
测试改为从真实launcher子树映射宿主worker，仍要求worker、launcher及进程组全部ESRCH，
没有把EPERM算通过或跳过Linux。生产终止路径未改。
第三轮Linux的完整check和conformance已过，安装图检查发现canonical lock漏记canvas的libc
条件，错误要求glibc系统安装musl变体；按已核对integrity的官方1.0.9 metadata补5个字段，
版本和依赖边完全不变。原严格图检查不变，回归覆盖两种libc、适用依赖缺失和版本漂移。
本机一次完整重跑出现既有development watcher通知超时；没有改实现/等待阈值/并发或断言，
随后该用例加沙箱定向12/12、默认完整check2160/2160通过，保留该次失败事实。
安装验收与固定文档题改用完整应用生成文件：ReportLab/python-docx/openpyxl/python-pptx/LibreOffice，
14/14成熟reader复读和实际解析成功，独立再生14/14字节hash一致，文档eval4/4再次通过。
原最小容器保留为定向边界测试；生成器不进入产品或CI依赖。
最终产品提交 `e64fa0e26839cb913a7f7b90b900c65f10fe0597` 的
[Linux/macOS CI](https://github.com/Peerframe/moyyi/actions/runs/40329152425)全通过；
[PR #27](https://github.com/Peerframe/moyyi/pull/27)尚未合并。`npm run verify:package -- --offline`
干净提交通过9个安装文档场景（19次合成请求，含七文档→报告→读回）、CLI10/client10/PTY5、
类型、卸载及实际原生隔离，local/global依赖图均41包80边与源码锁一致。

已从该包更新本机：SHA256 `469c6012258c2090523ad6cfedac7093e4d538fd10d2d06a7b0cd20f1e158ae7`，
357文件逐字节匹配。会话/配置先备份到 `~/.moyyi/backups/pre-pr27-2026-10-26T13-20-32.003Z`，
旧包保留；启动器和host/manage字节未变，日常仍只读/max3/零重试。实际全局安装再次通过9个
文档场景、Seatbelt隔离、依赖图、元数据配置检查及已有DeepSeek会话resume/help/exit。
本机回执为 `~/.moyyi/reviews/installed-documents.result.json` 和
`~/.moyyi/reviews/document-startup.result.json`，安装记录及用户说明已更新。
这些安装检查全为离线脚本，真实请求/Key读取0。随后新增授权下的文档真实验收见下一节。
最后的交接补证提交只更新状态文档，不代表另一个产品安装。下文原来的调查优化与失败记录保留为历史，不能把旧状态当作当前授权。

## 文档真实任务验收（2026-10-26）

Owner明确授权文档测试并取消总请求次数限制；没有增加合并/公开发布授权。先执行已经冻结
的4+4基线，不改题目、公开文件、事实、checker或每题120秒。实际使用本机已安装的
`e64fa0e`（357文件再次核验），仓库证据基线为 `ecbb095`，Flash + Responses + low。

- 两道固定题各1次，**原checker 2/2通过**。事实对照生成实际 `comparison.json`；汇总生成
  实际 `report.json`：批准合计 **5,500 CNY**，5个批准项目、2个阻塞项目，最早批准截止日
  **2026-11-03**。两份文件均含7条准确来源hash/完整原句引用，均通过正常文件工具读回。
- 共 **8次HTTP 200、零重试**，每题4次；两题分别约27.1秒/19.7秒。14次document read成功，
  2次create及2次read成功，结果进入后续模型请求。全部7份输入字节不变，外部canary未变。
- 两题第2轮均尝试shell，被策略拒绝；随后改用create+read完成。拒绝真实发生，没有执行shell，
  也没有临时放宽权限。这是一次工具选择浪费的非阻断观察，留在当前记录；不为这两题加特殊提示。
- 请求体合计150,810字节。返回用量：input33,204（其中cache17,664），output5,753
  （其中reasoning2,019，不重复加算）。按当时[官方闲时价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)
  估算 **¥0.03890528**，不是已核对账单；没有查询账户余额/账单。凭据只读取1次，值未写日志。
- 真实请求前新runner离线27个guard/evidence/approval/candidate检查通过，模拟8次、两题checker
  2/2通过且网络/真实Key读取0。首次适配遗漏maxRequests映射在请求预留前失败（0次），修复后通过；
  失败证据保留，没有改任务上限/超时/判分。模型首次请求仅给任务、文件路径与工具schema，无参考答案。
- 真实runner通过现有runSuite和原task.check判分；fixture目录中的说明README被省略，七份正式
  文档字节、instruction及checker不变。写权限仅允许当前临时目录的指定JSON文件，原日常host不变。
  所有临时工作区已清理，生成报告、请求、工具记录和账本在本机保存；账本封存，不自动重跑。

本机复现入口为 `~/.moyyi/acceptance/documents-2026-10-26/run.mjs --preflight` / `--live`
（用Node执行，live需要新批准与独占账本；已完成目录不能再次live）。计划SHA256为
`0c9a0e93f0ac5eb8b282ba3fd6214d0bc9a5a4ac067aae50e7bd21ac672cbbe5`；实际文件在同目录
`live-evidence/comparison.json`、`live-evidence/report.json`，结果在`result.json`。
私有录制、凭据与会话不提交仓库。后续证据提交只改文档，不需要重装相同运行代码。

本次证明两道小型固定文档任务可完成，不是大文档/OCR/一般任务可靠率，也不能覆盖原源码题和
原公共题的历史失败。原问题回归、第3/4项、训练等仍未启动；没有理由为已通过的这两题继续消耗请求。

## 本次交付状态

第一层已完成并通过离线验收，产品提交 `520ef829e96a9892a5bcd3c4547f58cfc7da8378`，
PR #25 交付记录 `8b74bed`；[完整证据](https://github.com/Peerframe/moyyi/blob/8b74bed/docs/tasks/2026-10-26-investigation-navigation.md)。
默认 check 1929/1929、文件场景 13/13、指令场景 31/31、DeepSeek 离线 18/18，
实现 CI 全通过；干净安装包 238 文件逐字节匹配，本机五个导航场景 5/5。
该轮本机更新到该产品提交；后续安装版本见下方修复。原配置/数据保留，Flash + Responses + low 不变。

第一层关闭了精确文件、筛选、文件发现、可操作错误四类缺口，该轮没有付费调用。
第二步已执行两道固定真实任务，见[完整结果](https://github.com/Peerframe/moyyi/blob/6eeb61ef0881d4dc4db85e0c54c62281c62fb6c7/docs/tasks/2026-10-26-fixed-multitask-evaluation.md)：
原题与公共 source-dataflow-report 各4次，Flash + Responses + low，合计8次HTTP 200、零重试。
两题原标准均失败：原题漏读消费者且反驳已送达的原文；公共题事实正确却没有交付report.json。
答复JSON的独立诊断通过不改写文件验收失败。原题历史上限8次，本次4次，不能声称同预算提升。

按确定证据修复的是仓库eval host漏传推理档位，提交6eeb61e；check 1941/1941、runtime10/10
通过。本轮真实运行已显式low，不能把helper修复当作事实错误根因。此修复不进入运行包；
新干净包与本机238文件逐字节一致，CLI正常，host字节未变，无需重复安装同包。
第二层的有界诊断已交付，任务可靠性尚未达标；第三层用户成果未开始。

Owner 随后要求实际查 GitHub 并完成优化。产品提交 `c3b128b1b9865bf191b291fa2a3c2b0584888dfe`
已经落实并安装：[ADR 0026](https://github.com/Peerframe/moyyi/blob/c3b128b1b9865bf191b291fa2a3c2b0584888dfe/docs/decisions/0026-readable-evidence-and-action-budget.md)
固定 OpenCode、Goose、Aider 的源码与测试版本。fs read 现在分开元数据和编号原文；DeepSeek
使用原生文本数组消除模型可见的重复 JSON 包装；预算 notice 明示最后工具机会，保留最终
none 和硬限额。不是针对原题塞答案，没有复制上游代码、增加框架或改变模型/档位。

本机限定并发完整测试1993/1993；[原CI](https://github.com/Peerframe/moyyi/actions/runs/40289557220)
全部通过（Linux1992通过/1既有平台跳过），原conformance与打包门槛保留。本机默认check的
已修CLI容量回归和既有并发超时也保留在PR记录，未扩大容量/超时或删断言。干净包241文件
逐字节匹配本机，CLI10/client10/PTY5、安装版3场景和实际已有会话恢复/help/exit通过；
新安装SHA为 `ea42056f9eabafe42f8096036b0c10b50da65e028ad83d3967ca6817d25b740a`。
这些是产品行为证据，不能当成模型事实正确率。旧8次账本保持封存。

Owner 随后单独批准新8次（4+4、零重试）；已执行并封存，全部HTTP200，原生工具结果真实
续接通过，源码未变。[本次完整记录](https://github.com/Peerframe/moyyi/blob/a04707c1ca37f35d7f1d1d916b4a44c84f128318/docs/tasks/2026-10-26-readable-evidence.md)。
原题六项3通过/3部分：原文保留和mtime解释正确，仍缺完整消费者链路、选择改变需重建runtime、
不自动读引用/运行脚本的明确说明，另有默认权限的错误外推。公共题11事实正确却仍无report.json。
第3次才读取源码，第4次收到结果时已none；最后工具机会提醒没有修复自主行动安排。
现有工具可按发现→批量读→写→答复在4次内完成，不能把失败归因给必然不足的次数或写权限。

两题仍按原标准判失败，不能以临时副本投影JSON通过checker冒充交付。单次观察不能证明
稳定改善或归因给某一个改动。新授权剩余0，不追加请求或再申请预算；传输联调已完成，
剩余定位到证据链闭合、默认行为核实及依赖步骤安排，不预先把新工具/完成hook/提醒当作答案。

后续只针对已观察的发现过晚继续修复，仍在第二层范围内。依据
[ADR 0027：显式启用的有界工作区路径导航](https://github.com/Peerframe/moyyi/blob/69312969533659578cc1da21b510d8395a099ef3/docs/decisions/0027-bounded-workspace-navigation.md)，
核对 Aider 请求前 repo-map、OpenCode todo 和 Goose stop hook 后，选择现有 context-source
扩展点，不引入 SDK、语言服务、完整索引、计划框架或额外模型请求。产品已提交6931296，
精确版本和验收坐标由 PR #25 的[交付记录](https://github.com/Peerframe/moyyi/blob/69312969533659578cc1da21b510d8395a099ef3/docs/tasks/2026-10-26-readable-evidence.md)更新。

- 受信 host 显式设置 `workspaceNavigation: true` 才启用，库默认关闭。开局及每次请求
  提供当前工作区的相对文件路径；不给源码摘要、依赖结论或原题答案，模型仍通过正常工具读源码。
- 路径扫描保留 protected、ignore、非别名和工作区边界，分别检查 list/read 及插件两个阶段的
  限制。缺少授权、ask、deny 不变成自动批准；根目录或必要 ignore 读取受阻时表示未知，
  子目录受阻明确标为部分结果。只读必要的有界 `.gitignore`，不读取普通源码正文。
- 最多 200 路径、8,192 序列化结果字节、4 层、10,000 条目和 64 个已准入目录；同次收集
  共享冻结结果，下次重新扫描，撤权、取消和收集结束使端口失效。非原子快照、截断时依赖
  目录枚举顺序的限制保留；路径未出现不能证明文件不存在。
- 导航是整段可选 context。容量不足只能舍弃明确可选段，不挤掉必要指令、历史或工具，
  不扩大原 10,000 容量门槛。压缩审查发现可选段的加入/省略会误计压缩收益，已改为压缩前后
  都仅比较 required context；不能把导航被省略当作摘要缩短。
- 新离线场景使用原公共题 fixture/checker、实际 runtime、SQLite 和文件工具，合成模型按
  read→create→verify→最终 none 在 4 次内交付 `report.json`，无关 write 仍被拒绝。
  这是可行交付路径和权限的接线证据；模型步骤手写，不能算自主选择、事实正确率或真实题通过。

最终默认 `npm run check` 的 typecheck、Biome 和 **2056/2056**测试通过；
`eval:instructions` **32/32**、`eval:files` **16/16**、`eval:core` **21/21**、
`eval:deepseek` **18/18**、修复后 `eval:long-sessions` **4/4**通过。
压缩定向44/44覆盖两种变长拒绝和真正缩短后重新容纳导航。一次新增万条目夹具在并发
建文件时超时，已保留真实目录/ignore，仅模拟被忽略条目并断言恰10000次停止；未放宽
5秒超时、原并发、容量、扫描上限或检查标准，随后完整复跑通过。

[精确提交CI](https://github.com/Peerframe/moyyi/actions/runs/40305112704)全部通过，
干净包 `npm run verify:package -- --offline` 通过CLI10/client10/PTY5/严格类型/卸载。
本机已安装 `69312969533659578cc1da21b510d8395a099ef3`，244文件逐字节匹配包SHA256
`12b2aee9c116e432ab23780c32c793adc094708995dc7d7f393a1ac1fe3774a5`。实际安装版四轮合成场景通过原公共checker、拒绝无关write，
已有会话恢复/help/exit通过。会话与host先备份，然后仅增加 `workspaceNavigation:true`；
Flash+Responses+low、日常只读/max3/零重试不变。以上均为离线接线证据，不是真实答题结果。

本轮真实请求及 Key 读取均为 0，旧两轮各 8 次的账本保持封存，不复用或增加调用额度。
原题仍缺消费者链路/配置生命周期闭合及默认策略核实，公共题的上一轮真实文件交付仍失败；
本次导航没有证明它们已被模型自主解决。原题、固定源码、六项标准、公共 checker、
Flash + Responses + low、请求硬限额和最终 none 全部保留。

上述为合并前的历史记录；PR #25/#26 已按顶部新授权合并，仍没有公开发布。下文保留当时约定的范围与验收条件。

## 整体路径与判断依据

已重新核对[架构](../architecture.md)：用户从 CLI/客户端发出任务，可信 host 选择模型、
凭据、权限和限额；runtime 组合 core、context、store、policy 和插件。模型读到的结果经过
工具 schema、准备前权限、执行前策略/审批和受限 capability；core 记录请求、工具结果及预算。
最终答复还需要独立核对，正常结束和成功工具调用都不是事实正确的证明。

当前有两类独立缺口：一类是精确定位、过滤、文件发现和参数错误的工具接口缺口，已有
无模型合成探针复现；另一类是模型读到证据后仍作出错误结论，已有真实回答记录。
本轮已经修复前一类，同时补齐可复用的离线行为证据，不承诺因此自动解决后一类。
上游研究支持完善工具接口和评测；关系图、计划状态或第二个 Agent 本身都不能证明事实。

## 第一层：本轮交付可用、可核对的调查工具接口

用户结果：能指定真正想查的文件范围，在既有限额内得到可定位的材料，并在参数有误时
知道该修正哪个字段。只在现有文件能力、fs 工具与参数验证入口实施：

| 本轮内容 | 必须保留的语义与验收 |
|---|---|
| 精确文件或目录作为搜索范围 | 精确文件只查该文件，不扩大到同目录；目录保留既有遍历/忽略规则。用相邻同名命中验证范围；缺失路径返回明确错误，合法零命中返回可识别的空结果。 |
| 有限的 include/exclude glob | 模式数量、长度与支持语法明确且有界；按明确相对范围选择。不给被保护路径或 workspace 外路径授权，不默认排除测试；无过滤参数保持兼容。 |
| `files` / `content` 搜索模式 | 文件模式按命中文件去重，内容模式保留原文、行号和范围。有效范围、截断和省略可见，模式选择不增加扫描、返回或执行预算。 |
| 字段级安全 schema 错误 | 给出可操作的受控字段/约束提示；不回显任意参数值、私有文本或整份内部 schema。非法输入仍在 prepare/I/O 前被拒绝，错误信息受界限约束。 |

`contextLines` 保持 0–20；保留全部既有请求数、输入/输出字节、扫描、文件、时间及取消约束。
继续 Flash + Responses + low。不改提示词、core loop、`src/contracts/persisted`，不增加 LSP、
关系图或更多 Agent，也不借用不受限 shell 绕过 read capability。

离线验收必须经过实际工具入口、临时真实文件及必要的 runtime 接线，覆盖正例和近似错例：

1. 精确文件旁存在匹配 sibling、过滤前有大量测试命中、多个命中属于同一文件，分别证明
   范围不扩张、选择有效、文件发现去重；同时验证默认模式兼容及合法/非法 glob 边界。
2. 输出原文/行号/范围与 fixture 精确比对；边界、截断、零命中与输入错误有可区分结果。
   继续拒绝受保护路径、逃逸、符号链接越界以及撤销/取消后的访问。
3. 字段错误确实提供可操作信息，但不泄露攻击者输入或私有值；非法调用没有进入 prepare。
4. 复用现有多题和 source dataflow/lifecycle 的 fixture、checker 正反例、真实语义探针；
   不改原私有题和答案标准。脚本模型只验证接线与信息送达，不能记为真实模型答对。
5. 运行改动相关检查、现有完整 `npm run check` 和必要离线行为门槛；在 PR #25 记录具体
   提交、命令、结果、未测项。计划本身不提前标记这些检查为通过。

**退出条件：**四类接口缺口均有可复现的修复证据，原权限/限额/兼容检查不退化，现有评测
标准不放宽，PR #25 有完整验收记录。达到即交付这层；明确真实多题质量仍未测，不能用
继续堆单元测试代替它。本轮计划文档通过 PR #26 交付，不需要等待真实调用才完成。

## 第二层：固定诊断已交付，整个 Agent 的质量仍待改善

用户结果：对不同任务给出有证据支持的正确结论，而不是只在同一道题里减少一次错误。
在第一层证据齐备后，固定原项目题与代表性任务选择：候选中的 source dataflow/lifecycle，
以及现有研究、数据一致性任务。选择与旧/新版本比较均在运行前固定，不看结果换题。

先核对实际能力：有些研究题必须写 `report.json`，read-only 配置不能当作支持；Git history
仍受保护。使用相同的支持能力、源码/fixture、模型/API/low、原题限额和 checker；不支持、
工具错误、证据缺失、解释错误分别报告，不把不支持算成通过或隐去失败。
记录工具实际交付的证据、最终事实、错误成功声明、请求/字节/用量和版本。原题仍需全部六项。

**退出条件：**有一份可复核的固定多题结果，能说明改善了什么、未改善什么及失败所在层；
没有达到原标准的题仍判失败。一次成功不称为稳定可靠，未做重复试验就不报告稳定性。
只有某个具体疑问仍需比较时，才按[现有比较协议](../research/harness-comparison.md)
使用兼容的成熟 harness；不把新增 baseline 框架设成本轮前置条件。
本轮已按新授权完成上方固定两题诊断，满足可复核结果的退出条件，不等于任务可靠性通过。
固定原题、公共题和标准继续保留；原source-lifecycle题本轮未执行，不计入已测任务。
当前已围绕发现→读取→写入→确认的具体缺口实施上述 opt-in 路径导航，并用原 checker
离线核对实际文件交付；compaction 修复、原CI、干净包和本机验证已完成。若之后进行真实对照，
仍须事先固定相同预算和判分并具备新的有效授权，不能用脚本结果替代。此8次授权已结束，
不能扩大或重开账本。

## 第三层：后续验证编辑、长会话与联网成果

| 用户结果 | 下一有界验收与退出条件 |
|---|---|
| 安全修改项目并确认有效 | 在固定任务中完成修改、实际检查、展示可审差异和撤销；核对授权、文件状态及检查结果。离线 write/shell conformance 不能替代真实模型完成这些步骤。 |
| 长任务恢复后不丢关键事实 | 固定多轮任务跨 resume/compact，核对已知事实、未完事项和后续结果；既有崩溃/存储检查继续保留，不能用脚本生成的正确摘要代替模型质量。 |
| 联网研究得到可追溯结论 | 先验证实际服务可用，再核对来源、权限、时效和最终事实；Anthropic、SearXNG 的真实服务证据分别记录，浏览器/二进制文档不冒充已有能力。 |

这些是后续产品结果，不是本轮同时开启的实现任务。GUI、MCP、memory、额外模型及 shasha
训练继续按 roadmap 保留；OpenBot 只复用解决已证实问题的经验或小模块，并记录来源。

## 何时停止无效迭代

- 所需证据已经完整到达模型，但结论仍错：停止扩大搜索上下文，转而隔离解释与答案构造。
- 工具接口达到约定行为，却没有改善实际证据选择：保留结果，检查剩余缺口；不凭猜测增加
  LSP/图、更多工具或请求次数。新方向必须解释要解决的具体失败。
- 原题偶然答对、其他任务未改善：不宣称通用可靠，也不继续给该题追加提示规则。
- 安全或限额回归：修复或缩回有问题的实现，不放宽权限、checker 或标准换取通过。
- 第一层的有界离线验收完成：结束该层并交付，保留可用候选与未验证项；不把未来全部验收
  变成本轮的无限检查清单。

执行后只更新系统总览的相关版本/证据行和本次 PR 验收区；不再复制一份“当前待办”。
