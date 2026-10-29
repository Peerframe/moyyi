# 交付二实现记录：桌面功能模块

简报：[交付二](2026-10-29-delivery-2-desktop-modules.md)。从最新 main
`eeff4ec70d89596d7cdcafc23a50d82f8fc8d40b` 建立 `codex/delivery-2-desktop-modules`。
实际工作树：`/Users/yxflc/.codex/worktrees/delivery-2-desktop-modules/moyyi`。
原目录的 `docs/tasks/2026-10-26-optimization-plan.md` 既有未提交改动保持原样。

## 当前结果

候选实现和最终结构修正已完成，源码及外部包检查通过；原生整体验收尚未结束，未替换日常安装。九个模块包括会话、对话、
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
- `npm run check`：154 文件、2981 测试，typecheck/lint 全部通过。初次使用符号链接
  node_modules 导致 36 个解析测试失败；在普通目录仍复现，换成实际依赖副本后解决。
  未改沙箱或断言。另修正全局 artifacts 忽略规则对同名源码模块的遮蔽，并完成该模块格式检查。
- 最终审阅补齐模块自有状态初始化、wire 校验、renderer 动作白名单和弹窗禁发声明。
  10,682 个前后状态输入判定一致；字段 34、命令 33、renderer 动作 25、native-only 动作 8，
  集合逐项不变。隔离扩展试验只新增模块目录和清单一项，实际完成编译、初始化、路由与拒绝检查。
- 修正后 `npm run check`：155 文件、2985 测试，typecheck/lint 全部通过。Renderer 47 测试，
  原五种弹窗的 32 种组合等价，13 态 HTML 仍逐字节一致。
- `npm run desktop:package` 和 `npm run verify:desktop` 通过。最终包来源为干净提交
  `ae2ec180db7e19ea85ec293b4589703800dab69e`；ZIP SHA-256 为
  `e6fefdb44ad04a30aef4de3ee5185b353ecabb63ba9053ed67cf4fecccb31f05`，desktop bundle SHA-256 为
  `e40e160230821d1c11936ee8bb95579b9d4ad2c7d416ac8672188cb6495c9e66`。
- 基线原生导入、读取、批准、预览、保存和重启历史已完成；报告副本逐字节相等，材料保留，
  权限恢复只读，4 次合成请求、0 网络与凭据调用。最初改写 HOME 导致系统 Save 面板禁用；
  正常 HOME 加隔离 worker 数据目录后保存成功，未修改产品行为。
- 最终候选包的原生流程及双窗口截图尚待完成；局部证据不替代最终验收。

## 验收口径

M6 已验收原生尺寸是 1120×800 与 780×560，main 的 `minWidth` 是 780，保持原值。
交付零设计文档/skill 的 560 与实际原生窗口限制不同；CSS 中的 body min-width 为 560，
只能单列为原生支持范围外的渲染诊断。该尺寸下标题栏存在裁切，不列为可用窗口验收，
也不借本轮调整窗口行为。原生窄窗口仍按 M6 的 780×560 验收。
