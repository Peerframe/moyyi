# Anthropic Messages provider

`createAnthropicPlugin(transport, { accountScope })` registers `anthropic/claude-sonnet-5-5`.
The transport and non-secret account identity come from the trusted runtime. No key lookup,
HTTP implementation, SDK retry, fallback model or tool execution lives in this plugin.

The pinned profile uses Messages API `2023-06-01`, adaptive thinking, a 1M context window and a
host output ceiling of 8,192 tokens. It supports text, thinking summaries, opaque redacted
thinking, function calls/results, refusal status/details and cumulative usage. Images, hosted
tools, server-side fallback, inline system/tool changes and provider compaction are not enabled.
Unknown capability-bearing SSE events fail explicitly rather than being treated as success.

The optional common `toolChoice: "none"` control sends `tool_choice: { type: "none" }`, retaining
the tool definitions and history needed for signed replay. Absence retains the previous wire
shape; unsupported values fail before HTTP. Budget text appended to the current user result does
not change earlier prefixes; this adapter does not recognize notice text as authority. Core
separately prevents final-attempt tool execution. The control is supported with adaptive thinking:
[official tool-choice documentation](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools).

Thinking signatures and encrypted blocks live only in bounded D2 replay envelopes. Content,
model/API identity, exact rendered prefix and account scope must match. A changed prefix or
account strips old thinking before the single HTTP attempt, using the documented keep-tail
fallback while preserving text and complete tool pairs. A reasoning-only turn without valid
replay is refused. A bounded invalidation ledger in later provider envelopes prevents restoring
discarded thinking when earlier bytes are restored. Before rendering, the adapter also scans the
whole history for missing proof: refusal, truncation, interruption or another assistant turn
without complete validated replay invalidates earlier signatures. Consecutive user messages
conservatively do the same, covering the existing empty-interruption notice representation
without interpreting its words. This may discard reusable thinking after ordinary steering or
notices; text and complete tool pairs still continue, and fresh thinking after the barrier can
replay. The rule survives history reload and new clients without process-local state. The ledger
and barriers can only remove replay, never grant authority; persisted v1 remains unchanged.

The provider preserves verbatim streamed tool argument deltas; object-only inputs are marked
`json_serialized`. It never invents signatures from normalized reasoning. A classifier refusal
retains streamed text and adds a normalized refusal fact from `stop_details.explanation` (or an
explicit provider-refusal marker). No refusal is retried or switched to another model.

Input usage is the sum of uncached input, cache-read and cache-write counters when all are
reported; missing counters remain null. Output usage is cumulative, not a sum of delta values.
Errors retain partial usage and content. Stream bounds are 8 MiB overall, 1 MiB per frame/block,
100,000 events and 1,024 blocks; requests are at most 4 MiB. Oversize replay is rejected, not cut.

Fixtures are handwritten synthetic SSE, not captured service traffic. `anthropicFixture` and
`anthropicFixtureTransport` support offline integration/evals. Tests exercise framing,
malformed streams, tool rounds, prefix/account changes, cancellation and usage; live service
acceptance and model quality remain unverified. See
[protocol evidence](../../../docs/research/phase-5-anthropic-protocol.md).
