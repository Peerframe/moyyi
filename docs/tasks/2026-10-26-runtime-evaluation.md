# 真实 runtime 任务评测接线交接

## 本轮范围与结果

基线 main `eee3beed4f392112f97c0bbdbd021d583355b6df`，分支
`codex/runtime-task-evaluation`。交付可运行的 `--agent moyyi` CLI 和 programmatic
adapter。实际使用已有 runtime、SQLite、文件权限和原生 shell 沙箱，没有另写 Agent 内核。
每轮关闭 runtime，下一轮加载同一 trial 的会话；每题和每 trial 独立，结束后清理状态。

D1–D6、现有 30 道公开题、fixture、checker、reference、评分阈值全部保留。没有修改
`src/contracts/persisted`、产品 core 或依赖边界。没有读取私有题库、用户 Key 或个人会话，
没有付费模型调用、发布、推送 main 或自动合并。

- 默认 null agent + public corpus；moyyi 必须显式 host、synthetic/live source 和总请求额度。
- live 还需要 `--allow-live`，校验先于 host import。凭据由 host 延迟提供；无环境变量自动发现。
- 额度在调用 model client factory/stream 前扣减，跨 turn/trial 共用，失败不退还，零自动重试。
  它是模型端口尝试数，不代表实际 HTTP 次数、账单 token 或费用上限。
- 默认 read；write/shell 只授权可丢弃的 trial workspace。无网页权限，无 `.git` 放行。
  toolchain 只复制具名只读字段，不能覆盖 workspace roots/approval。
- 最终声明只认最后一轮最后一条 assistant 消息里的严格 `status`/`summary` JSON。
  缺失、歧义或未完成运行记为未知；正常结束不等于成功。声明与 checker 的客观结果分开记录。
- 结果记录 source、模型、权限、额度、声明格式、每题请求尝试数、原始归一化 usage 与判分。
  未知 token 保持 null；未伪造账单或价格。临时原始会话在清理时删除。

实现规则与取舍见 [ADR 0018](../decisions/0018-runtime-task-evaluation.md)，
用法与能力限制见 [runtime evaluation](../runtime-evaluation.md)。

## 验收证据

全部使用 Node 26。执行命令时移除了 `NODE_OPTIONS`/`NODE_PATH`，使用既有本地 Node 26。

- `npm ci --offline --ignore-scripts --no-audit --no-fund`：通过，48 packages。
- `npm run check`：typecheck、Biome 通过，**75 files / 1604 tests** 通过。
  之后仅收紧 toolchain 字段拷贝、增加报告元数据和文档；对这些最终改动再次执行
  `npm run typecheck`、`npm run lint` 均通过。
- `npx vitest run evals/agents/moyyi.test.ts evals/cli.test.ts evals/runtime/runtime.test.ts evals/harness/runner.test.ts`：最终 **4 files / 46 tests** 通过。
- `npm run eval:runtime`：最终 **10/10** 通过；真实 runtime、SQLite、临时文件和 macOS 原生
  sandbox，模型为合成脚本。包括读写、跨轮重开、默认拒写、越界拒绝、suite/trial/跨轮额度、
  失败不重试、取消和 shell。该命令已加入 CI，Linux 证据等待该 PR 的 CI。
- `npm run eval -- --agent moyyi --host ./evals/agents/synthetic-blocked.ts --source synthetic --max-model-requests 1 --task fix-range-off-by-one`：实际 CLI 退出 0、该题按预期 FAIL，
  passAt1=0、falseSuccesses=0、forbiddenEffects=0。合成 host 仅声明不能完成，不做题；这验证
  CLI 接线和未放松 checker，不是模型能力成绩。生成结果仅在 ignored `evals/results/`。
- `git diff --quiet -- src/contracts/persisted src/core evals/tasks evals/harness/checks.ts tests/boundaries.ts`：通过。
- `git diff --check`：通过。

## 尚未验证与下一步

1. 没有真实模型 30 题分数、成本或同模型基线比较。live helper 只验证构造/选择时不读 Key、
   不发 HTTP；真实 DeepSeek 评测另需明确题目、次数与费用授权。
2. read 无法完成要求写结果文件的题；write 缺少建目录/移动/删除/元数据修改；相关题需要 shell。
   `.git` 仍被保护，Git-history 题所要求的历史读取无法完成。先在报告中明确这些限制，不能为了
   分数放宽权限或改题。没有隐藏地跳过这些题并算作通过。
3. 原生 shell 依赖支持的平台和显式可用的只读 toolchain；无网络安装和不受限 shell fallback。
4. 没有基线 adapter、自动能力分类、长会话模型质量结论、真实网页/browser/binary document
   任务成绩。没有将合成 conformance 描述成模型能可靠抵御注入。
5. 下一项独立产品交付优先补本地、显式选择的 Skills：把 OpenBot 可验证的任务方法重写为
   moyyi 的普通指导输入，并保持权限由 host 决定。网页正文提取是另一项可独立集成的实用改进；
   不需要为了等待付费评测再建立新框架。

## 需要决定的事项

本交付不改变 D1–D6，无新增必须先决定的架构事项。真实模型调用、私有题库评测与正式发布仍需
对应范围的独立授权，本轮均不执行。PR 的审查、CI、合并、安装按当前主任务授权流程由主控处理。
