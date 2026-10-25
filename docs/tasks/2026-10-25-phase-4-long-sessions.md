# Phase 4: recovery and long sessions

## Authorization and checkout

Owner authorized review/merge of PR #13, then phase 4 on a new branch/PR. The new PR must not
auto-merge. No paid model calls, real credentials, phase 5 or changes to persisted v1.
Accepted D1–D6 remain unchanged. Directory: `/Users/yxflc/Project/moyyi`.
Branch: `codex/phase-4-recovery-long-sessions`, directly from main `3e0202a`.

PR #13 was independently reviewed at fixed head `fff03088342e5a190939a771e9d6efe8a88199bc`.
`npx vitest run src/runtime/processes.test.ts src/runtime/sandbox.test.ts tests/runtime-shell.test.ts tests/shell-process.test.ts src/core/executor.test.ts src/policy/index.test.ts src/plugins/shell/index.test.ts`
passed **115/115**. [Head CI](https://github.com/Peerframe/moyyi/actions/runs/40177244435) passed;
the PR was merged with an exact-head guard as `3e0202ac5a202331cbf9e641241f9462baed6e06`.
[Merged main CI](https://github.com/Peerframe/moyyi/actions/runs/40178362029) passed. No direct
push to main was made. Accepted native sandbox limitations are preserved in ADR 0013.

## Delivered behavior

- Explicit `session.compact` / CLI `/compact`, using one selected-model request, no tools or
  retry, normal run lifecycle/deadline/cancellation. It retains recent turns and chooses only
  a safe older prefix. This adds no automatic paid calls; a user invoking it with a paid host
  incurs that provider's normal request cost.
- Existing v1 compaction entries replace older content only in the rendered context. Original
  entries/blobs remain immutable. Summary request, response and usage are an audit sibling;
  publishing a summary and selecting its head is atomic. Rejected summaries do not change the
  active path. A deadline racing successful publication reports the already committed result
  truthfully as completed, rather than claiming the summary was prevented.
- Replaced replay is excluded; untouched retained messages remain unchanged. Reasoning is
  audit-only for summary generation. Refused, truncated, empty, tool-calling or non-reducing
  summaries are refused. No summary grants authority or settles an unknown action.
- Stable section/tool ordering, visible conservative budget, and long-session offline evidence.
  No provider cache-hit or cost-saving claim is inferred from deterministic request prefixes.
- Recovery interrupted after effect normalization remains resumable. The final run status,
  recovery notice/result pairing and lease decision commit together. Tests first reproduced two
  failures in the old implementation, then passed with the fix.

[ADR 0014](../decisions/0014-recovery-and-compaction.md) and [usage](../long-sessions.md)
explain design choices, operation and limits. No dependency, schema version, OpenBot source copy,
boundary-rule relaxation or public-task checker change is part of this phase.

## Acceptance evidence

Focused evidence already executed:

- `npx vitest run tests/core-recovery.test.ts tests/compaction-process.test.ts`: **23/23**.
  Includes **12** original-run SIGKILL points, **6** recovery-of-recovery SIGKILL points and
  **2** compaction publication boundaries; existing reconciliation cases remain.
- `npm run eval:long-sessions`: **4/4** offline scenarios. The long path drives 24 turns,
  compacts, reopens, performs a real file read and compacts again. Rejection cases cover tool
  calls, truncation and refusal. Originals, continued context and canaries are checked through
  public runtime commands; direct head/integrity checks remain in integration tests.
- `npx vitest run src/cli/session.test.ts`: **22/22**.
- `npx vitest run tests/cli-compaction.test.ts`: **1/1**, real runtime/SQLite via the CLI client.

- `npx vitest run src/context/index.test.ts tests/runtime-compaction.test.ts tests/runtime-core.test.ts`:
  **61/61**, including real DeepSeek codec with synthetic reasoning SSE, cancellation/timeout,
  publication rollback, repeat compaction and rejected tool-call audit recovery.
- `npx vitest run tests/compaction-publication.test.ts`: **6/6**, cancel/timeout before,
  during and after publication. A disposable deferred-store probe first reproduced the old
  mismatch (new head present but reported budget exhaustion); the regression verifies the fix.
- Independent review found no remaining blockers after that fix.
- `npm run eval:deepseek`: **6/6**; `npm run eval:core`: **8/8**.
- `npm run build` and `node dist/cli/main.js --help`: passed, including `/compact` help.
- Changed-document relative links: **100 checked, none missing**.

The first full-gate attempt passed typecheck/lint and 1,190 tests, but the boundary test correctly
rejected a direct store import from the new eval. The eval was changed to inspect public runtime
commands/events and actual continuation requests; the boundary rule and previous checkers were
not relaxed. Direct SQLite/head assertions remain in the integration tests.

Final `npm run check` passed: typecheck, Biome (**172 files**) and **1,197/1,197 tests in
55 files**. `npm run build` passed after the final production change. Persisted v1, boundary
rules and public-task checkers are unchanged (`git diff --quiet -- ...` passed). Final branch
CI is linked on the PR; it must pass before this delivery is considered ready for review.

## Remaining verification and limits

- No live DeepSeek request, paid task evaluation, semantic-summary recall benchmark or actual
  provider cache-hit measurement. Synthetic SSE tests exercise the real codec, not the remote
  service. Scripted summaries contain expected facts by construction and do not prove quality.
- Compaction is explicit and bounded to one summary request. It does not recursively chunk an
  already oversized source; compact earlier or start a new session. No automatic background
  memory, new model/provider, web tool, training, GUI or phase 5 work.
- Existing DeepSeek continuation restrictions and native sandbox guarantees remain. Unsettled
  actions remain visible and are not replayed; manual inspection may still be needed.
- Planned `project-instructions` and phase 1 live-model acceptance remain separate gaps. Later
  implementation milestones do not retroactively establish those acceptances.

## Owner decisions

No new owner-reserved choice is required for this phase's bounded implementation. Review the
new PR; it is intentionally left unmerged. Phase 5 requires a later instruction.
