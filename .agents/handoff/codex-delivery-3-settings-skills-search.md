# Handoff: delivery three — settings, Skills and search

- Brief: `docs/tasks/2026-10-30-delivery-3-settings-skills-search.md`
- Branch: `codex/delivery-3-settings-skills-search`
- Base / last implementation commit: `26ecc5a3d556dce22bb5d75f50e82a5828d2ae7b` (latest fetched main).
- Worktree: `/Users/yxflc/.codex/worktrees/delivery-3-settings-skills-search/moyyi`.
- Last agent: Codex, 2026-10-30 20:44 Asia/Singapore.
- Status: **Billing stop resolved by the owner on 2026-10-30; resume A–H.** No product implementation yet.

## Done

- Read the full delivery brief, repository instructions, system overview, architecture,
  desktop-feature recipe and all six requested workflow skills. Owner decisions D3-1–D3-4
  remain accepted; they were not reopened.
- Fetched `origin/main` and created the requested branch in a separate managed worktree.
  The original checkout remains on `claude/delivery-0-vibe-env` with its existing modification
  to `docs/tasks/2026-10-26-optimization-plan.md`. No commands wrote that checkout's files.
- Performed read-only search and provider preflight. Both delegated investigators stopped;
  neither changed product files, accessed credentials nor left background processes.
- DSH reference checkout: `/tmp/moyyi-delivery3-dsh`, pinned to
  `f3803c96974ad4a94195fb97e5c637e9c2a3afe3`. Read as source only; no scripts/dependencies run.

## Owner resolution (2026-10-30, recorded by Claude)

- D3-1a: accept the announced native-search fee (USD 0.75 per 1,000 successful non-empty searches
  from 2026-11-01) and keep DeepSeek native search. `max_uses` stays 5. The extra search fee is
  authorized.
- D3-3a: the acceptance allowance of 3 searches counts product-side `web_search` invocations; each
  may trigger at most 5 billed native searches (at most 15). All other budgets and constraints are
  unchanged.
- Brief sections 4 E, 6, 7, 8 and 10 are amended on this branch. Record `usage.server_tool_use`
  per product search; write "unknown" when absent.
- The owner may self-host a search service later; it is recorded in the roadmap as out of scope.


A–H have not been implemented. The billing discrepancy below is resolved (see Owner resolution). No PR has been opened, merged or installed.

Exact next step: pull this branch (Claude pushed the brief amendment and this update), then
implement A–H on this branch. Do not restart from the original checkout or repeat this preflight
without new evidence.

## Stop condition and evidence

Brief section 7 requires stopping if native-search billing materially differs from the brief.
Section E and decision D3-1 describe each product search as one extra Flash paid call. Official
documentation checked on 2026-10-30 explicitly adds a separate search-call charge:

