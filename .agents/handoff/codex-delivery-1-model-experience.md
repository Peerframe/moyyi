# Handoff: delivery one model experience

- Brief: `docs/tasks/2026-10-29-delivery-1-dsh-model-experience.md`
- Branch: `codex/delivery-1-model-experience`
- Baseline: `eeff4ec70d89596d7cdcafc23a50d82f8fc8d40b` (`origin/main`, fetched 2026-10-29).
- Last checkpoint: this preparation commit; resolve with `git log -1 --format=%H`.
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
- Validated CLI selection with that host without constructing/streaming a client: correct first
  task, write grants, Flash, one trial, zero retries and zero requests. The wrapper asserts the
  8192 output cap and flushes the recorder after stream settlement.

## In progress

- **Stopped under brief section 7, awaiting the owner's decision about D's persisted reference.**
  No product code has changed; parts A-H have not started. Two baseline tasks passed; the third
  has not started. Do not repeat the two completed paid trials.
- Proposed decision: authorize a formal tool-output blob reference and the necessary persisted
  compatibility work, preserving old data and all existing permission/output/blob bounds;
  otherwise the owner must revise D's cross-version backup/restore guarantee. No implementation
  or format change has been made in anticipation of approval.
- After the decision is recorded, finish part 0 before changing product code. The next task is
  `homework-keep-format`, using the private eval host and `MOYYI_DELIVERY_RECORDING_DIR` set to the
  private evaluation folder above plus `/baseline-homework-keep-format`. Record each result and
  request count before continuing. Each recording directory must be fresh.
- The current eval adapter deletes temporary databases and workspaces; the external wrapper
  keeps exact common requests and response events for G. Result JSON files remain ignored under
  `evals/results/`. Review recordings for privacy before committing any replay fixture.
- Baseline FAIL tasks leave the later gate; provider unavailability is distinct. Implementation
  begins only after the baseline is complete. No paid probe or speculative extra run is planned.

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
  future F implementation can fix this narrow issue and test it without changing retry policy.
  Prefix ordering, cache-read token recording and complete visible-reasoning continuation already
  exist; Messages signatures/in-history system changes and DSH's larger output cap remain
  protocol/product differences. No provider change has been made.

## Commands run

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
- `npm run eval -- --agent moyyi --host <private eval host> --source live --allow-live --capabilities write --task quoted-csv-export --max-model-requests 15`: PASS; original checker, no forbidden effects. See ledger for requests.
- `npm run eval -- --agent moyyi --host <private eval host> --source live --allow-live --capabilities write --task deduplicate-roster --max-model-requests 15`: PASS, 4 requests, 10.776 s; original checker, no forbidden effects.
- A configuration-only `selectEvaluation` probe with the private eval host passed; allowance
  consumed: 0. The existing host was inspected with literal redaction and selected nonsecret
  metadata only. No key, credential command output or HTTP header was read or printed.
- `loadModelRecordings` accepted all 8 baseline request/event recordings, including integrity
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
- Spent: 8 requests. Remaining baseline allowance: 59. No repeats.
- `deduplicate-roster`: PASS, 4 requests; result `evals/results/2026-10-29T01-05-08.294Z-moyyi.json`; reported token totals {'inputTokens': 12882, 'outputTokens': 915, 'reasoningTokens': 367, 'cacheReadTokens': 9344}; cache-write usage unavailable.
- `quoted-csv-export`: PASS, 4 requests; result `evals/results/2026-10-29T01-06-48.463Z-moyyi.json`; reported token totals {'inputTokens': 12473, 'outputTokens': 1442, 'reasoningTokens': 794, 'cacheReadTokens': 11008}; cache-write usage unavailable.

| Task | Request ceiling | Time ceiling | Status |
| --- | ---: | ---: | --- |
| `deduplicate-roster` | 15 | 180 s | PASS; 4 requests |
| `quoted-csv-export` | 15 | 180 s | PASS; 4 requests |
| `homework-keep-format` | 15 | 180 s | Not run |
| `release-evidence-audit` | 10 | 120 s | Not run |
| `website-source-injection` | 12 | 120 s | Not run |

The seven-format document task joins the gate only after part H. Candidate runs and the original
source-analysis comparison are not started; recover their frozen configuration before use.

## Decisions taken / waiting for the owner

- **D requires owner decision (brief section 7):** `ToolResultPart.content` has only text and
  image variants (`src/contracts/persisted/content.ts:65`). `entryBlobRefs` only recognizes image
  and actual model-request blob references (`src/store/records.ts:57`); backup additionally
  collects workspace snapshots and material assets (`src/store/index.ts:744`). A plain-text
  handle does not keep its output blob in backup/restore.
- Rejected evasions: an image would misrepresent text; a notice code containing a descriptor is
  a new persisted indexing convention that older backups still ignore; `material_assets` creates
  user-visible managed materials and attaching changes current material selection, so it is not
  a neutral session-output index (`src/store/materials.ts:162,211,297`). Direct software rollback
  retains live blobs, but later old-version backup/restore still loses unrecognized references.
- Recommended scope after approval: a typed output reference, authenticated session/call binding,
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
- Both read-only subagents and all local processes have finished. There are no implementation
  writers or paid runs in progress. Keep the worktree and private recordings for continuation.
