# DeepSeek 推理档位配置与 low 自主验收

Owner 授权：保留 Flash 与 Responses，推理档位可配置；先离线验证，再用 low 做原题自主检索。
本轮真实调用总共最多8次，零自动重试；原题、源码快照、六项标准和原预算保持。分支/PR交付，
更新本机，不公开发布、不自动合并。

沿用未合并的 `codex/evidence-grounding` / PR #25，保留定点读取能力，不叠PR。
本轮实现只涉及 provider、runtime 配置、录制配置绑定及验证；core和persisted不变。

## 实现与范围

- `deepseekReasoningEffort` 支持 none/low/high/max，省略保留high；本机显式设low。
- Flash/Responses、8192输出和权限不变。非法设置提前拒绝；初始化后不跟随外部对象变更。
- high录制标识兼容旧版，其他档位有独立profile；跨档位重放拒绝，不回退真实请求。
- session DB公共请求不独立记录effort；真实验收用私有配置/安装指纹/实际wire哈希补充审计。

## 验收安排

离线检查、CI、干净安装包验证及本机更新后，才运行唯一一次low自主验收。
固定被分析源码 `1838248`，原问题和六项标准保持；不预给源码包或标准答案，不读用户私有文件。
最多8次真实HTTP、零重试；只允许read/list/search，末次保留无工具收尾，预算脚本失败也计数。
最终正文独立按原六项核对，不能用完成、工具成功或引用文件数代替事实正确性。

## 离线证据

- `npm run check -- -- --maxWorkers=2`：typecheck、Biome241文件、83文件1849/1849测试通过。
- 最终代码的默认 `npm run check`：1848通过，既有development watcher的3秒通知超时1项；
  随后 watcher与运行时配置定向27/27通过。此前快照模型修复前的默认检查1849/1849通过。
  未改测试超时、断言或默认CI命令；最终默认CI另列。
- `npm run eval:deepseek`：18/18，含真实runtime/文件/SQLite上的low三轮录制重放。
- `npm run eval:anthropic`：5/5，覆盖共用录制配置快照变更。
- 独立审查发现并修复异步初始化期间模型选择变更造成的录制误标窗口；回归覆盖修改原对象、
  替换配置及后续请求前变更。复审无剩余阻断。
- `git diff --check`通过；本轮9个本地文档链接通过。私有预算门控15/15、脚本语法通过。

CI、干净安装包、本机更新与真实验收结果在完成后补充；目前本轮付费请求为0。
