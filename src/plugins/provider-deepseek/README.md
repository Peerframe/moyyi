# DeepSeek provider

Registers `deepseek/deepseek-flash` through `createDeepSeekPlugin(transport, options?)`; the trusted runtime
supplies the HTTP transport. Plugin config must be absent. No credentials, filesystem access,
retries, tool execution or environment lookup live in this plugin.

Supported profile: `deepseek-responses-text-v2-2026-10-26`. Requests use the official Responses
endpoint, full stateless text/reasoning history and client function tools. Completed assistant
history with tools/calls must retain all actual visible reasoning and a known successful stop reason;
a complete response need not generate reasoning. Unsupported
content/options fail before HTTP. Opaque replay data is unused; valid common content is sufficient.
The local output cap is 8,192 tokens. Model alias resolution remains controlled by the service.

Historical `ModelMessage.origin` identifies the producing provider. For a different provider,
only complete text/refusal and paired calls/results go to the wire; reasoning and replay are
omitted. Foreign calls receive deterministic collision-free wire IDs because Chat history can
reuse IDs across turns. Original records and local pairing IDs stay unchanged. Same-provider
history preserves its visible reasoning and wire IDs across credential switches. Missing origin
retains legacy behavior; interruption, completeness and pairing checks still apply. See
[ADR 0048](../../../docs/decisions/0048-connection-continuation.md).

`options.reasoningEffort` accepts `none`, `low`, `high` or `max`, using the official Responses
`reasoning.effort` control. Omission keeps `high`; aliases and invalid values are rejected before
transport. Plugin/client construction captures the value, so later caller mutation cannot change
requests. No prompt, tool definition, output limit or model selection changes with this setting.
`none` disables thinking; it does not strip earlier visible reasoning from valid history.
See the [official effort mapping](https://api-docs.deepseek.com/guides/thinking_mode/).

`deepSeekApiProfile(effort)` binds recording/replay to the selected effort. High uses the current
constant; other efforts have distinct suffixes. Runtime exposes the helper through `moyyi/runtime`
and uses the host's `deepseekReasoningEffort` setting for both live connections and offline replay.
See [ADR 0023](../../../docs/decisions/0023-configurable-deepseek-reasoning.md).

Tool results use native `input_text` parts: an explicit result-status part followed by each
original text part, preserving actual newlines, Unicode and part boundaries. No nested JSON
envelope is added and no tool JSON is parsed. The v2 recording profile identifies this wire
change; v1 records must not be relabeled as v2. See
[ADR 0026](../../../docs/decisions/0026-readable-evidence-and-action-budget.md).

The optional common `toolChoice: "none"` control sends `tool_choice: "none"` while preserving
tool definitions and complete tool-call/result history. Absence retains the previous wire shape;
other values fail before HTTP. Core enforces the final-attempt execution boundary independently
of the provider response. See the official [Responses controls](https://api-docs.deepseek.com/api/create-response/).

Reasoning output can carry an auxiliary `encrypted_content` string alongside visible text. It is
validated (at most 64 KiB UTF-8), then discarded: it is neither decrypted nor recorded/replayed or
sent in a subsequent request. It may change or disappear across lifecycle events. An item that
ever carries nonempty auxiliary metadata must complete with nonblank visible reasoning; opaque-only
output still fails. Existing identity, status and streamed/final content checks remain in force.

Assistant message output may have no `phase`, null, `"commentary"` or `"final_answer"`. The added
annotation is provisional; done and terminal cannot provide contradictory explicit phases.
Missing/null annotations may appear or disappear. Annotation values are validated and discarded;
all text and its order remain in common content and subsequent plaintext input. Unknown values and
invalid types fail. The annotation never completes a response or selects its stop reason: only the
response terminal can authorize completion or a tool turn. DeepSeek's phase-sensitive continuation
behavior is not yet verified; this is not general phase replay for other providers.

Framing accepts chunked UTF-8 and SSE comments/line endings, rejects duplicate JSON keys and
unfinished events, and caps the wire at 8 MiB and each event at 1 MiB. Semantic assembly checks
sequence order, identities, lifecycle, completed content consistency and usage. EOF without a
terminal is `stream_interrupted`; partial output is retained and never retried here. Failed responses
and HTTP errors expose fixed diagnostics, not raw server error bodies. Every HTTP 5xx response
is classified as `overloaded`, including gateway failures such as 502 and 504. Unknown usage
remains null.

`fixtures.ts` builds handwritten synthetic lifecycles, not recordings from DeepSeek. The provider's
wire and common-event tests use these fixtures. Owner-authorized minimal probes identified the
auxiliary-field, final-answer-phase and commentary rejections. An earlier complete response decodes
offline to `OK`, `end_turn` and final usage. The historical read-task prefix advances beyond commentary
and correctly reports interruption at EOF; no terminal or tool result is fabricated.
Synthetic complete tool flows exercise real files, SQLite and recording/replay. The subsequent #19
installation passed one bounded live file-read/tool-continuation task and offline replay, recorded
in [the provider guide](../../../docs/deepseek.md); broader task quality has separate acceptance.
See the retained
[follow-up evidence](../../../docs/tasks/2026-10-25-deepseek-compatibility.md).
For runtime configuration, record/replay and owner smoke instructions see
[docs/deepseek.md](../../../docs/deepseek.md). Design evidence is in
[ADR 0010](../../../docs/decisions/0010-deepseek-transport-and-recording.md).

## Model experience

The adapter adds no prompt prose. It sends the context builder's system sections, ordered tools,
full visible text/reasoning history and paired function calls/results to the Responses endpoint.
It preserves same-provider complete assistant turns' actual visible reasoning, including turns
without tools. Foreign turns contribute text and paired tools only, without provider reasoning
or replay. Each tool result begins with `Tool result status: <status>` and retains its original text
parts. Unsupported history fails before transport. Partial or failed output cannot authorize a
tool call or become a completed answer.

Input-token cost follows the complete rendered request, including retained reasoning and schemas.
The 8192 output-token cap includes reasoning. Reported `input_tokens_details.cached_tokens` is
recorded as a subset of total input; unknown cache writes remain `null`. Usage is attached to
each attempt, so replay and inspection do not need a second provider call.

An unchanged assembled prefix can be reused by the provider. Stable tool order and
`static → session → turn` sections help preserve it; changing a prior section, schema or history
changes the prefix from that point. Tool calls and results normally append to history. The
adapter adds no changing timestamps or telemetry to model input. Model/provider changes select a
different cache domain. Cache hit counters are evidence of actual reuse; stable formatting alone
does not guarantee a hit.

HTTP failures return `DeepSeek HTTP <status>` with the existing normalized error kind; HTTP 402
returns `DeepSeek account balance is unavailable` with kind `quota`. Neither response bodies nor credentials are
included. The provider performs one request per invocation and never retries. The fixed-source
[DSH comparison](../../../docs/deepseek.md#deepseek-harness-comparison) records the Messages
differences, source pointers and the 5xx classification correction.
