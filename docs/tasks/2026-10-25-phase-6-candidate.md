# Phase 6：可安装候选与客户端协议验收

## 授权与交付范围

Owner 授权：先审查 #15，确认无阻断、CI 通过后合并，再推进 phase 6；按分支和 PR 交付，
新 PR 不自动合并，不做付费模型调用，**暂不正式发布**。目录 `/Users/yxflc/Project/moyyi`，
分支 `codex/phase-6-installable-candidate`，从合并后的 main `cc25e7d36ca23400957a42e69d9d0dae6b98cd6e` 开始。
没有直接推送 main，没有发布 npm 包、GitHub Release、tag 或修改远端保护设置。

本轮可检查结果是可在仓库外安装的本地候选包，以及真实安装后的 CLI／客户端协议验收。
保留 D1–D6、persisted v1、分层规则和原有公共题判分标准。不会把安装验收称为真实模型能力验收。

## #15 审查与合并证据

- 固定 diff：`25aff55` → `a65d0036bfcd5c8b22e177a2dbfed31e4801bbc6`，独立审查无阻断问题。
- `npx vitest run tests/runtime-anthropic.test.ts tests/runtime-web.test.ts src/core/executor.test.ts src/runtime/anthropic-http.test.ts src/policy/web.test.ts`：**66/66，5 files**。
- 独立复核 `npx vitest run src/plugins/provider-anthropic src/runtime/web.test.ts src/runtime/web-http.test.ts`：**138/138，4 files**。
- [PR CI](https://github.com/Peerframe/moyyi/actions/runs/40181990157) 通过后，用
  `gh pr merge 15 --merge --match-head-commit a65d0036bfcd5c8b22e177a2dbfed31e4801bbc6` 合并为 `cc25e7d`。
- [合并后的 main CI](https://github.com/Peerframe/moyyi/actions/runs/40182497442) 通过。
  先前披露的真实 Anthropic／SearXNG、当前公网 DNS 和模型质量验收缺口保留，没有被合并动作关闭。

## 做了什么

- 保留 `private: true`、`0.0.0` 和已有依赖版本；用现有 tsc＋npm tarball，不引入打包框架。
  构建先清理编译输出，排除测试和协议 fixture；完整包清单校验拒绝缺失、多余、重复和旧产物。
  相比原先 dry-run 默认收录的 557 文件，新包收录 **205 个生产文件和使用文档**。
- 提供 `npm run package:candidate`／`npm run verify:package`，输出本地 tarball、SHA-256、
  文件清单／源码 revision／dirty 标记；验收通过才写入 receipt。产物和验收记录均忽略、不上传。
- 包只开放 `moyyi/runtime`、`moyyi/contracts` 两个 ESM／类型入口。Runtime 重新导出既有录制、
  policy 与 API-profile 配置帮助项，安装后的 host 无须导入仓库 `src`。没有新协议服务或权限。
- 将同一 tgz 分别安装到仓库外临时 consumer 和临时 global prefix，禁安装脚本，不接触用户
  现有全局安装／数据。运行时环境去掉仓库 `.bin`、`NODE_PATH` 和额外 Node options。
  在无源码、无产品 TypeScript 依赖的环境运行实际 bin、公共 API 和独立声明文件。
- 覆盖 10 个 CLI 场景、8 个客户端场景、5 个真实 PTY 场景；实际创建／拒绝文件、digest 审批、
  cancel／steer、事件隔离、reload、compact、SQLite 关闭重开和卸载后独立数据保留。
- 安装支持范围限定 macOS／Linux；Windows 默认拒绝。不替用户安装 OS 沙箱、不放宽既定安全边界。
  使用、取舍和范围见 [安装说明](../installation.md)、[客户端协议](../client-protocol.md)、
  [ADR 0016](../decisions/0016-local-installable-candidate.md)。

## 验收证据

本轮已执行的中间证据与最终结果分开记录：

- `npm pack --dry-run --ignore-scripts --json` 初始基线：557 文件，含 src/evals/tests/scripts，
  证明不能直接把旧默认包当交付。仅查看清单，没有发布。
- `npx vitest run tests/packaging.test.ts`：**8/8**。正例与缺 CLI、意外私有题／`.env`／旧 JS／
  测试代码、重复和路径穿越反例通过；校验规则没有放宽。
- 第一轮实际候选安装验收最终通过：10 CLI＋8 client＋5 PTY、严格 NodeNext types、卸载数据 canary。
  当时源码仍为 dirty，中间候选不是正式发布，也不是最终提交身份。
- 验收器初次发现并修复：npm 不接受 user/global config 指向同一文件；macOS `/var` 与
  `/private/var` 使 file 依赖相对路径失真（已规范化临时目录）；CLI 多行 JSON 汇总不匹配；
  npm 传入的 PATH 含仓库开发工具（已清理并显式定位验证工具）。没有修改产品权限或旧判分。
- 额外使用全新临时 npm cache 验证：`npm ci --omit=dev --ignore-scripts` 不一定缓存新 consumer
  所需的包元数据，随后 offline install 确实返回 ENOTCACHED。默认验收因此采用正常 npm 依赖
  获取；`--offline` 仅用于元数据／tarball 已全缓存的环境。模型和网页验收仍无真实调用，
  npm 依赖下载不是发布或付费模型请求。
- 独立最终审查发现系统临时目录与仓库可能跨磁盘，直接 rename 会触发 EXDEV；已改为将字节写到
  artifacts 内临时文件，再同目录原子 rename，并在失败时清理。没有声称实测外接卷；安装 gate
  继续验证实际产物。其余发布保护／清单／环境／安装验收未发现阻断。

- 最终 `npm run check`：typecheck、Biome **203 files**、**1,373/1,373 tests in 65 files** 通过。
- 变更文档相对链接：**143 个，无缺失**；`git diff --check` 与
  `git diff --quiet -- src/contracts/persisted tests/boundaries.ts evals/tasks evals/harness` 通过。

最终提交的包验收和新 PR CI 在本分支 PR 的验收区记录。所有场景均使用合成输入；
private corpus 和真实凭据未读取。原有 DeepSeek／Anthropic／web／shell／长会话 CI 门槛保留。

## 尚未完成或验证

- 无正式发布、npm 名称／registry 选择、版本 tag、签名／公证安装器、自动更新或 Node 单文件发行。
  候选需要 Node/npm 和第三方依赖。直接依赖版本固定，未来安装的传递依赖解析仍受其版本范围影响；
  本地 receipt 记录实际版本，不承诺跨平台字节级可重复安装或发布者身份认证。
- macOS 本机与 Ubuntu CI 的证据不扩展到未测 OS／架构；Windows 不在支持范围内。原生沙箱的
  Mac 脱离进程组后代、宿主硬杀等限制仍保留。安装包不会自动安装或授权 shell／web 能力。
- 无真实模型服务调用、真实模型任务分数、真实签名／缓存／费用测量、SearXNG 端点验收或当前
  DNS 环境下的公网可用性证明。原计划 `project-instructions` 和 phase 1 真实验收仍是既有缺口。
- 客户端入口是 trusted-host 的进程内协议，不是经过认证的远程协议或稳定正式 SDK。

## 需要 owner 决定

本轮本地候选无需新 D 类决定；新 PR 保持未合并。后续是否正式发布、渠道／包名／版本、签名与
支持平台，以及真实模型验收授权／预算，要另行决定。当前没有启动这些动作。
