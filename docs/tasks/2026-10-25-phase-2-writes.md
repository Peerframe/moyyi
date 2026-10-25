# Phase 2: controlled writes — current handoff

## Authorization and baseline

Owner authorized reviewing/merging PR #11, then phase 2 through a separate branch and PR.
No automatic merge of the new PR, paid model calls, real credentials, private eval access,
protection changes or phase 3. No direct push to main. D1–D5 remain unchanged.

PR #11 fixed head `b747be5f6d4502e9cf55cede5ac8501c47f212e7` was independently reviewed with
70/70 focused tests and 5/5 real POSIX PTY scenarios; no unresolved blocker. Its CI run
[40169075796](https://github.com/Peerframe/moyyi/actions/runs/40169075796) passed. It was merged as
`cda24d47f89931f3d6cfbe4692d4752a042a7e7a`; main CI
[40169627498](https://github.com/Peerframe/moyyi/actions/runs/40169627498) passed.

Current directory: `/Users/yxflc/Project/moyyi`. Branch: `codex/phase-2-controlled-writes`,
started from that latest main. All implementation is independently authored; no OpenBot or
upstream source copied, no new dependency. See [ADR 0012](../decisions/0012-controlled-workspace-writes.md).

## Scope and delivered behavior

- Explicit, exact workspace grants; default read-only; digest approvals by default when enabled.
- `create`, unique literal `edit`, and snapshot `undo` through the existing `fs` plugin and core.
- Phase-scoped capabilities, prepare-only inspection, approved-payload-only/single-use apply,
  write leases, revocation/cancellation guards and hash/identity/mode checks.
- Durable touched-file snapshots before publication; same-directory staging, no-overwrite create,
  atomic replace, parent synchronization and postcheck. Undo is a new journaled action.
- Additive SQLite schema 2 migration, immutable validated snapshots and backup blob reachability.
  Frozen persisted v1 files and existing corpus/checker/boundary/CI rules are unchanged.
- Recovery performs only inspection, resolves observed pre/post-state or retains unknown,
  and never automatically retries a write or calls a model.

## Acceptance evidence

Executed on Node 26.0.0 / macOS arm64 against the complete phase 2 implementation:

| Command / scope | Result |
|---|---|
| `npm run check` | TypeScript passed; Biome 155 files; 1,081 tests / 46 files passed |
| `npm run build` | Passed |
| `npm run eval:core` | 8/8 offline runtime/SQLite scenarios passed |
| `npm run eval:files` | 8/8 offline file scenarios passed |
| `npm run eval:deepseek` | 6/6 synthetic SSE/record/replay scenarios passed |
| `npm run eval:writes` | 8/8 controlled-write scenarios passed; real filesystem/status/canary assertions |
| `npx vitest run src/runtime/writes.test.ts tests/write-process.test.ts` | 57/57: 44 capability/fault tests and 13 actual SIGKILL/restart scenarios |
| `npx vitest run src/store/schema.test.ts src/store/snapshots.test.ts tests/store.test.ts tests/store-process.test.ts` | 75/75: migration, snapshot integrity, old-backup migration, backup reachability and faults |
| `git diff --check` | Passed |
| Local Markdown link validation | 14 changed/new documents, 98 relative links, none missing |
| Frozen-scope diff | No changes to `src/contracts/persisted`, corpus/checkers, boundary rules or CI workflow |

The focused tests above are subsets of the full 1,081, not additional unique tests. The new
SIGKILL test includes the hard-link publication/cleanup window: it deliberately retains unknown
and the lease, with no replay. Other tested checkpoints reconcile observed state, preserve blobs,
pair results and release resolved leases. Physical power loss and every possible syscall window
are not covered. All writers and local test processes finished before handoff.

An independent review found invalid write-root configuration could throw after plugin setup and
leak plugin resources. Validation now runs before plugin loading, with a regression test. A second
review of the corrected core/runtime/store/undo path found no remaining reproducible blocker.
Remote CI is recorded on the new PR; the PR remains unmerged. Subsequent documentation-only
updates reuse these executed code-check results and recheck local links; they are not new test runs.

## Not verified or outside this slice

- Real DeepSeek request acceptance, task quality, pass@1/pass^k, latency and cost remain unverified.
  No live model/credential use. `project-instructions` remains an undelivered phase 1 roadmap item.
- No Windows, network filesystem, malicious same-account race, ACL/xattr preservation, physical
  power-loss or exhaustive phase 4 crash-point guarantee. Killed staging files can need manual cleanup.
- Single-file touched-content snapshots, not whole-project/multi-file transactions. No snapshot GC,
  persistent grant UI, manual unknown-resolution UI or dedicated CLI `/undo` command.
- No shell, process sandbox, web, second provider, model training or phase 3 work.

## Owner decisions

No new D-class decision is needed for this bounded phase 2 implementation. Existing D1/D2/D3
choices are preserved. Review the new PR before authorizing merge. Advancing to phase 3 and
real-model smoke tests remains a separate owner decision.
