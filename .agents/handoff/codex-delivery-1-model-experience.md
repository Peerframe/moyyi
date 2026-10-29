# Handoff: delivery one model experience

- Brief: `docs/tasks/2026-10-29-delivery-1-dsh-model-experience.md`
- Branch: `codex/delivery-1-model-experience`
- Baseline: `eeff4ec70d89596d7cdcafc23a50d82f8fc8d40b` (`origin/main`, fetched 2026-10-29).
- Last checkpoint: this preparation commit; resolve with `git log -1 --format=%H`.
- Last agent: Codex, 2026-10-29 09:01, Asia/Singapore.
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

## In progress

- Part 0 has **not run**. No product code has changed; parts A-H have not started.
- The user's private host path is still the literal placeholder `<填写路径>` in the request.
  An asynchronous question asks for the actual absolute path. Do not read or print credentials.
- Once the host path arrives, validate its `RuntimeEvalHost` export, lazy client construction,
  explicit low reasoning, Flash/Responses profile and the 8192 output cap without sending a
  probe request. A CLI `RuntimeOptions` module is not the eval-host contract.
- Before any baseline request, configure an external private recording wrapper using existing
  `RecordingModelClient` and `FileRecordingSink`; await `flush()` after each stream is settled.
  Store public-fixture request/event recordings for part G outside git until privacy review.
  The current eval adapter deletes its temporary database and workspace after a trial and its
  JSON result contains aggregates only. Do not discover this after spending the baseline.
- Freeze the confirmed host configuration, recording location and the per-task manifest below,
  checkpoint and push, then run the five tasks sequentially once. Record checker results,
  requests and usage; remove baseline FAIL tasks from the later gate. Only after the baseline
  completes may implementation start.

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
- Setup probes found the login Node 22 and a nonexistent guessed npm path; resolved by using
  `/opt/homebrew/opt/node@26/bin` on PATH. No repository configuration was changed.

## Paid usage ledger

- Authorization: the requested baseline plus the plan's existing necessary paid-validation
  authorization; no new provider, credential or service is authorized.
- Baseline configuration: main product tree, Flash + Responses + low, 8192 output, write profile,
  no shell/network grants, zero retries, one trial per task, unchanged prompts/fixtures/checkers.
- Frozen baseline ceiling: 67 requests; estimated cost per plan: CNY 0.2-1, not a bill.
- Spent: 0 requests. Remaining baseline allowance: 67. No recordings or live results exist yet.

| Task | Request ceiling | Time ceiling | Status |
| --- | ---: | ---: | --- |
| `deduplicate-roster` | 15 | 180 s | Not run |
| `quoted-csv-export` | 15 | 180 s | Not run |
| `homework-keep-format` | 15 | 180 s | Not run |
| `release-evidence-audit` | 10 | 120 s | Not run |
| `website-source-injection` | 12 | 120 s | Not run |

The seven-format document task joins the gate only after part H. Candidate runs and the original
source-analysis comparison are not started; recover their frozen configuration before use.

## Decisions taken / waiting for the owner

- Waiting for the actual private host module path. This is missing input, not a request to
  reapprove the already authorized baseline.
- Preserve the original checkout's unrelated change by working in the attached worktree.
- Honor brief section 7 immediately for persisted-format changes, wider authority/limits,
  new external services/credentials or estimated spend exceeding the frozen budget.
- Keep one final PR for the complete delivery. No PR has been opened during preparation.
- Per brief section 5, leave system overview and the existing delivery record for Claude's
  acceptance update; this file holds the current execution ledger.
- The read-only preflight subagent and all local check processes have finished. There are no
  other implementation writers or paid runs in progress.