- [Search & Fetch billing](https://api-docs.deepseek.com/guides/search/#billing): server-side
  search calls used by DeepSeek Harness/Claude Code/Codex are currently free, but from
  **2026-11-01 00:00 Beijing time (also Asia/Singapore)** each successful, non-empty search
  costs **USD 0.75 per 1,000 calls**. Failed/empty/time-out calls are not billed.
- [Models & Pricing](https://api-docs.deepseek.com/quick_start/pricing/#search--fetch-pricing)
  independently states the same effective date and separate per-request pricing; model tokens
  remain separately charged.
- [Anthropic server-tool usage](https://api-docs.deepseek.com/guides/anthropic_api/#server-tool-usage)
  applies to `POST /anthropic/v1/messages`, the exact endpoint in the brief. Its
  `usage.server_tool_use.tool_search` counts successful non-empty searches, not result rows.
  `web_search_requests` counts attempts, including rejected calls, and can exceed `max_uses`.
- [Native web-search integration](https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code/#using-web-search-in-claude-code)
  explicitly links native web-search calls to Search API billing in addition to model tokens.

Inference: with the specified `max_uses: 5`, one product `web_search` invocation can incur
multiple separately billed successful native searches, rather than only model-token charges.
The announced fee is not yet in effect on the investigation date; it is a documented upcoming
change directly affecting this delivery, not a charge observed in a live test.

Structured sources are supported according to the official Anthropic documentation and the
pinned DSH parser. **Do not report that structured results are unavailable.** No paid probe was
needed to establish the billing discrepancy.

Suggested resolution for owner review, not authorization: retain the selected backend and
credentials, disclose model tokens plus successful native-search charges, and define whether
the acceptance allowance of three searches counts product invocations or native successful
searches. Keep the existing request ceilings and zero retries; do not silently reinterpret them.

## Reusable preflight findings

- DSH `packages/web/web-search-deepseek/src/provider.ts`: endpoint at line 34,
  `max_tokens` at line 43, `max_uses` at line 46, structured parser at lines 157–185, request at
  lines 225–258. Its README notes a full model turn plus server-side searches and that structured
  results often lack snippets. Never synthesize source excerpts from model prose.
- Existing `src/contracts/persisted/transcript.ts` already records assistant `origin`.
  `src/contracts/model.ts` and `src/context/index.ts` currently omit that origin in the
  nonpersisted model projection. Passing origin into codecs should allow foreign-provider
  reasoning/replay filtering without a store-format/schema change. This is a code-inspection
  finding, not an implemented or tested guarantee.
- Kimi's bounded structured parser already recognizes `exceeded_current_quota_error`; it is
  currently classified as `auth`. B requires `quota`. Foreign DeepSeek tool calls currently
  fail Kimi's `providerItemId === null` validation; preserve paired call IDs while dropping
  foreign provider-only item metadata.
- `RunOutcome` in `src/contracts/protocol.ts` currently retains failure text without the model
  error kind; `src/core/index.ts` needs nonpersisted kind propagation for the unavailable-card
  projection. The recording error-kind whitelist in `src/runtime/model-recording.ts` also
  needs `quota`. Keep interruption/completeness checks and old recorded requests unchanged.
- Delivery-one private host located by filename only (contents and credentials not read):
  `/Users/yxflc/.moyyi/evals/delivery-1-model-experience-2026-10-29/host.mjs`.
  Its prior ledger can be recovered with
  `git show 95f45a3:.agents/handoff/codex-delivery-1-model-experience.md`.

## Collected problems (fix pass)

None beyond the mandatory stop above. No unrelated implementation changes started.

## Commands run

- `git status --short`, `git branch --show-current`, `git remote -v`: identified original
  checkout and existing uncommitted change.
- `git fetch origin main`: succeeded; base is `26ecc5a3d556dce22bb5d75f50e82a5828d2ae7b`.
- Managed worktree creation, then `git switch -c codex/delivery-3-settings-skills-search`:
  succeeded; initial worktree clean.
- `node --version`: `v26.0.0`.
- Read-only `cat`, `sed`, `rg`, `git show` and official documentation lookups for preflight.
- `npm run check`, offline suites, packaging, native UI and live acceptance: **not run**.
  Stopped before product edits; there is no candidate implementation to validate.

## Paid usage ledger

- Quality gate frozen ceiling: 71 model requests; spent **0**, remaining **71**.
- Installed acceptance frozen ceiling: 20 model requests plus 3 searches; spent **0 + 0**,
  remaining **20 + 3**. Search counting awaits the above decision, without increasing the cap.
- Zero retries; no failed task reruns. No model or search API requests were sent.
- No keys read, printed or copied. Daily app, CLI, settings and session store were not opened
  or modified by this work.

## Decisions taken / waiting for the owner

- All four section 10 decisions remain as supplied.
- Waiting only for resolution of the explicit section 7 billing stop. No alternative backend,
  additional credential type, request-budget increase or daily-install replacement is authorized
  by this checkpoint.
- This file is the only delivery progress record so far. Keep it until work resumes; after
  completed delivery move durable evidence into the final record as required by the brief.
