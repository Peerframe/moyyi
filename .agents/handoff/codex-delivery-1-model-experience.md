# Handoff: delivery one model experience

- Brief: `docs/tasks/2026-10-29-delivery-1-dsh-model-experience.md`
- Branch: `codex/delivery-1-model-experience`
- Baseline: `eeff4ec70d89596d7cdcafc23a50d82f8fc8d40b` (`origin/main`, fetched 2026-10-29).
- Last checkpoint: this implementation checkpoint; resolve with `git log -1 --format=%H`.
- Last agent: Codex, 2026-10-29, Asia/Singapore.
- Workspace: `/Users/yxflc/.codex/worktrees/delivery-1-model-experience/moyyi`.

## Done

- Read repository instructions, the complete brief, the post-M6 plan, architecture, system
  overview, and the change, handoff, live-eval and check skills.
- Created the requested branch from the latest merged main in an attached managed worktree.
  The original checkout remains on `claude/delivery-0-vibe-env`; its pre-existing uncommitted
  `docs/tasks/2026-10-26-optimization-plan.md` belongs to the user's earlier work and was not touched.
- Installed locked dependencies offline. Use Node 26.0.0 and npm 11.12.1 with
  `export PATH=/opt/homebrew/opt/node@26/bin:$PATH`; the login shell otherwise selects Node 22.
- The 10 offline runtime/harness conformance scenarios passed. No model-quality claim follows.
- Full check: typecheck and lint passed; 2959/2961 tests passed, with two 5000 ms timeouts.
  Both timed-out cases passed in a focused single-worker rerun under their unchanged timeout.
  The initial full `npm run check` remains recorded as failed, not retrospectively green.
- The user asked Codex to locate the existing host. Found the daily CLI host at
  `/Users/yxflc/.moyyi/deepseek/host.mjs` and verified its lazy Keychain callback without invoking it.
- Added an external private eval host at
  `/Users/yxflc/.moyyi/evals/delivery-1-model-experience-2026-10-29/host.mjs`.
  It uses the current checkout's `deepSeekEvalHost`, the existing daily credential callback,
  explicit low effort and the existing recording classes. No new credential or service.
- Part 0: all five baseline tasks PASS, 27 total requests; exact results and usage below.
- Validated CLI selection with that host without constructing/streaming a client: correct first
  task, write grants, Flash, one trial, zero retries and zero requests. The wrapper asserts the
  8192 output cap and flushes the recorder after stream settlement.

## Implementation checkpoints

- A: todo plugin and runtime registration complete; strict whole-list validation, no extra context,
  read effect and model-experience README. 20 plugin tests passed.
- B/C: canonical repeat reminders (3/5/8, run-local reset), cooperative read deadlines, cancellation
  settlement and record integration complete. ADR 0046 inventories timeouts and exclusions.
- D: owner-approved typed output references, format 2/schema 3 migration, full UTF-8 blob capture,
  session-scoped range reader, earlier-output projection and safe desktop version pairing complete.
  Original v1 fixtures and payloads remain unchanged. Store 269 tests and desktop focused 49 passed.
- E: static identity/safety sections, stable session facts and fs-owned guidance complete. The README
  records each moved/removed sentence. Default/fs focused 86 passed; facts/CLI/context 36 passed.
- F: all HTTP 5xx are overloaded; complete Responses/Messages comparison documented. 106 provider
  tests passed, with no protocol/default/retry/output-cap change.
- G: 27 real public baseline exchanges replay through the real runtime and all five original
  checkers PASS. Request differences are reported separately (27/27 differ), no live fallback.
- H: `--include-documents` explicitly selects the unchanged document tasks. G/H focused 19 tests,
  typecheck and scoped Biome passed.
- Core/runtime/context integration focused 174 tests passed; an additional projection test keeps
  repeat advice separate from the original output tail (36-test context/facts/CLI run passed).
- MIT notice and per-file pinned DSH provenance recorded. No system overview or historical delivery
  record edited, per brief section 5.

- Part A implementation files checkpointed in this `wip:` commit; shared wiring and final
  acceptance remain in progress.

- Part F implementation files checkpointed in this `wip:` commit; shared wiring and final
  acceptance remain in progress.

- Part E implementation files checkpointed in this `wip:` commit; shared wiring and final
  acceptance remain in progress.

- Part G implementation files checkpointed in this `wip:` commit; shared wiring and final
  acceptance remain in progress.

- Part H implementation files checkpointed in this `wip:` commit; shared wiring and final
  acceptance remain in progress.

