# Skills foundation handoff — 2026-10-26

## Candidate

Implementation branch: `codex/skills-foundation`, based on main
`eee3beed4f392112f97c0bbdbd021d583355b6df` (PR #20). Dedicated worktree owned by the Skills implementer;
no edits to the OpenBot checkout, persisted contracts, core or public-task checkers. This handoff
records the prepared branch; the parent task owns push, PR, CI, review, merge and final local install.
No repository publication, paid model call or credential read occurred.

## Usable result

An installed host can configure `skills: { root: absoluteLibrary, enabled: ["skill-name"] }`.
Only selected SKILL.md files enter ordinary model context. Their original decoded text and hash
are refreshed for each request and recorded through the existing request blob. Permission checks,
cancellation, source failure and capability expiry apply. Root project instructions and selected
skills work in the same runtime; combined whole-request budgeting remains unchanged.

The plugin accepts a documented bounded Agent Skills YAML profile. It uses exact `yaml` 2.9.1,
ISC, reviewed in ADR 0019. OpenBot's small bounded-AST validation approach is adapted with exact
source revision and MIT notice; scalar boundary tests are rewritten. No control-plane concepts
or tool authority are imported. See [setup/limits](../skills.md),
[ADR 0019](../decisions/0019-explicit-skills-context.md) and [provenance](../openbot-provenance.md).

## Executed evidence

- `npm run check`: PASS, typecheck + Biome + 76 Vitest files / 1679 tests. Includes 100 new
  Skills/parser/reader/runtime cases. Existing gates and checker standards are unchanged.
- `npm run eval:skills`: PASS, 31/31 scenarios; zero network attempts. Actual runtime, SQLite and
  disposable files, scripted model output. Covers source/request identity, select-only scope,
  root guidance coexistence, edit/tool-continuation/compaction refresh, deletion failure,
  deny/ask/missing policy, restrictive rules at both phases, revoke/regrant, expiry/cancel/source
  failure, UTF-8/YAML/size/link/protected-root failures, inert allowed-tools, recording/replay
  drift and whole-request budgets.
- `npm run verify:package -- --offline`: PASS. Private 0.0.0 package, 226 inventory-checked files;
  installed CLI 10/10, installed public-runtime client 10/10 (including actual skill load/edit
  refresh), 5/5 POSIX PTY, strict NodeNext consumer declarations/negative probes and isolated
  uninstall. No checkout-source/development-dependency fallback. Skills guide and MIT notice
  included; `yaml` 2.9.1 present in installed production dependencies.
- Verified candidate SHA-256:
  `126337d56d8e085ed08c4f7f405096e375db89e0e121d7a48a45ed27832b087c`.
  Built before commit with base revision/dirty provenance; this is an acceptance artifact, not
  an official release or the parent's eventual combined candidate.
- `git diff --check`: PASS.

Early focused tests exposed two test/implementation details that were corrected before the full
pass: a Markdown separator after a valid YAML end marker is body framing, not a second metadata
document; CRLF source text must remain unchanged so its recorded hash matches the emitted source.
The final tests require original decoded-text preservation. Reader replacement tests inject a
new directory/file identity between initial checks and access; both fail closed.

## Remaining validation and limits

Remote PR/main CI is not run by this implementer. The final parent integration must retain the
new CI `eval:skills` step, combine inventory changes with other work and validate/install the
combined candidate. Full unchanged local tests need not be repeated just for this handoff.

No real-model skill-following quality has been measured. Automatic activation/discovery,
multiple library roots, skill installation, reference/resource loading and script execution are
intentionally outside this first version. All are documented; none are silently simulated.
Unicode skill names are outside the ASCII identifier profile. Hostile same-UID filesystem races
are not an isolation guarantee. No new owner-level decision is pending for this scope.

## 集成到 PR #21 后的 main

基线更新为 `9881623f569d037350dc4a599941814ac50ab29b`。仅检查命令列表发生冲突；保留
`eval:runtime` 与 `eval:skills` 两套 CI 检查，`git range-diff` 确认产品代码与独立审查版本一致。

- 默认并发 `npm run check`：1703 通过、1 个未改动的 recording 目录枚举测试超过原 5 秒。
  单独 `vitest run src/runtime/model-recording.test.ts`：43/43 通过（约 1 秒）。
- 一次重跑错误地把 `--maxWorkers=4` 交给 npm，npm 忽略该选项，实际仍为默认并发；结果
  1703 通过、既有 development watcher 用例未在原 3 秒内通知。没有修改任何超时或断言。
- 正确执行 `npm run check -- -- --maxWorkers=4`：typecheck、Biome 233 文件、79 文件
  **1704/1704** 全部通过。远端 CI 仍执行未改动的默认 `npm run check`。
- `npm run eval:skills` 31/31、`npm run eval:runtime` 10/10 通过。
- 主控及独立代理对固定 Skills diff 审查无阻断；再次核实 OpenBot 版本与 MIT 原版权正文。
