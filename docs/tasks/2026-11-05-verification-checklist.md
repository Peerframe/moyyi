# 验证清单：PR #59、#60、#66（交给 Codex 执行）

- 日期：2026-11-05。编写：Claude。执行：Codex，在主人的 Mac（arm64）上。验收：Claude。
- 被测代码：分支 `claude/adoring-maxwell-rad278` 的最新提交。#59、#60、#66 已于 2026-11-05 合并进
  `main`；这个分支是最新 `main` 加上本清单和评测的 `--final-accounting` 开关（4.2 要用）。如果这批
  后续改动也已合并，改测 `main` 的最新提交。实际提交写进第 5 节。
- 结果：填在本文件第 5 节，提交到新分支 `codex/verification-2026-11-05`（从被测提交开出）并推送。
  不开 PR，除非主人要求。
- **付费部分（第 4 节）冻结预算：最多 223 次模型请求。** 主人把本清单交给 Codex 时，需要明确同意
  这个上限；没有明确同意就只跑第 0–3 节，第 4 节写"未执行：未获预算授权"。

## 规则

- 不改代码、不改测试、不放宽断言、不跳过测试。只有第 5 节的记录和截图可以提交。
- 只报告实际跑过的命令。没跑的写"未执行"和原因；环境问题（例如缺 npm 缓存）照实写，不要换一个
  检查顶替。
- 检查失败时：保存原样输出（失败处前后各 30 行），按
  [moyyi-check](../../.agents/skills/moyyi-check/SKILL.md) 写出第一个出错的层，然后继续跑不依赖它的项目。
- 付费部分按 [moyyi-live-eval](../../.agents/skills/moyyi-live-eval/SKILL.md)：
  - 开跑前在第 5 节写下冻结配置；
  - 每项只跑一次，不因失败重跑；
  - 服务商返回 429 或其他服务端错误记为"不可用"，预算内最多重复一次；
  - 每跑完一项就更新第 5 节的用量账本，用量到上限立即停。
- 不读取、打印或复制任何密钥。私有 host 模块放在仓库外，只用它的路径。
- 截图和记录里不能出现密钥、主人的真实会话内容或私人文件。第 3 节在隔离环境里截图；第 4 节只用
  临时目录和专门新建的测试会话。

## 0. 准备

```bash
git fetch origin
```

```bash
git checkout -B codex/verification-2026-11-05 origin/claude/adoring-maxwell-rad278
```

```bash
git log -1 --format='%H %ci' && node -v && npm ci
```

- `node -v` 需要 v26。上次交付在 Homebrew Node 26.13.0 下遇到过一次文档解析测试超时，换安装包自带的
  Node 26.12.1 没有复现。如果再遇到，用两个版本分别跑那个测试文件，两次结果都记录。
- 第 2、4 节用到的临时目录：

```bash
export V="$(mktemp -d /tmp/moyyi-verify-XXXX)" && echo "$V"
```

- 第 2、4 节用两个辅助命令查看 `stream-json` 输出：工具调用和最终回答。

```bash
calls() { node -e 'for (const l of require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n")) { const e = JSON.parse(l); if (e.type === "entry.appended" && e.entry.body.kind === "assistant_message") for (const p of e.entry.body.content) if (p.type === "tool_call") console.log(p.name, p.rawArguments); }' "$1"; }
```

```bash
answer() { node -e 'let a = ""; for (const l of require("fs").readFileSync(process.argv[1],"utf8").trim().split("\n")) { const e = JSON.parse(l); if (e.type === "entry.appended" && e.entry.body.kind === "assistant_message") { const t = e.entry.body.content.filter((p) => p.type === "text").map((p) => p.text).join(""); if (t.trim()) a = t; } } console.log(a);' "$1"; }
```

## 1. 离线检查（不花钱）

