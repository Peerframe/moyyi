# ADR 0034: Incomplete responses cannot complete a run

Date: 2026-10-27. Status: implemented and installed; integration tracked on [PR #34](https://github.com/Peerframe/moyyi/pull/34).

## Whole-task diagnosis

The autonomous Flash/Pro control preserved the original source task and four-request allowance
per model. Both answers failed the original rubric. All returned evidence reached the next
request, and neither final answer was truncated. Pro introduced additional mistakes about code
already delivered. This does not support switching the default model or adding another retrieval
warning. Original failures remain failures; this decision does not claim to repair them.

Reviewing the entire response-to-client lifecycle exposed a separate reproducible defect.
Core rejected empty, truncated and unknown terminal responses only on the final request.
The same response earlier in the allowance could become `run.finished: completed`, persist a
completed run, and make the one-shot CLI exit zero. The four new early-terminal conformance
cases all reproduce that defect before the change; the existing 21 cases pass. The DeepSeek
incomplete-response replay test preserved the stop reason but did not assert the run outcome.

## Evidence and alternatives

The [DeepSeek Responses guide](https://api-docs.deepseek.com/guides/responses_api/) distinguishes
a truncated `response.incomplete` from ordinary completion. The adapter already preserves
`max_tokens` and usage; the missing check is in core, after provider decoding.
[Codex rust-v0.164.0](https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/codex-api/src/sse/responses.rs#L396-L427)
also surfaces a non-interrupted incomplete response as an incomplete-response error while
retaining its response identity and usage. No upstream implementation is copied.

[Claude Code stop hooks](https://code.claude.com/docs/en/hooks#stop) can request additional work,
but require bounded continuation and do not themselves prove factual correctness. A general
hook system, another model reviewer or automatic continuation would expand authority, lifecycle
and cost without fixing this already-known status error. Correct the shared outcome boundary
first. Semantic checks remain task-specific and separate from a valid response terminal.

## Decision

Keep existing public and persisted unions. Before the final allowed request:

- A token-capped response returns `budget_exhausted` with budget `model_output_tokens`.
- An empty/whitespace/reasoning-only answer returns `failed` with a fixed no-answer diagnosis.
- `other` or `interrupted` terminal reasons return `failed` with the common stop classification.
- Tool proposals without a completed tool-use turn remain unexecuted and paired with failed
  results; they cannot qualify the run as completed even if some answer text exists.

The existing final-request `model_requests` exhaustion behavior remains unchanged. A complete
nonempty answer or explicit refusal may complete the protocol; neither certifies task success.
Do not add requests, retries, model calls, tool execution, larger limits or new grants.

Preserve the assistant content, original stop reason, usage and request reference unchanged.
Existing failed/budget outcomes persist the run as interrupted and produce a nonzero CLI exit.
No persisted format revision or rewriting of historical completed runs is required. Accepted
steering is still recorded; an incomplete response stops without an automatic continuation.
Ordinary completed responses retain their existing steering behavior. Cancellation and time
limits retain priority, and completed effects are not undone.

## Acceptance

Verify early and final terminals independently, including partial text, reasoning-only output,
proposed writes, pending steering, refusal and normal completion. Assert no extra request,
retry, approval or tool execution; retain usage/content and inspect the persisted run status.
Exercise the actual DeepSeek decoder, recording and replay with a synthetic incomplete stream.
Extend the existing deterministic core eval and external installed CLI gate; the CLI must exit
nonzero from a real installed executable outside the source tree while retaining partial text.
Run the unchanged complete checks and dual-platform CI before integration and installation.

These deterministic checks establish lifecycle correctness. They neither rescore the original
task nor establish improved autonomous interpretation; another paid repeat of the same question
is not required to demonstrate this fix.

Source acceptance: `npm run check` passes 110 files / 2,393 tests; `npm run eval:core` passes
25/25 scenarios. The focused runtime/core and real-codec recording/replay suites pass 58/58.
Independent code/test review found no blocker. Product `d988461` passed the external package
gate and [Linux/macOS CI](https://github.com/Peerframe/moyyi/actions/runs/40408671809).
All 372 installed files match the accepted package. The actual installed CLI passes 12/12
scenarios, including both new early-terminal cases; opening an existing owner session for
help/exit succeeds without model calls. Backups and the old package remain available. Final
integration is recorded on the PR and in the [current delivery record](../tasks/2026-10-26-optimization-plan.md).


## Correct the final-request cause (2026-10-27)

A new, separately sealed Flash revision diagnostic returned HTTP200 with all8,192 generated
tokens classified as reasoning and no final text. A fresh Kimi compact audit subsequently
returned429 engine overload without a model answer. Neither result justifies automatic review,
more requests or a quality-PASS claim. The [research record](../research/2026-10-26-agent-navigation.md#answer-coverage-after-evidence-delivery-2026-10-27)
keeps the mechanisms and original failed scores separate.

Tracing the actual outcome boundary found a concrete residual classification error: a
`max_tokens` response on the last allowed attempt returned `model_requests`, while the same
response earlier correctly returned `model_output_tokens`. Two focused regressions reproduced
the wrong final cause before the fix, for partial text and reasoning-only output. Correct this
exception to the original decision above: the provider's explicit output-limit terminal takes
precedence over the coincident request ceiling, including forbidden tool proposals. Those calls
still receive denied results without preparation, approval or execution. Errors/cancellation,
empty/unknown terminals, recorded usage and interrupted run status retain their existing rules.

The CLI now explains capped output beside its saved answer, distinguishing partial text from
no answer. When both final usage counts are known, show output and its included reasoning count;
never present missing usage as zero, expose reasoning content, or certify a partial answer.
This explanation also applies when viewing saved history. No new request, retry, model setting,
permission, persistent format or review phase is introduced. This repairs diagnostics, not the
original source-question omissions.