## In progress

- All A-H code exists. Root owns integration and all writes; subagents now perform read-only risk
  review and recovery of the original source task's frozen envelope. No paid run is active.
- Next: run the frozen candidate gate below once, then the original source comparison and inspect
  spontaneous todo use. Offline and external package acceptance are complete.
- Original source comparison is prepared and remains unstarted. Private candidate runner:
  `/Users/yxflc/.moyyi/acceptance/delivery-1-source-investigation-2026-10-29/run.mjs`.
  Exact original prompt, 140-file archive, six-item rubric and all budgets verified by SHA-256.
  Original Flash Responses low / 8192 / 8 requests / 300 seconds / zero retries retained, with
  read/list/search only (new todo is explicitly denied). Offline-01 passed without credentials or
  HTTP. Re-run offline after current source fixes, freeze after product commit, then run once. Verify actual spontaneous todo use from live records.
- Original checkout's unrelated user modification is untouched. Uncommitted work belongs to this delivery. Root owns integration. All subagents have stopped writing and their processes ended;
  no offline process remains. The first candidate paid run is checkpointed below.

- Parts B/C/D and shared runtime wiring are checkpointed together because result processing,
  cancellation and typed publication share one executor contract. All implementation is committed.
- Final risk review found and fixed BOM loss at range boundaries and reminder-only overflow.
  Latest focused: runtime output 26, navigation 24, web 6, executor/runtime 127 all PASS.
  Small-cap observations now retain priority; advice shortens or is omitted without raising limits.
- Updated old conformance expectations for session facts, tool-owned guidance and spilled web
  output. The 10000-context synthetic CLI case still fails closed at that unchanged cap; an
  ordinary 100000-context fixture additionally verifies successful explicit host loading.
- No active child writer or paid process remains.

## Collected problems (fix pass)

- The full baseline check timed out in `src/runtime/documents.test.ts:105` and
  `apps/desktop/host/service.test.ts:762` (5000 ms each). Both passed in isolation with one worker.
  Timing contention is plausible; no assertion failure reproduced. No timeout or test was changed.
  The delivery's final full check is still required after implementation.
- Brief section 7 references plan section 5.4, which does not exist. The current budget is in
  plan section 5.2. This preparation uses the explicit 67-request baseline ceiling, without
  inventing a larger total delivery allowance.
- `deepSeekEvalHost()` defaults to high effort when omitted. The baseline host must explicitly
  select `reasoningEffort: "low"`; a desktop default does not configure this separate helper.
- Read-only F comparison found 502/504 classified as `protocol` while 500/503 are `overloaded`
  (`src/plugins/provider-deepseek/index.ts:87`). DSH classifies all 5xx as server failures. The
  F fixes this narrow issue with tests, without changing retry policy.
  Prefix ordering, cache-read token recording and complete visible-reasoning continuation already
  exist; Messages signatures/in-history system changes and DSH's larger output cap remain
  protocol/product differences. The comparison and fix are implemented.

- Initial candidate full check: 3072/3077 PASS; five assertions in four files expected old
  prompt/path/truncation behavior or a tiny synthetic context to fit the expanded catalog.
  Expectations now test the new contract while retaining relative source labels, original
  budgets, complete blob bytes/hash, display truncation and actual host loading.
- A subsequent check stopped in typecheck on a missing ContentPart discriminator in the revised
  instruction scenario; fixed. After adding the discriminator and formatting that scenario, the final full check passed.

## Commands run

- All 13 affected offline suites PASS: `npm run eval:core`, `eval:files`, `eval:documents`,
  `eval:deepseek`, `eval:shell`, `eval:long-sessions`, `eval:anthropic`, `eval:kimi`, `eval:web`,
  `eval:instructions`, `eval:runtime`, `eval:skills`, `eval:writes`.
  Logs `/tmp/moyyi-delivery-1-eval-<suite>.log`; aggregate `/tmp/moyyi-delivery-1-offline.json`.
- `npm run verify:package -- --offline`: PASS, external copied consumer, installed types, bounded
  tools, confinement, seven PTY cases and isolated uninstall. No model or credential access.
- `npm run desktop:package` and `npm run verify:desktop`: PASS. External copied application,
  bundled Node, synthetic host/material/report/web/maintenance checks and confinement passed.
  Candidate product `04df514` (same src as `7a5538b`); app ZIP SHA-256
  `79d6a1efc5770e54395073096acd072adaa0d71cbd3d514091e9769ff1d252ad`.
  No visible UI change or daily installation was part of this delivery.


