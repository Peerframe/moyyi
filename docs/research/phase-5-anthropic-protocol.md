# Phase 5 Anthropic Messages protocol evidence

Reviewed 2026-10-25. This implements the already planned second provider, without paid calls or
credentials. No external source is copied. SSE framing and its tests reuse the existing moyyi
DeepSeek implementation locally, preserving plugin import isolation. No new package is added.

## Model and API version

The [Sonnet 5.5 model page](https://platform.claude.com/docs/en/models/sonnet-5-5/overview)
lists `claude-sonnet-5-5`, released September 28, 2026, a 1M context and 128K provider output
maximum. Adaptive thinking is supported; the adapter imposes its own smaller 8,192 output bound.
The [ID policy](https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions)
states dateless IDs since the 4.6 generation are pinned snapshots rather than rolling aliases.
The response must report the selected ID before the adapter binds replay provenance.

[API versions](https://platform.claude.com/docs/en/api/versioning) and the
[migration guide](https://platform.claude.com/docs/en/api/migration-2026-10-21) still describe
`2023-06-01` alongside the new `2026-10-21` version. The latter is only four days old at review.
Use `anthropic-version: 2023-06-01` without beta headers; this profile does not use the removed
sampling parameters, assistant documents or user citations. A future version change requires
separate acceptance and replay-profile identity. No remote request has verified either version.

## Thinking replay and client compaction

[Preserved thinking](https://platform.claude.com/docs/en/build-with-claude/preserved-thinking)
documents model, prefix and account bindings. The checked prefix includes system, tools and
preceding messages. Client keep-tail compaction may strip `thinking` and `redacted_thinking`
from retained assistant turns instead of using the beta mismatch-control header. Do not compact
within an unpaired tool round, reconstruct signatures from summary text, or restore thinking
that has already been dropped.

The adapter adds prefix/account identity and an invalidation ledger inside its opaque replay
payload. It validates the normalized body and raw blocks before replay. Fallback is decided
before sending, uses common text and complete tool pairs, and does not silently retry HTTP.
Fresh thinking produced against the compacted prefix can subsequently replay. A foreign or
unavailable reasoning-only message has no legal text fallback and is refused explicitly.

An invalidation ledger alone is insufficient: refusals, output-limit completions and interrupted
streams do not produce a complete replay envelope, and the model error contract has no envelope
field. The adapter therefore inspects the entire durable rendered history before emitting any
old reasoning. An assistant turn without complete, content/account-validated replay is a barrier
that invalidates preceding signatures. Consecutive user messages are also conservative barriers:
the existing context renderer represents an empty interrupted assistant attempt as a user notice.
No notice strings are parsed or trusted. Ordinary steering/notices may consequently lose reusable
thinking, but keep their text and complete tool pairs. A new valid response after the barrier can
carry fresh thinking normally. JSON history reload and a newly constructed client preserve this
behavior; no process-local invalidation map or persisted-format change is involved. A caller
must provide the actual durable conversation history, not remove failed attempts to manufacture
an older request: content hashes cannot establish a deleted edit or attempt history.

## Streaming and normalization

[Streaming Messages](https://platform.claude.com/docs/en/build-with-claude/streaming) defines
message start, indexed block start/delta/stop, message delta and message stop, plus ping/error
events. Tool input arrives as JSON fragments; thinking signatures arrive separately. Usage in
message delta is cumulative. The parser rejects malformed UTF-8, ambiguous JSON, mismatched
event names, incomplete framing, index/order violations and unsupported content variants.
Text and thinking deltas remain incremental; tool actions stay the core's responsibility.

[Streaming refusals](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/handle-streaming-refusals)
documents `stop_reason: refusal` and structured stop details. They remain a refusal completion,
not an automatic transport retry. The adapter does not implement the documentation's optional
fallback-to-another-model flow: retry/model selection belongs to the core and owner.

## Alternatives and acceptance boundary

- A vendor SDK offers broader API coverage but adds a dependency and its default retry behavior.
  Existing transport/model ports support this bounded Messages subset without it.
- An OpenAI-compatible Anthropic gateway obscures thinking signatures and account/prefix
  semantics. Direct Messages mapping preserves them in the existing D2 envelope.
- Beta server compaction/drop-block controls add an unnecessary protocol dependency; the
  documented client fallback fits moyyi's existing immutable compaction records.

Offline fixtures cover text/reasoning/tool loops, malformed JSON and framing, partial usage,
refusal, cancellation, replay invalidation and subsequent fresh thinking. Regression fixtures
restore the original prefix after refusal, output-limit and partial/empty interruption, reload
the history as JSON, and create a fresh client; old signatures remain absent while complete
tool pairs and new thinking remain usable. Runtime tests/evals
cover the actual adapter with SQLite, tools, compaction and recording/replay. These establish
protocol/conformance behavior, not service availability, billing, task quality or live acceptance.