| 编号 | 命令 | 期望 |
|---|---|---|
| 1.1 | `npm run check` | 全部通过（类型检查三套配置、lint、全部单元测试） |
| 1.2 | `npm run eval:core`、`eval:files`、`eval:writes`、`eval:documents`、`eval:deepseek`、`eval:shell`、`eval:long-sessions`、`eval:anthropic`、`eval:kimi`、`eval:web`、`eval:instructions`、`eval:runtime`、`eval:skills`，逐条运行 | 每条退出码 0；`eval:files` 为 20/20（含新的正则场景 `regex-finds-definitions-in-one-search`） |
| 1.3 | `npm run eval` | 空代理跑公开任务集，正常结束 |
| 1.4 | `npm run verify:package -- --offline` | 通过；如果因 npm 缓存缺包失败，记录原文，再跑 `npm run verify:package`（联网）并注明 |
| 1.5 | `node node_modules/electron/install.js`（需要时），然后 `npm run desktop:package`，再 `npm run verify:desktop` | 两条都通过；候选包在 `artifacts/desktop/Moyyi.app` |
| 1.6 | `npm run eval:gate -- --dry-run`，以及 `npm run eval:gate -- --dry-run --final-accounting` | 只打印命令，不发请求；都写"at most 71 paid model requests"；第二组每条命令以 `--final-accounting` 结尾 |

## 2. CLI 冒烟（不花钱，用 `--demo`）

`--demo` 是固定的离线脚本，只读 `README.md`，不是语言模型。

```bash
mkdir -p "$V/demo-work" "$V/demo-data" && printf '# Demo\n\nHello from the demo workspace.\n' > "$V/demo-work/README.md"
```

| 编号 | 命令 | 期望 |
|---|---|---|
| 2.1 | `npm run -s moyyi -- --demo -C "$V/demo-work" --data "$V/demo-data" --output json "Inspect the README" > "$V/demo.json"`，然后 `cat "$V/demo.json"` | 一行 JSON：`outcome.kind` 为 `completed`，`exitCode` 为 0，`answer` 非空，`usage.requests` ≥ 1 |
| 2.2 | 同上，改成 `--output stream-json` 并写到 `"$V/demo.jsonl"` | 每行都是合法 JSON，含 `session.ready`、`run.started`、`run.finished` |
| 2.3 | 同 2.2，加 `--plan`，写到 `"$V/plan-demo.jsonl"`，再 `grep -c '\[Plan mode\]' "$V/plan-demo.jsonl"` | 计数 ≥ 1：用户消息带上了计划模式说明 |
| 2.4 | `npm run -s moyyi -- --demo -C "$V/demo-work" --data "$V/demo-data" --continue --output json "Inspect the README again"` | `sessionId` 和 2.3 里 `session.ready` 的 `sessionId` 相同（接着最近的会话）；`outcome` 照实记录 |
| 2.5 | 终端甲：`npm run -s moyyi -- --daemon --demo -C "$V/demo-work" --data "$V/daemon-data"`；终端乙：`npm run -s moyyi -- --connect --data "$V/daemon-data" "Inspect the README"`；最后在终端甲按 Ctrl-C | 甲打印权限和套接字路径；乙打印回答并退出 0；Ctrl-C 后甲正常退出 |

## 3. 桌面界面（不花钱，隔离环境）

先退出已安装的 Moyyi，再用临时 `HOME` 启动 1.5 打出的候选包。这样数据、设置、钥匙串都和主人的
真实环境隔离：

```bash
export UIHOME="$(mktemp -d /tmp/moyyi-ui-home-XXXX)" && mkdir -p "$UIHOME/work" && printf '# UI test\n' > "$UIHOME/work/README.md"
```

```bash
HOME="$UIHOME" "$PWD/artifacts/desktop/Moyyi.app/Contents/MacOS/Moyyi"
```

没有模型密钥，所以界面会显示模型配置未就绪、发送不可用，这是预期。不要在这个环境里填密钥。
如果 macOS 拦截启动（未签名的本地候选包），在 Finder 里对 `artifacts/desktop/Moyyi.app` 右键选"打开"
放行一次，然后退出它，再用上面的命令带临时 `HOME` 启动；照实记录拦截提示。

