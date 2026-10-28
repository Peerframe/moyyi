# 交付二：桌面端插件化

- 日期：2026-10-29。
- 上级计划：[M6 之后的计划 v2](2026-10-28-post-m6-plan.md)，即 v1 的决定 D-C。
- 执行：Codex。M6 合并后，从最新 main 新建分支 `codex/delivery-2-desktop-modules`，整块实现，
  一个 PR。可以和交付一并行。
- 审查与验收：Claude。

## 1. 目标

把桌面端从“几个大文件包办一切”改成“每个功能一个模块，外壳只负责组装”，并兑现
[ADR 0005](../decisions/0005-plugins.md) 约定的“界面插槽”。这样以后加设置、Skills、搜索、记忆等
功能时，原则上只新增一个模块加一行注册。

本交付**不改任何用户可见行为**。

M6 之后的现状：

- `apps/desktop/host/service.ts` 约 1391 行，其中 `dispatch()` 一个方法就有约 1080 行，按事件和动作
  种类分支处理所有功能；
- `apps/desktop/main.ts` 约 644 行，注册 13 个 IPC 通道（`moyyi:state`、`act`、`workspace`、
  `configure`、`permissions`、`web-permissions`、`documents`、`import-files`、`paste-image`、
  `save-artifact`、`report-target`、`reveal-artifact` 等）；
- `apps/desktop/shared.ts` 约 372 行，所有功能的类型放在一起；
- `renderer/App.tsx` 约 648 行，持有大部分界面状态。

以上行数以 M6 合并后的实际代码为准。

## 2. 参照

DSH 固定提交 `f3803c96974ad4a94195fb97e5c637e9c2a3afe3`：

- `docs/subsystems/conversation.md`：会话节点的事件定义、视图定义，按 key 注册渲染器；
- `docs/subsystems/client-modules.md`：客户端模块如何声明和组装；
- `packages/client/ui-*`：每个界面功能一个包（审批、附件、会话、设置分区、侧栏等）；
- `.agents/skills/dsh-client-ui-ux/SKILL.md`：反馈放在哪里、先复用再新增。

只借鉴组织方式。不引入 Cordis，不做运行时动态加载或第三方界面插件。moyyi 的功能模块都是仓库内
代码，在构建时注册。

## 3. 目标结构

```text
apps/desktop/
  main.ts              窗口、安全设置、遍历功能模块注册 IPC（只做组装）
  preload.ts           单一类型化桥接，通道清单来自各模块的契约
  host/service.ts      连接 runtime、持有状态、把事件和动作路由给功能模块（只做组装）
  features/<id>/
    contract.ts        本功能的动作、状态片段、IPC 通道类型和校验
    host.ts            主机侧：处理本功能的动作，响应 runtime 事件，产出状态片段
    renderer/          面板、对话框、会话节点渲染器、设置分区
    README.md          做什么、状态、限制
    *.test.ts
  renderer/
    App.tsx            布局外壳，按插槽渲染各模块的贡献
    slots.ts           插槽注册表
```

建议的功能划分，以实际代码为准调整：会话与历史、对话与运行、审批与效果、材料、报告与结果、
网页与来源、设置与连接、权限、维护。

## 4. 规则

1. **功能模块之间不互相导入**，只能依赖共享基础（桥接、校验、设计组件）和自己目录。在
   `tests/boundaries.ts` 加这条规则，并同步 `docs/architecture.md`。
2. **主机侧路由**：`service.ts` 把每个 runtime 事件交给所有关心它的模块，模块只能更新自己的状态
   片段。动作按种类交给唯一的所属模块，没有所属模块的动作直接拒绝。
3. **IPC**：每个通道属于一个模块，由模块契约声明参数校验。`main.ts` 和 `preload.ts` 从注册表生成
   通道清单，不再手写。现有安全约束（来源校验、参数校验、不暴露通用文件路径）全部保留，测试原样
   通过。
4. **界面插槽**：插槽是声明式的，模块只提供“要显示什么”，由外壳负责摆放。第一批插槽：
   - 侧栏分区；
   - 右侧面板；
   - 对话框；
   - 设置分区；
   - **会话节点渲染器**：按记录条目种类或工具名注册，例如审批卡、结果卡、来源卡。

   以后显示 `todo_write` 清单，只需新增一个节点渲染器。
5. **状态**：`App.tsx` 不再持有功能状态，每个功能的界面状态放在自己模块里。

## 5. 顺带完成：交付零的机械检查

- 每个 `.agents/skills/*/SKILL.md` 都有 `name` 和 `description`，且 `name` 与目录名一致；
- `.claude/skills` 指向 `.agents/skills`；
- `AGENTS.md`（所有层级）和 skill 中的仓库内链接都能解析；
- 每个 `apps/desktop/features/*` 都有 `README.md`。

以上加入 `npm run check`。如果交付零还没合并，检查先对空目录通过，等交付零合并后自然生效。

## 6. 文档

- 新 ADR（编号顺延）：桌面功能模块与界面插槽，说明这是 ADR 0005 约定的界面插槽的第一版：
  只支持仓库内模块、构建时注册、声明式插槽。
- 新增 `apps/desktop/AGENTS.md`（如果交付零已写好就补充）：新增桌面功能的步骤。
- 新增 `docs/recipes/add-a-desktop-feature.md`。

## 7. 完成标准（交付结束时统一验收）

1. `npm run check` 通过，包括新的边界规则和第 5 节的检查。
2. M1–M6 的外部包检查（`verify:desktop` 等）原样通过，原有断言不删、不放宽。
3. 原生验收：用安装包完成一次 M6 的完整流程（导入外部文档 → 读取 → 批准报告 → 预览和保存 →
   重启后在历史中打开），全程不发模型请求。附正常窗口和窄窗口截图，与改造前对比无差异。
4. 用户数据和设置在安装前后不变（沿用现有备份和核对方式）。
5. 规模指标（参考，不硬卡）：`service.ts` 约 300 行以内，`main.ts` 约 250 行以内，`App.tsx` 约
   250 行以内。
6. 演示扩展性：PR 中说明“新增一个功能”需要改哪些文件，应只有新模块目录和一行注册。

## 8. 先做完，再集中修复

允许先记下、交付结束后集中修：

- 个别界面细节的视觉差异；
- 测试组织和命名；
- README 缺漏。

必须**立即停下**交给 Claude 和 owner：

- 需要改持久化格式或设置文件格式；
- 需要放宽任何 IPC 或路径安全检查；
- 发现 M6 的行为本身有缺陷。这类问题记录下来，另行处理，不在重构里顺手改行为。

## 9. 不做

- 新功能，包括任务清单的显示（放到交付三）；
- 暗色模式、多语言、视觉重设计；
- 第三方或运行时加载的界面插件。
