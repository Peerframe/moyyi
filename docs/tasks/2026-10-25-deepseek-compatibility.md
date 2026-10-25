# DeepSeek 首次真实响应兼容性修复

## 当前范围与版本

基线为已合并 #16 的 `main@b0bdaa8`；分支 `codex/deepseek-visible-reasoning-compat`，
目标为独立 PR 到 main。当前修改仅涉及 DeepSeek 输出解码、合成回归、已有离线评测的扩展与文档。
不改 persisted v1、核心权限、重试策略、公共题判分、模型选择或包依赖；D1–D6 保持。
新 PR 不自动合并，不正式发布；安装中的 main 候选不被未合并分支自动覆盖。

Owner 已分别授权一次最小真实请求和一次额外诊断请求，两次各发出 1 次 HTTP 请求，均返回 200。
此前还有一次本机钥匙串等待超时，HTTP 请求为 0；用户准备处理弹窗后才继续。
每次网络探针都有一次性落盘 guard，没有自动重试。额外诊断额度现已使用，后续真实调用需要另行授权。
真实 key 只由本机凭据回调读取，不进入源码、命令参数、工具输出、提交或 PR；原始响应只留在私有本机目录。

## 已确认的原因

旧安装版收到 reasoning `response.output_item.added` 时，因存在非空 `encrypted_content`
返回固定错误 `Encrypted reasoning is unsupported`。该 item 同时具有合法的
`status: in_progress`、空 `content`／`summary`，随后出现明文 reasoning 的 part 与 delta。
这与原先“只要该字段存在就表示不受支持的纯密文”的假设不符。

诊断只保留了 2,502 字节、5 个事件的前缀；旧解码器拒绝后关闭了流。没有收到完整终态，
token 用量、实际费用、模型底层 revision 仍未知。不把 HTTP 200 或前缀通过当成完整对话验收。
最初的最小探针只记录 `protocol` 类别，遗漏了具体错误与响应片段；额外诊断补齐了这项证据。

## 做了什么

- reasoning 输出允许缺失、null 或合法字符串的辅助 `encrypted_content`；字符串上限 64 KiB UTF-8，
  仍计入既有事件／响应预算。校验后丢弃，不解密、不加入 common content、录制、重放或下一轮请求。
- 每个 item 只记“曾出现非空辅助值”的布尔状态。即使该字段后来消失，最终仍必须有非空白明文；
  仅不透明内容不能得到成功终态或触发已经提出的工具调用。
- 辅助值可以随生命周期变化，明文、身份、状态、参数与终态一致性校验保持。请求 profile 和版本标识不变。
- 新增合成兼容性回归；旧 unsupported-output 断言改为拒绝非法字段形态，纯不透明内容的拒绝有独立回归。
- 扩展已有 DeepSeek 离线场景：明文＋辅助字段经过真实文件／SQLite／录制重放；不透明内容中止时工具不执行。
  CI 增加运行已有 `eval:deepseek` 的步骤，其余 gate 保留。

协议依据与取舍见 [ADR 0010](../decisions/0010-deepseek-transport-and-recording.md#auxiliary-reasoning-output-compatibility-2026-10-25)。
不复制私有 trace、真实 response ID 或推理文本到仓库；回归数据为手写合成内容。

## 验收证据

- `npx vitest run src/plugins/provider-deepseek/codec.test.ts src/plugins/provider-deepseek/index.test.ts src/plugins/provider-deepseek/sse.test.ts`：**92/92**。
- `npx vitest run src/plugins/provider-deepseek/compatibility.test.ts`：**50/50**，含三阶段辅助字段变化／消失、
  UTF-8 边界、非法类型、仅不透明内容拒绝、已发出工具 part 后仍禁止成功终态、身份／文本／参数篡改与请求侧限制。
- `npm run eval:deepseek`：**8/8**；完整明文与工具续接的合成 roundtrip 完成，录制和下一轮请求均没有辅助值；
  不透明内容场景失败且真实工具 effect 数为 0。没有改变公共题评测标准。
- 私有前缀离线对比（网络请求为 0）：旧安装版得到 `protocol`／`Encrypted reasoning is unsupported`；
  新源码得到一个可见 delta，随后因缺少后续终态正确返回 `stream_interrupted`。没有伪造 `completed`。
- `npm run check`：typecheck、Biome **204 files**、**1,423/1,423 tests in 66 files** 通过。

独立审查、提交身份、安装候选和最终 PR CI 的结果记录在本分支 PR 验收区。纯文档收尾沿用上述未变源码检查，
另检查相对链接与 diff。候选仅作为本地、未发布的交付验证，不自动替换用户安装版。

## 尚未验证与后续边界

- 当前修复关闭的是已经复现的首个解码错误。被关闭的实时流不能在离线补造后称为真实完整回答。
- 修复版本的完整真实终态、真实工具续接、实际用量／费用和 Agent 任务能力，均未验证。
- 本机 Keychain host 是私有本机接线，不作为新的产品凭据后端发布。没有新增 GUI、模型或服务。
- 后续合并、更新本机安装和新的真实验收，分别遵守 owner 的明确授权；本 PR 不自动合并或发布。