| 编号 | 操作 | 期望 |
|---|---|---|
| 3.1 | 新建，选择目录 `$UIHOME/work` | 会话打开；顶部工具栏有：材料、会话权限、计划模式、成果与记录、完整历史、管理会话 |
| 3.2 | 点"计划模式" | 按钮变为按下态（高亮）；输入框上方出现提示条"计划模式：每条消息只做只读调查并给出计划……"；"按计划执行"是灰的（还没有完成的计划）；"退出计划模式"可以点 |
| 3.3 | 点"退出计划模式" | 提示条消失，按钮恢复 |
| 3.4 | 设置 → 预算 | 显示"长任务开关：全部关闭" |
| 3.5 | 预算页的"调整模型与预算" | 对话框里"自动压缩上下文""只读子 agent""子目录 AGENTS.md""独立证据成文（实验）"四个勾选框都和文字在同一行，不会单独居中占一行；每轮请求上限可以填到 200，时限可以填到 3600 秒 |
| 3.6 | 勾选"自动压缩上下文"并保存；回到预算页 | 显示"长任务开关：已开启 自动压缩上下文"。如果没有密钥时不允许保存，照实记录提示原文。最后取消勾选并保存 |
| 3.7 | 设置 → 权限和确认 | 四条说明，其中两条分别讲"「本会话始终允许」……重开会话即失效"和"计划模式下修改、命令和外部调用一律拒绝……" |
| 3.8 | 依次打开材料、会话权限、成果与记录、完整历史、管理会话 | 都能打开和关闭，没有报错 |
| 3.9 | 截图 | 1120 × 800：3.2 的计划模式提示条，以及 3.5 的设置对话框。780 × 560：3.2，按 [截图方法](assets/2026-11-04-chat-desktop/README.md)（复制 app，只改临时 `main.mjs` 的初始窗口尺寸）。存到 `docs/tasks/assets/2026-11-05-verification/` |

## 4. 付费实测（需要主人同意预算）

冻结配置：主人的私有 host 模块（默认 DeepSeek Flash，Responses，reasoning low，输出 8192 tokens），
自动重试 0 次。路径只写进环境变量：

```bash
export HOST="<私有 host 模块的绝对路径>"
```

| 编号 | 内容 | 请求上限 |
|---|---|---|
| 4.1 | 质量门，不开核对清单 | 71 |
| 4.2 | 质量门，开核对清单 | 71 |
| 4.3 | 正则搜索 | 6 |
| 4.4 | CLI 计划模式（单次 6；交互 4 轮 × 每轮 4） | 22 |
| 4.5 | 只读子 agent | 主 8 + 子 agent 最多 2 × 12 = 32 |
| 4.6 | 子目录 AGENTS.md（开启 + 对照） | 12 |
| 4.7 | 桌面：计划模式、本会话始终允许（3 轮 × 每轮 3） | 9 |
| | **合计** | **223** |

`--max-requests` 和桌面的请求上限都是**每轮**上限，表里已按轮数相乘。

### 4.1、4.2 质量门对比

```bash
npm run eval:gate -- --host "$HOST" --allow-live 2>&1 | tee "$V/gate-a.log"
```

```bash
npm run eval:gate -- --host "$HOST" --allow-live --final-accounting 2>&1 | tee "$V/gate-b.log"
```

- 记录每题 PASS/FAIL 和请求数，以及脚本最后打印的汇总文件路径（在 `evals/results/`，不提交）。
- 对照：交付一的冻结运行是 6/6、27 次请求。
- 某题在 4.1 通过、4.2 失败（或反过来）时，不在这里重跑；记下来交给 Claude 判断是否需要按
  moyyi-live-eval 在基线上复跑。

### 4.3 正则搜索

```bash
mkdir -p "$V/regex/src" && printf 'export function alpha() {}\nconst helper = 1;\nexport class Beta {}\n' > "$V/regex/src/a.ts" && printf 'export const gamma = () => 1;\nexport function delta() {}\n' > "$V/regex/src/b.ts" && printf 'export function alphaTest() {}\n' > "$V/regex/src/a.test.ts"
```

```bash
npm run -s moyyi -- --host "$HOST" -C "$V/regex" --data "$V/live-data" --max-requests 6 --output stream-json "列出 src 目录里所有以 export function 或 export class 开头的行，不包括 .test.ts 文件。给出文件名、行号和名称。" > "$V/regex.jsonl"
```