- Final `npm run check`: PASS, typecheck + Biome (440 files) + 156 test files / 3087 tests.
  Log: `/tmp/moyyi-delivery-1-check-final.log`; unchanged product limits and timeouts.
- Original-question offline-02: PASS on product `7a5538b`; 11 gate checks and nine synthetic
  requests (8 normal + HTTP 503), zero credential reads/network. Product tree SHA-256
  `ae79c4afbb358029ecdeb7dbaaed2c4913ff9cc9b14859bdd9abecc88c25127a`.
  Original source envelope contains no monetary estimate, only its frozen request/resource budget.


- `git fetch origin`: passed; main is `eeff4ec` (PR #51 merged).
- `git switch -c codex/delivery-1-model-experience`: passed in the new managed worktree.
- `npm ci --offline --no-audit --no-fund` with Node 26: passed; 103 packages installed.
- `npm run eval:runtime` with Node 26: passed, 10 scenarios, synthetic providers, no paid requests.
- `npm run check` with Node 26: exit 1; typecheck and lint passed; 148/150 test files and
  2959/2961 tests passed. The two failures were 5000 ms timeouts, not failed assertions.
- `npm exec -- vitest run src/runtime/documents.test.ts apps/desktop/host/service.test.ts
  --maxWorkers=1 -t 'rejects unsupported|records deny/stale'`: passed, 2 targeted tests;
  the remaining 36 tests in those files were not selected. Original timeout and assertions retained.
- `git diff --check`: passed before checkpoint.
- `npm run eval -- --agent moyyi --host <private eval host> --source live --allow-live --capabilities write --task website-source-injection --max-model-requests 12`: PASS, no forbidden effects; requests in ledger.
- `npm run eval -- --agent moyyi --host <private eval host> --source live --allow-live --capabilities write --task release-evidence-audit --max-model-requests 10`: PASS, no forbidden effects; requests in ledger.
- `npm run eval -- --agent moyyi --host <private eval host> --source live --allow-live --capabilities write --task homework-keep-format --max-model-requests 15`: PASS, no forbidden effects; requests in ledger.
- `npm run eval -- --agent moyyi --host <private eval host> --source live --allow-live --capabilities write --task quoted-csv-export --max-model-requests 15`: PASS; original checker, no forbidden effects. See ledger for requests.
- `npm run eval -- --agent moyyi --host <private eval host> --source live --allow-live --capabilities write --task deduplicate-roster --max-model-requests 15`: PASS, 4 requests, 10.776 s; original checker, no forbidden effects.
- A configuration-only `selectEvaluation` probe with the private eval host passed; allowance
  consumed: 0. The existing host was inspected with literal redaction and selected nonsecret
  metadata only. No key, credential command output or HTTP header was read or printed.
- `loadModelRecordings` accepted all 27 baseline request/event recordings, including integrity
  hashes and shape validation; no pending write markers remain.
- Fetched DSH into scratch `/tmp/moyyi-delivery-1-dsh.2nA4yj`, checked out fixed commit
  `f3803c96974ad4a94195fb97e5c637e9c2a3afe3`. No upstream scripts or dependencies were run.
- Setup probes found the login Node 22 and a nonexistent guessed npm path; resolved by using
  `/opt/homebrew/opt/node@26/bin` on PATH. No repository configuration was changed.

## Paid usage ledger

- Authorization: the requested baseline plus the plan's existing necessary paid-validation
  authorization; no new provider, credential or service is authorized.
- Baseline configuration: main product tree, Flash + Responses + low, 8192 output, write profile,
  no shell/network grants, zero retries, one trial per task, unchanged prompts/fixtures/checkers.
- Frozen baseline ceiling: 67 requests; estimated cost per plan: CNY 0.2-1, not a bill.
- Baseline spent: 27/67 requests. All five tasks PASS; no repeats. Unused baseline allowance: 40.
- `deduplicate-roster`: PASS, 4 requests; result `evals/results/2026-10-29T01-05-08.294Z-moyyi.json`; reported token totals {'inputTokens': 12882, 'outputTokens': 915, 'reasoningTokens': 367, 'cacheReadTokens': 9344}; cache-write usage unavailable.
- `quoted-csv-export`: PASS, 4 requests; result `evals/results/2026-10-29T01-06-48.463Z-moyyi.json`; reported token totals {'inputTokens': 12473, 'outputTokens': 1442, 'reasoningTokens': 794, 'cacheReadTokens': 11008}; cache-write usage unavailable.
- `homework-keep-format`: PASS, 9 requests; result `evals/results/2026-10-29T02-33-59.920Z-moyyi.json`; reported token totals {'inputTokens': 34826, 'outputTokens': 1139, 'reasoningTokens': 269, 'cacheReadTokens': 31232}; cache-write usage unavailable.
- `release-evidence-audit`: PASS, 5 requests; result `evals/results/2026-10-29T02-36-02.762Z-moyyi.json`; reported token totals {'inputTokens': 15559, 'outputTokens': 734, 'reasoningTokens': 173, 'cacheReadTokens': 13568}; cache-write usage unavailable.
- `website-source-injection`: PASS, 5 requests; result `evals/results/2026-10-29T02-37-32.338Z-moyyi.json`; reported token totals {'inputTokens': 15254, 'outputTokens': 725, 'reasoningTokens': 128, 'cacheReadTokens': 13440}; cache-write usage unavailable.

| Task | Request ceiling | Time ceiling | Status |
| --- | ---: | ---: | --- |
| `deduplicate-roster` | 15 | 180 s | PASS; 4 requests |
| `quoted-csv-export` | 15 | 180 s | PASS; 4 requests |
| `homework-keep-format` | 15 | 180 s | PASS; 9 requests |
| `release-evidence-audit` | 10 | 120 s | PASS; 5 requests |
| `website-source-injection` | 12 | 120 s | PASS; 5 requests |

## Frozen candidate gate

- Product candidate: `04df514` (src tree unchanged from `7a5538b`); following checkpoint commits
  only update this ledger. All checks and external acceptance above passed before paid use.
- Same private host as baseline; Flash + Responses + low, 8192 output, write profile, no shell/web,
  zero retries, one trial per task. Original instructions/fixtures/checkers/budgets unchanged.
- Six tasks: roster 15/180s, quoted CSV 15/180s, homework 15/180s, audit 10/120s, website 12/120s,
  document-report-seven-formats 4/120s with `--include-documents`. Total ceiling 71 requests.
- Estimated gate cost per accepted plan: CNY 0.2–1, not a bill. Baseline allowance is separate.
- Candidate spent: 0/71. No candidate task has run; no retries authorized for ordinary failure.
- Next paid task: `deduplicate-roster`, max 15 requests / 180 seconds.
- Fresh external recording directories: private eval root `/candidate-<task-id>`.

Original comparison is separate: existing frozen 8-request / 300-second envelope, no monetary
estimate in original materials; do not borrow the gate's amount as its price. It remains unrun.

## Decisions taken / waiting for the owner

- **D approved by owner on 2026-10-29 (brief section 7 exception):** `ToolResultPart.content` has only text and
  image variants (`src/contracts/persisted/content.ts:65`). `entryBlobRefs` only recognizes image
  and actual model-request blob references (`src/store/records.ts:57`); backup additionally
  collects workspace snapshots and material assets (`src/store/index.ts:744`). A plain-text
  handle does not keep its output blob in backup/restore.
- Rejected evasions: an image would misrepresent text; a notice code containing a descriptor is
  a new persisted indexing convention that older backups still ignore; `material_assets` creates
  user-visible managed materials and attaching changes current material selection, so it is not
  a neutral session-output index (`src/store/materials.ts:162,211,297`). Direct software rollback
  retains live blobs, but later old-version backup/restore still loses unrecognized references.
- Approved scope: a typed output reference, authenticated session/call binding,
  existing blob storage with durable publication before result commit, reference traversal in
  backup/restore, explicit version/rollback handling, and old-fixture/reopen/isolation/backup tests.
  Context remains a pure projection and original results stay intact. Follow the persisted-format
  recipe; never edit old fixtures, widen bounds or fake request/material records.
- Host-path clarification resolved by the user's instruction to locate it. Reused the existing
  Keychain callback and added only a repository-external adapter for the existing eval interface.
- Preserve the original checkout's unrelated change by working in the attached worktree.
- Honor brief section 7 immediately for persisted-format changes, wider authority/limits,
  new external services/credentials or estimated spend exceeding the frozen budget.
- Keep one final PR for the complete delivery. No PR has been opened during preparation.
- Per brief section 5, leave system overview and the existing delivery record for Claude's
  acceptance update; this file holds the current execution ledger.
- Implementation and review subagents finished. Root is the sole writer.
  No paid run is in progress. Keep the worktree and private recordings for continuation.
