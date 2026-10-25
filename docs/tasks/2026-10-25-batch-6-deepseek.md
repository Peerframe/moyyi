# Batch 6 implementation and review handoff

Historical delivery record. PR #10 was subsequently reviewed and merged as `8fce38e` after
its head CI passed; merged main CI also passed. Current scope is in the
[batch 7 handoff](2026-10-25-batch-7-cli.md). The original authorization below is historical.

Owner authorization (2026-10-25): review PR #9, merge after review and CI, then deliver batch 6
on a new branch/PR. Do not automatically merge the new PR, make paid calls, access credentials
or start batch 7. D1–D5 remain accepted. Persisted v1, SQLite schema, original task criteria,
layer boundary rules and CI are unchanged.

## Merged prerequisite

Reviewed #9 at `41d1e327608e08f1d1d2725d1da8f2a346e96679` against `4cc8b3a`. Independent review
found no additional blocker; 88 file plugin/host/runtime tests passed, including a separate
protected-root alias probe for read/list/search. Root's focused 52-test subset and file eval 8/8
also passed. These supplement, rather than relabel, the existing 736-test full check.

[PR head CI](https://github.com/Peerframe/moyyi/actions/runs/40167037649) passed. The authorized
merge is `15ac933011703122e9911adaa77866ebeaab5c64`; its
[main CI](https://github.com/Peerframe/moyyi/actions/runs/40167228894) passed. This batch uses
`codex/batch-6-deepseek`, created from that pulled main, with no dependent PR or direct main push.
PR #9's description records this review and supersedes its earlier pending-merge status.

## Delivered behavior

- `provider-deepseek` renders the official `deepseek-flash` Responses text/function subset,
  preserves full visible reasoning and validates bounded SSE/lifecycle/terminal consistency.
  Unsupported or incomplete history is rejected before HTTP. Missing usage is unknown.
- Host HTTP uses a fixed official URL, explicit credential callback, no redirects or retries,
  bounded response decoding and fixed error messages. No secret lookup occurs at startup.
- Context carries the existing assistant stop reason into the nonpersisted model request port,
  so partial reasoning is never labeled complete. Frozen persisted contracts do not change.
- Optional recording captures canonical requests/common events with source/model/profile/time
  metadata and integrity hashes. Exact-request replay cannot fall back to live HTTP. The built-in
  private file sink is excluded from ordinary workspace file tools.
- The independent review reproduced and prompted fixes for consumer-return cancellation losing
  a recording and post-publication sink failure leaving a replayable successful exchange.
  Regression evidence is listed below. Custom sinks must support failure invalidation.
- Offline integration drives list/read against real files and SQLite with synthetic DeepSeek SSE,
  then verifies the replayed assistant content, tool results and effect outcomes. The new eval
  uses public runtime protocol and does not import store internals or alter existing checkers.
- `npm run demo:deepseek-replay` and `npm run eval:deepseek` expose the offline result.
  [deepseek.md](../deepseek.md) explains configuration, limitations and the owner-only live smoke.
  [ADR 0010](../decisions/0010-deepseek-transport-and-recording.md) records exact SDK comparison,
  direct-HTTP choice and recording semantics. No new dependency or copied source is introduced.

## Acceptance evidence

Local environment: macOS arm64, Node 26.0.0, npm 11.12.1.

- `npm run check`: typecheck passed; Biome checked 133 files; Vitest **889/889 tests in 34 files**
  passed. Includes the unchanged persisted-format lock, boundaries and original task checkers.
- Provider tests: 60 semantic codec cases, 16 SSE framing cases, 16 provider cases, 9 host HTTP
  cases; all use handwritten fixtures or injected fetch, not a live service.
- Recording tests: 43 cases, including core consumer-return cancellation, response budget,
  delayed sink finalization, corruption/limits and post-publication failure. Independent retest
  of the two original blockers and related fault cases passed 7/7 after correction.
- Runtime DeepSeek tests: 9 cases, including real files/SQLite, replay equivalence, changed
  request/file rejection, protected recording paths and idle/close after cancellation.
- `npm run eval:core`: **8/8**; `npm run eval:files`: **8/8**; `npm run eval:deepseek`: **6/6**.
  Existing evaluators and task criteria were not relaxed.
- `npm run demo:deepseek-replay`: passed; two real file tools and three model exchanges produced
  identical assistant content, tool results and effect outcomes on replay. Temporary data removed.
- `npm run build`: passed.
- Markdown link check: **12 documents / 77 local targets** passed; `git diff --check` passed.
- `git diff --quiet 15ac933 -- src/contracts/persisted src/store/schema.ts tests/boundaries.ts
  evals/tasks evals/harness .github`: exit 0. No changes to those frozen/acceptance paths.

The PR description records its exact head and remote CI result. These are offline checks, not
live service acceptance, model quality measurements or proof of physical power-loss durability.

## Remaining work and decisions

No new D-class decision is needed. The batch 6 PR remains open for review; batch 7 has not started.
The interactive CLI, hot reload, write/shell tools, second provider and model training are absent.

Owner-run live smoke is still unverified: service acceptance of this exact subset, live full
reasoning/tool continuation, actual model quality, latency and charges. The API uses a rolling
alias; recorded reported-model strings do not identify an unknown underlying server revision.
No paid call, real credential lookup, private eval or personal transcript was used in this batch.

The profile rejects unsupported content and cancelled/truncated/unproven history rather than
inventing full reasoning. No automatic context rebuild exists. Recordings are common-event
artifacts, not raw HTTP captures, encrypted archives or authenticated evidence. They can contain
private prompts/reasoning. A sequential wrapper and unchanged workspace/policy/cancellation are
needed for equivalent replay; replay does not authorize replaying unknown journal effects.

Final cleanup must leave the branch committed/pushed and worktree clean, with no delegated writer
or temporary workspace still active. Ignored eval outputs are synthetic reproducible evidence.