```bash
calls "$V/regex.jsonl"; answer "$V/regex.jsonl"
```

- 通过：回答恰好是 `src/a.ts` 第 1 行 alpha、第 3 行 Beta，`src/b.ts` 第 2 行 delta；不含 gamma 和 alphaTest。
- 另外记录（不算通过条件）：`search` 调用里有没有 `"regex":true`，以及用了几次请求。

### 4.4 CLI 计划模式

```bash
mkdir -p "$V/plan" && printf '# Original\n\nBody.\n' > "$V/plan/README.md"
```

单次运行（单次模式下审批本来就会被拒绝，所以要看拒绝原因的文字）：

```bash
npm run -s moyyi -- --host "$HOST" -C "$V/plan" --data "$V/live-data" --allow-write --plan --max-requests 6 --output stream-json "把 README.md 的标题改成 # Planned" > "$V/plan.jsonl"
```

```bash
calls "$V/plan.jsonl"; answer "$V/plan.jsonl"; head -1 "$V/plan/README.md"; grep -c 'Plan mode: changes, commands and external calls are disabled' "$V/plan.jsonl"
```

- 通过：标题仍是 `# Original`；如果模型尝试了 `edit` 或 `create`，结果里的拒绝原因以"Plan mode:"开头；回答是分步骤的计划。

交互运行（需要终端或 PTY；共 4 轮，每轮最多 4 次请求）：

```bash
npm run moyyi -- --host "$HOST" -C "$V/plan" --data "$V/live-data" --allow-write --max-requests 4 -i
```

依次输入：

1. `/plan`
2. `把 README.md 的标题改成 # Planned`，等它给出计划。
3. `/execute`，出现审批后输入 `/approve <EFFECT_ID>`。完成后标题应为 `# Planned`。
4. `再把标题改成 # Planned Again`，出现审批后输入 `/always <EFFECT_ID>`。
5. `最后把标题改成 # Final`：这次应该**不再弹审批**，标题变为 `# Final`。
6. `/exit`

- 通过：第 2 步没有修改文件；第 3、4 步各弹一次审批；第 5 步不弹；最终标题是 `# Final`。
- 如果没有可用的终端，写"未执行：无 PTY"，留给主人手动跑。

### 4.5 只读子 agent

```bash
mkdir -p "$V/sub/alpha" "$V/sub/beta" && printf 'The alpha code word is HERON.\n' > "$V/sub/alpha/notes.md" && printf 'The beta code word is OSPREY.\n' > "$V/sub/beta/notes.md"
```

```bash
npm run -s moyyi -- --host "$HOST" -C "$V/sub" --data "$V/live-data" --subagents --max-requests 8 --output stream-json "分别用一个子 agent 调查 alpha 和 beta 两个目录，报告每个目录里的代号。" > "$V/sub.jsonl"
```

```bash
calls "$V/sub.jsonl"; answer "$V/sub.jsonl"
```

- 通过：至少一次 `agent` 调用；回答里同时有 HERON 和 OSPREY；没有任何写入效果。
- 运行时用 `tail -f "$V/sub.jsonl"` 盯着：`agent` 调用超过 2 次就按 Ctrl-C，记为"超出预期，已取消"。
  每个子 agent 最多 12 次请求，所以这一项最多 8 + 2 × 12 = 32 次。
- 子 agent 的请求数如果在 `agent` 结果里有就记录，没有就写"未单独统计"。

### 4.6 子目录 AGENTS.md

```bash
mkdir -p "$V/nested/pkg" && printf 'When you answer a question about files in pkg/, end your answer with the line NESTED-RULE-SEEN.\n' > "$V/nested/pkg/AGENTS.md" && printf 'The number is 42.\n' > "$V/nested/pkg/data.txt"
```

开启：

```bash
npm run -s moyyi -- --host "$HOST" -C "$V/nested" --data "$V/live-data" --nested-instructions --max-requests 6 --output json "pkg/data.txt 里的数字是多少？" > "$V/nested.json"
```

