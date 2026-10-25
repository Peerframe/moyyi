# Batch 5 implementation and review handoff

Owner authorization (2026-10-25): review PR #8, fix blockers and merge after CI, then deliver
batch 5 on a new branch/PR. Do not automatically merge the new PR, make paid model calls or
start batch 6. D1–D5 remain accepted; persisted v1 and the public task criteria remain frozen.

## Completed merge checkpoint

Review of #8 at `7870ccd` found two reproducible correctness blockers: malformed later stream
events could overwrite accepted content, and diagnostic truncation through an emoji could
break JSON/final events. Both were fixed on its original branch in `b31b36d388a49e6b705e461a0c19b6ff20f6c6ff`.
The final local check passed 648 tests in 25 files, typecheck and Biome; core eval passed 8/8
and build passed. [Corrected-head CI](https://github.com/Peerframe/moyyi/actions/runs/40166420233)
passed before merge. The PR description records the prior and replacement evidence distinctly.

#8 merged as `4cc8b3aa461746070aad4ddb3d7b880688bb97e8`.
[Main CI](https://github.com/Peerframe/moyyi/actions/runs/40166451437) passed. This batch uses
`codex/batch-5-files`, created from that pulled main; no stacked PR or direct main push.

## Delivered scope

- Runtime-confined read/list/search capabilities, with per-invocation lifetime and revision-bound
  permission guards. Reads use verified file descriptors, bounded UTF-8 decoding, and checks
  before data is returned. Cancellation/revocation discards pending content.
- Built-in `fs` plugin with closed schemas, read-only effect profiles and bounded JSON results.
  No filesystem or process imports inside the plugin. Protected paths fail directly without
  becoming a stale-precondition approval.
- Scoped `.gitignore` search using exact `ignore@7.0.12`, with explicit unsupported-pattern
  rejection and resource ceilings. No ripgrep binary or command runner is introduced.
- Concrete SQLite data, configured private roots and known credential paths stay excluded.
  Static symlink/OS aliases of configured private roots are resolved as well as lexical paths.
  A review reproduced and fixed that exclusion-alias bypass with a real-file regression.
- Real-file scripted demo and eight separate deterministic public-protocol eval scenarios.
  Frozen contracts, schema, layer rules and original public task/checker criteria are unchanged.

Usage and exact limits are in [files.md](../files.md), the
[plugin README](../../src/plugins/fs/README.md) and [ADR 0009](../decisions/0009-workspace-files.md).
No OpenBot or upstream source implementation was copied.

## Acceptance evidence

Final local evidence on macOS arm64, Node 26.0.0, npm 11.12.1:

- `npm run check`: typecheck and Biome (115 files) passed; 28 test files / **736 tests** passed.
- The file-specific tests include 34 mock-capability plugin cases, 36 real host filesystem cases
  and 18 runtime/SQLite integration cases. Git itself checks the supported ignore examples.
- `npm run build`: passed. `npm run eval:core`: **8/8**. `npm run eval:files`: **8/8**.
- `npm run demo:files`: passed; three real file results persisted and delivered to subsequent
  model requests, ignored content excluded, run completed.
- Local Markdown targets: 13 documents / 70 targets passed. `git diff --check` passed.
- Frozen persisted format, SQLite schema, layer rules, public tasks/checkers and CI had no diff
  from main `4cc8b3a`. No private eval or real credential was accessed.

The exact delivery commit and exact-head CI are recorded in the PR; earlier focused results
are not substituted for final checks. Mock, real-filesystem and scripted-model evidence remain
distinct; none claims real-model task performance.

## Remaining boundaries and owner decisions

The batch 5 PR is for review and is not automatically merged. No new D-class decision is
pending. Batch 6, real provider calls, write/shell tools and the interactive CLI have not started.
The demo uses a scripted model, so autonomous task performance, model cost and provider wire
compatibility remain unverified. The current client is programmatic.

Ignore semantics are the documented supported subset, not every Git configuration. Search has
explicit limits and returns incomplete/skipped indicators. Known protected names do not detect
all sensitive content. Same-user hostile filesystem races, Windows and network filesystems are
not claimed; the existing D3 threat boundary is retained, not expanded.

Final cleanup verifies delegated writers and test children have stopped, the branch is pushed
and the working tree is clean. Ignored eval results contain only reproducible synthetic evidence.
