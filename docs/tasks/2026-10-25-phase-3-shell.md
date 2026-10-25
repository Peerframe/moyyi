# Phase 3 shell: implementation handoff

## Authorization and checkout

Owner accepted D6 on 2026-10-25: native OS sandbox by default, Docker optional. Continue phase 3
on a branch/PR; no automatic merge, paid model calls or phase 4. This supersedes the earlier
research-only stop. [ADR 0013](../decisions/0013-native-process-sandbox.md) records the decision.

Directory: `/Users/yxflc/Project/moyyi`. Branch: `codex/phase-3-sandboxed-shell`.
[PR #13](https://github.com/Peerframe/moyyi/pull/13) is being advanced from research to implementation
on the same branch; it targets main directly, without a dependent PR. Main baseline remains
`801175fff78a067436f3105bd7ebd500120ffd28`. D1-D5, persisted v1 and prior checker criteria remain unchanged.

PR #12 fixed head `adfa3a2` was independently reviewed, passed 122 focused tests (including 13
real SIGKILL cases) and [head CI](https://github.com/Peerframe/moyyi/actions/runs/40170696136), then
merged as `801175f`; [main CI](https://github.com/Peerframe/moyyi/actions/runs/40171281063) passed.
No direct push to main was made. The prior research commit `51bfd5f` passed
[its CI](https://github.com/Peerframe/moyyi/actions/runs/40172302385); that is historical evidence,
not acceptance of the subsequent implementation.

## Delivered behavior

- `shell` plugin through `ToolContext.processes`: exact command, relative cwd, bounded timeout,
  truthful process effect profile; no Node filesystem/process imports in the plugin.
- Separate explicit `workspaceProcesses` host grant, default ask; file-write grants do not
  authorize processes. Runtime supplies clean environment and rejects missing containment.
- Native Seatbelt on macOS and bubblewrap on Linux. Real workspace, mandatory protection of
  credentials/metadata/runtime paths, no network or provider credentials inherited by commands.
- Existing core validation, digest-bound approval, workspace lease and durable started barrier
  precede execution. The process capability is scoped, revocable, no-argument and single-use.
- Shared stdout/stderr byte bound, bounded deadline, TERM→KILL group cleanup on interruption and
  normal shell exit; inherited pipes cannot block return forever.
- Cancellation, timeout, output exhaustion, revocation or uncertain cleanup become unknown;
  no automatic retry. Startup does not replay commands or infer their outcomes. No command rollback.
- [Usage](../shell.md), updated threat model, seven deterministic offline scenarios, and
  [same-model comparison protocol](../research/harness-comparison.md).

Docker remains an optional future backend. This phase does not add a Docker dependency,
copy/import workflow, persistent terminal or arbitrary-network capability.

## Acceptance evidence

- `npm run check`: TypeScript and Biome (166 files) passed; **1,149/1,149 tests in 51 files** passed.
- `npx vitest run src/runtime/processes.test.ts tests/shell-process.test.ts`: **22/22** passed,
  including two actual runtime SIGKILL checkpoints and bounded detached-pipe handling.
- Native macOS confinement: **26/26** cases passed against actual files, child processes and
  host TCP/Unix socket listeners. Linux execution is pending the new PR CI, not inferred from Mac.
- Focused runtime/core/policy/plugin regression: **115/115** in 7 files.
- `npm run eval:shell`: **7/7** scenarios using real native execution, files and SQLite passed.
- `npm run build` passed. No private corpus or real model was used. Existing checks/fixtures remain
  unchanged; the Linux CI prerequisite is added without removing the original check command.

The first Linux CI failed before command launch because Ubuntu AppArmor blocked bubblewrap
loopback setup (run `40176393792`: 21 failures). The scoped distribution profile is now loaded
in CI, while all original assertions remain; denial probes additionally require proof that the
shell started. The next run (`40176679021`) launched correctly and passed 1,145 tests, but
three assertions caught writes to bubblewrap's private synthetic root. The host canary was not
modified; the root mount is now made read-only so outside-workspace writes fail consistently
instead of creating misleading private aliases. Linux acceptance awaits the corrected-head run.

The first full-gate attempt encountered a temporary SessionId typing error in an in-progress
new crash fixture. It was corrected before the successful full run; no check was relaxed.

The earlier research-only full run had one unchanged development watcher timeout (1,080/1,081);
focused 10/10 and a full rerun 1,081/1,081 passed without changing timeouts or assertions. That
historical intermittent failure was documented, not claimed as fixed by this feature.

## Limits and remaining work

- No live DeepSeek compatibility or real-model task-quality/harness comparison was run. Offline
  conformance does not establish pass@1, cost, latency or superiority. Phase 1 live acceptance
  remains pending independently of this phase's implementation.
- macOS deliberately detached descendants and host-SIGKILL cleanup are outside the accepted
  process-group guarantee. Native mode is not resource quota enforcement or a hostile same-user
  boundary. Commands may leave partial changes without file snapshots.
- Linux protects existing sensitive entries with mounts; host secret injection during execution
  is unsupported. Explicit toolchain grants must not contain private data. Workspace admission
  rejects unsupported aliases/special files and scans within documented bounds, failing closed.
- Docker execution, network grants, credential-store integration and phase 4 long-session work
  are not delivered. They are not silently enabled or represented as tested features.

## Owner decisions

D6 is accepted; no further decision is needed for this native phase 3 scope. The PR remains
unmerged for owner review. Phase 4 and paid-model comparisons need later authorization.
