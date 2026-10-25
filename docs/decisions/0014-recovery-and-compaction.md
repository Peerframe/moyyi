# ADR 0014: recoverable, explicit context compaction

Status: accepted for the authorized phase 4 implementation, 2026-10-25.

## Context and evidence

D1 already selects immutable transcript trees and transactional SQLite. D2 requires compacted
content to discard provider replay; summaries cannot grant permissions or settle unknown actions.
Persisted v1 already has `CompactionBody`, including its source span, text and model/prompt
provenance. Reuse these contracts rather than introduce another memory database or rewrite history.

The existing store permits sibling entries and an explicitly selected head. This permits an
auditable summary request without injecting that request's answer twice into subsequent context.
Existing effect and run journals provide recovery boundaries; phase 4 extends real process-kill
coverage instead of adding a second recovery engine.

The [DeepSeek context caching documentation](https://api-docs.deepseek.com/guides/kv_cache/),
checked 2026-10-25, describes automatic prefix reuse and best-effort cache hits. Stable ordering
can preserve reuse opportunities, but only reported usage can establish actual cache hits.
No provider-specific cache protocol, dependency, copied code or new persisted version is added.

## Decision

Expose `session.compact` and CLI `/compact` between runs. It makes one request to the selected
model with no tools and no automatic retry. It is a tracked run with the usual cancellation,
deadline and response limits. Summary generation is a model call and may cost money when the
owner connects a paid host; implementation and acceptance use only scripted offline responses.

The pure context planner retains the latest two user turns, preserves complete tool-call/result
groups, and selects a settled older prefix. An ineligible or oversized source is refused before
calling the model. Summary instructions ask for goals, constraints, decisions, evidence, pending
work and uncertainty, treating source text as data. Only a complete response with nonempty summary text is
accepted; optional reasoning is retained only in the audit branch. Tool calls, refusal, truncated completion or an interrupted stream never become a
compaction fact. A successful projection must fit the budget and reduce the rendered context.

Record the exact summary request and response/usage as an ordinary `assistant_message` on an
audit sibling branch, with renderer `moyyi-compaction-v1`. Atomically append the compaction entry
and select its head. The CLI labels the audit entry; it does not present it as an ordinary answer.
Rejected summaries retain request evidence but do not replace the selected history. Cancellation
before publication prevents it; a cancellation/deadline racing an already started transaction
cannot roll back its successful commit, which is reported as completed. Original entries and
blobs remain intact. A crash before or after the transaction exposes the old or new head, never
half of a committed replacement.

Context rendering substitutes each recorded summary at its source span's chronological position.
Replaced messages and their replay envelopes are absent from the request; untouched retained
messages keep their valid provenance. Unknown effects are supplied independently and remain
unknown regardless of summary claims. Compaction does not execute tools or carry approvals.
Stable context section/tool ordering and unchanged message blobs preserve deterministic prefixes;
compaction intentionally changes the old prefix and may lose provider cache reuse once.

## Alternatives and limits

- Silent deletion/truncation is cheap but loses facts without an auditable replacement. Rejected.
- Requiring the owner to write the summary transfers the feature's work to the owner. Rejected.
- Automatic, recursive or multi-request compaction adds hidden calls and more failure states.
  Defer it until the explicit bounded path has real-model evidence. Call `/compact` before the
  source itself exceeds the window; this implementation does not promise arbitrary-size repair.
- A separate memory store or new persisted kind is unnecessary for this phase.

Summaries are inherently lossy and model-authored. Offline checks establish lifecycle, authority,
budget, replay and context behavior; they do not establish semantic recall, live DeepSeek
acceptance, cache savings or performance. Recent turns remain verbatim; originals are available
for audit. Private corpus evaluation, paid calls, phase 5 and model training remain outside scope.
