# 交付二实现记录：桌面功能模块

简报：[交付二](2026-10-29-delivery-2-desktop-modules.md)。从最新 main
`eeff4ec70d89596d7cdcafc23a50d82f8fc8d40b` 建立 `codex/delivery-2-desktop-modules`。
实际工作树：`/Users/yxflc/.codex/worktrees/delivery-2-desktop-modules/moyyi`。
原目录的 `docs/tasks/2026-10-26-optimization-plan.md` 既有未提交改动保持原样。

## 当前结果

候选实现已完成首轮模块提取，尚未完成整体验收或日常安装。九个模块包括会话、对话、
审批与效果、材料、报告、网页、设置、权限、维护。唯一模块清单生成不同环境的静态注册表；
模块不互相导入，主机动作唯一归属，事件按关注列表分发，投影只能写自己的状态字段。
跨模块会话清理保留在共享生命周期协调中。详见 [ADR 0045](../decisions/0045-desktop-feature-modules.md)。

无新依赖、服务、模型调用、持久化/设置格式变化。原有行为断言不删不放宽。
本轮真实模型请求预算为 0；合成提供商请求单独记录。

## 验证记录

- 改造前 host/service、host/m6、main 基线：3 文件 66 测试通过。
- 首轮主机模块提取：service、m6、web-service 共 31 测试通过。
- IPC 原 main/security/wire 与新增 preload 安全检查：59 测试通过。
- Renderer 原 41 测试保留，新增插槽检查后共 45 测试通过。
- 原 main renderer 与候选 renderer 的 13 种状态 HTML 逐字节一致；含初始、运行、审批、
  取消、历史、无连接和五种对话框。首次对照发现并修复迁移引入的空格差异。
- 全量 check、包验收和原生完整流程仍待执行；这些局部证据不替代最终验收。

## 验收口径

M6 已验收原生尺寸是 1120×800 与 780×560，main 的 `minWidth` 是 780，保持原值。
交付零设计文档/skill 的 560 指 CSS 支持范围，与原生窗口限制不同；560 只单列渲染层检查，
不把它写成原生窗口验收，也不借本轮调整窗口行为。
