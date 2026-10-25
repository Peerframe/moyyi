# 关键证据与生命周期核对：搜索上下文

Owner授权保留Flash + Responses + low，先离线、再本轮总共最多8次真实请求、零重试。
原题/固定1838248源码/原六项标准/所有预算保持，更新本机、分支和PR交付，不公开发布。
继续在未合并的codex/evidence-grounding / PR #25交付；不合并、不叠PR。

本轮修复检索工具：单行命中附带同次安全扫描中的相邻源码，默认每侧8行、可选0–20；
窗口合并、有原行号和完整性，64KiB总文本上限仍受原输出预算约束。默认instructions字节不改，
不注入原题或答案，不新增核心状态/模型评审/索引服务，不改persisted和权限。

生命周期材料上轮实际已送达，不能把理解遗漏全部归因于检索。增加动态读取配置的相反夹具、
重建实例与完整调用链判据，保留所有旧字段和断言。离线结果只能证明证据可达与检查器有效。
见[ADR0024](../decisions/0024-search-source-context.md)。

## 离线验证

- 默认 `npm run check`：typecheck、lint、84文件1881/1881通过。随后仅作三处等价字符串格式整理；
  最终typecheck、lint243文件、文件/窗口相关129/129定向复查通过，未更改断言、超时或预算。
- `npm run eval:instructions`：31/31，新增实际runtime/SQLite的三请求证据传递；原30项保持。
  旧导航后定点读取案例显式选contextLines=0，原“无无关前缀”断言原样保留，新案例验证上下文。
- `npm run eval:files`：8/8；`npm run eval:deepseek`：18/18。
- `npx vitest run evals/tasks/source-evidence.test.ts evals/tasks/tasks.test.ts`：148/148，
  覆盖生命周期相反实现、重建实例以及保留/丢弃、错误调用链等近似错误报告。
- 独立源码审查无阻断；`git diff --check`及11项本地链接通过。默认工作指令、core、persisted
  与本轮前无差异。私有预算门控15/15及脚本语法通过。

本轮实际模型请求0次。CI、干净包、本机安装与真实结果完成后补充。