对照（不开启，另用一个数据目录）：

```bash
npm run -s moyyi -- --host "$HOST" -C "$V/nested" --data "$V/live-data-control" --max-requests 6 --output json "pkg/data.txt 里的数字是多少？" > "$V/nested-control.json"
```

- 通过：开启时回答含 42，并以 `NESTED-RULE-SEEN` 结尾。对照组的结果照实记录：没有这一行是预期，
  有的话也写下来。

### 4.7 桌面：计划模式与"本会话始终允许"

这一项用主人的真实环境，所以先备份：在已安装的 Moyyi 里打开 设置 → 记录和数据 → 备份与回退，
做一次备份，记下备份路径。再看 设置 → 预算 的每轮请求上限：高于 3 就临时改成 3，测试结束后改回原值
（原值写进第 5 节）。然后退出已安装的 Moyyi，打开候选包：

```bash
mkdir -p "$HOME/moyyi-verify-work" && printf '# Original\n' > "$HOME/moyyi-verify-work/README.md" && open "$PWD/artifacts/desktop/Moyyi.app"
```

| 编号 | 操作 | 期望 |
|---|---|---|
| a | 新建，选择 `~/moyyi-verify-work`；会话权限里允许修改文件 | 会话打开，权限显示可修改 |
| b | 打开计划模式，发送"把 README.md 的标题改成 # Planned" | 不弹审批卡；如果模型尝试修改，工具行显示被拒绝；回答是计划；标题仍是 `# Original`；用户气泡里只有你写的话，下面有一条"以计划模式发送……"的提示，没有英文说明段 |
| c | 回答完成后点"按计划执行" | 计划模式关闭；新一轮开始；弹出审批卡，上面有"本会话始终允许" |
| d | 点"本会话始终允许" | 修改完成，标题变为 `# Planned` |
| e | 再发送"把标题改成 # Planned Again" | 不再弹审批卡，直接修改。如果模型这次换了别的工具（例如 `create`），会再弹审批，这是预期，照实记录 |
| f | 打开计划模式，再到会话权限里改动一项（例如取消再允许修改文件） | 改完后计划模式按钮仍是按下态，提示条还在 |
| g | 截图 | 1120 × 800 的 c（审批卡）和 b（提示条）；只出现测试目录，不出现其他会话内容 |

- 结束后退出候选包，重新打开已安装的 `~/Applications/Moyyi.app`，确认它能正常打开、历史还在。
  测试会话可以留着，也可以在管理会话里移到回收站。

## 5. 结果记录（Codex 填写）

- 被测提交：
- 执行人与时间：
- Node 版本：
- 冻结配置（第 4 节）：host 模块路径不写，只写模型、推理档位、输出上限、重试次数：
- 主人的预算授权（原话或时间）：

| 编号 | 结果（通过／失败／未执行） | 证据（数字、输出摘要、截图文件名） | 备注 |
|---|---|---|---|
| 1.1 | | | |
| 1.2 | | | |
| 1.3 | | | |
| 1.4 | | | |
| 1.5 | | | |
| 1.6 | | | |
| 2.1 | | | |
| 2.2 | | | |
| 2.3 | | | |
| 2.4 | | | |
| 2.5 | | | |
| 3.1–3.9 | | | |
| 4.1 | | 每题 PASS/FAIL 和请求数 | |
| 4.2 | | 每题 PASS/FAIL 和请求数 | |
| 4.3 | | | 是否用了 `regex:true` |
| 4.4 | | | |
| 4.5 | | | |
| 4.6 | | | |
| 4.7 | | | 备份路径；每轮上限原值 |

用量账本：

| 项目 | 上限 | 实际请求 | 服务商报告的 token（如有） |
|---|---|---|---|
| 4.1 | 71 | | |
| 4.2 | 71 | | |
| 4.3 | 6 | | |
| 4.4 | 22 | | |
| 4.5 | 32 | | |
| 4.6 | 12 | | |
| 4.7 | 9 | | |
| 合计 | 223 | | |

失败项（每项写：命令、原样输出摘录、第一个出错的层）：

-
