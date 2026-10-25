# DeepSeek provider

Registers `deepseek/deepseek-flash` through `createDeepSeekPlugin(transport)`; the trusted runtime
supplies the HTTP transport. Plugin config must be absent. No credentials, filesystem access,
retries, tool execution or environment lookup live in this plugin.

Supported profile: `deepseek-responses-text-v1-2026-10-25`. Requests use the official Responses
endpoint, full stateless text/reasoning history and client function tools. Completed assistant
history with tools/calls must retain all actual visible reasoning and a known successful stop reason;
a complete response need not generate reasoning. Unsupported
content/options fail before HTTP. Opaque replay data is unused; valid common content is sufficient.
The local output cap is 8,192 tokens. Model alias resolution remains controlled by the service.

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
and HTTP errors expose fixed diagnostics, not raw server error bodies. Unknown usage remains null.

`fixtures.ts` builds handwritten synthetic lifecycles, not recordings from DeepSeek. The provider's
wire and common-event tests use these fixtures. Owner-authorized minimal probes identified the
auxiliary-field, final-answer-phase and commentary rejections. An earlier complete response decodes
offline to `OK`, `end_turn` and final usage. The latest read-task prefix now advances beyond commentary
and correctly reports interruption at EOF; no terminal or tool result is fabricated.
Synthetic complete tool flows exercise real files, SQLite and recording/replay, not service quality;
real tool continuation remains unverified. See the
[follow-up evidence](../../../docs/tasks/2026-10-25-deepseek-compatibility.md).
For runtime configuration, record/replay and owner smoke instructions see
[docs/deepseek.md](../../../docs/deepseek.md). Design evidence is in
[ADR 0010](../../../docs/decisions/0010-deepseek-transport-and-recording.md).
