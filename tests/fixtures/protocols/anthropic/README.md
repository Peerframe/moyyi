# Anthropic Messages protocol fixtures

These examples were handwritten from official documentation retrieved on **2026-10-25**.
They illustrate `POST /v1/messages` with `anthropic-version: 2026-10-21`; this is a research
snapshot, not a runtime API-version or model selection. No SDK, production request, paid call,
credential, private transcript, or upstream implementation was used.

The [version history](https://platform.claude.com/docs/en/api/versioning) still lists
`2023-06-01`. The current `2026-10-21` version rejects sampling parameters `temperature`,
`top_p`, and `top_k`, assistant messages containing direct `document` blocks, and non-empty
`citations` on user text. The fixtures avoid those combinations. A future adapter must pin its
own tested version and features; this directory does not decide D2 or D5.

## Scope and sample inventory

`examples.json` contains request bodies, response bodies, and decoded SSE event pairs. The
`event` field is the SSE event name; `data` is the decoded JSON payload, not a JSON string.
HTTP headers, connection framing, and transport status are outside this envelope.

All `msg_synthetic_*`, `toolu_synthetic_*`, `srvtoolu_synthetic_*`, and
`synthetic-claude-model` values are symbolic. Signatures and encrypted data beginning with
`SYNTHETIC_` are deliberately nonfunctional placeholders. They demonstrate preservation and
pairing, not cryptographic validity or acceptance by a live server. The one-pixel PNG was
created locally for this fixture; it is not copied from documentation. Token counts are
illustrative, not measured tokenizer output. Optional response metadata is omitted.

| Kind | ID | What it demonstrates |
|---|---|---|
| request | `text-image-input` | Text system instruction, base64 PNG, user text |
| request | `signed-tool-result-replay` | Full signed assistant block sequence, matching tool result containing text and image |
| request | `redacted-tool-result-replay` | Opaque redacted block, matching failed tool result |
| request | `document-citation-input` | Document input outside the canonical union |
| response | `text-end-turn` | Text and separate uncached/cache-read/cache-write usage |
| response | `signed-thinking-tool-use` | Signed reasoning, text, client tool call with an object input |
| response | `redacted-thinking-end-turn` | Opaque reasoning followed by text |
| response | `max-tokens` | Output truncation |
| response | `refusal` | Refusal plus structured `stop_details` |
| response | `stop-sequence` | The matched stop string, currently not represented canonically |
| response | `pause-server-tool` | Pending server tool, not a client action awaiting local execution |
| response | `context-window-exceeded` | Context truncation, distinct from the requested output limit |
| response | `cited-text` | Citation offsets referring to `document-citation-input` |
| stream | `signed-tool-success` | Thinking/signature, text, split JSON tool input, final usage and `message_stop` |
| stream | `error-after-part` | A finished text block followed by a terminal provider error; no completion |
| stream | `interrupted-tool-json` | Transport EOF while JSON is unfinished; no invented final block or completion |

The final two streams intentionally have no `message_stop`. The overload is a documented SSE
error shape; the EOF example is an interrupted transport prefix, not a valid completed
response. Neither authorizes tool execution. The signed tool success stream reconstructs the
content of `signed-thinking-tool-use`, with a different synthetic message ID. The signed
request replays those content blocks unchanged; the redacted request illustrates the separate
redacted-tool form. No fixture claims that arbitrary synthetic reasoning can be signed.

## ContentPart: both directions

“Wire to canonical” includes importing request history where the wire block is input-only.
“Canonical to wire” means request/history serialization, subject to message-role constraints.
The existing contract is in [content.ts](../../../../src/contracts/persisted/content.ts).
The wire's top-level `system` accepts text only; the canonical `ModelRequest.system` type is
broader, so non-text system parts need validation rather than automatic serialization.

| Canonical variant | Wire to canonical | Canonical to wire and limits |
|---|---|---|
| `TextPart {text}` | `text.text`; a string message expands to one text block | `{type:"text",text}`. `citations` and `cache_control` have no canonical slots. |
| `ImagePart {mediaType,blob}` | Decode `image.source.{type:"base64",media_type,data}` into a blob; retain media type | Load the blob and encode base64. URL/file sources need authorized resolution or separate locator preservation; the canonical part cannot reproduce their original identity. No standalone generated-image output is claimed. |
| `ReasoningPart {origin,summary?,opaque?}` | `thinking.thinking` can supply `summary`; store the entire `thinking` block, including `signature`, in `opaque`. `redacted_thinking.data` supplies opaque data only | Replay the full opaque block for the matching origin, without reconstructing it from summary. Summary-only reasoning cannot synthesize a signature. Redacted data has no readable summary. |
| `ToolCallPart {callId,providerCallId,name,rawArguments}` | Allocate local `callId`; retain `tool_use.id` as `providerCallId`, plus `name`. Streaming JSON fragments preserve raw input; object-only responses need a serialization with explicit lexical-loss caveat | Resolve local identity, use `providerCallId` as wire `id`, and parse `rawArguments` into an object `input`. Invalid JSON, scalar JSON, duplicate-key semantics, and original spacing cannot all round-trip through an object. |
| `ToolResultPart {callId,status,content}` | Resolve `tool_result.tool_use_id` through the call map. String/nested text/image becomes canonical content; omitted content becomes empty. `is_error` distinguishes only success/failure | Emit a user `tool_result`, with `tool_use_id` from the call map. `succeeded` can use `is_error:false`; `failed` can use `true`. `denied`, `cancelled`, and `unknown` need an explicitly agreed status-message policy; the wire boolean alone cannot recover them. |

Sources: [Messages request schema](https://platform.claude.com/docs/en/api/messages/create),
[vision source forms](https://platform.claude.com/docs/en/build-with-claude/vision),
[thinking and redaction](https://platform.claude.com/docs/en/build-with-claude/thinking),
[tool result structure](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls).

Client tool results belong first in the immediately following user message. Every outstanding
client call needs its paired result. Do not treat provider-executed `server_tool_use` as a
canonical action for the local executor. Signed thinking also has model/account/conversation
binding rules: matching `ModelOrigin` is a necessary local restriction, not proof that edited
history remains acceptable to the provider. These are adapter/context requirements, not
permission to execute a tool. See [server tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/server-tools)
and [thinking preservation](https://platform.claude.com/docs/en/build-with-claude/thinking#preserved-thinking).

## ModelStreamEvent: both directions

Canonical events are defined in [model.ts](../../../../src/contracts/model.ts). Reverse mapping
here describes reconstructing a wire event recording; these events are not request parameters.
Exact timing, original message IDs, and every wire-only event cannot be reconstructed.

| Canonical event | Wire to canonical | Canonical to reconstructed wire |
|---|---|---|
| `text_delta {index,text}` | `content_block_delta` with `delta.type:"text_delta"` and `delta.text` | Same indexed delta, after a synthesized/retained text block start |
| `reasoning_delta {index,text}` | `delta.type:"thinking_delta"`, `delta.thinking` | Thinking delta; final signature must come from opaque provider data, not this event |
| `tool_call_delta {index,argumentsDelta}` | `delta.type:"input_json_delta"`, `delta.partial_json` | JSON delta; start needs `id`/`name`, only available in canonical `part_completed`, so reverse construction must buffer or retain extra metadata |
| `part_completed {index,part}` | At `content_block_stop`, finalize accumulated content and signature | A block start/deltas/stop sequence for supported parts. It cannot recreate citation deltas or signature arrival timing. Input-only image/tool-result parts are not automatically valid response blocks. |
| `completed {stopReason,usage}` | Wait for `message_stop`; use final stop metadata and cumulative usage | `message_delta` then `message_stop`, plus separately required message-start context; unmapped stop reasons remain gaps |
| `error {error}` | Provider SSE/HTTP error, connection failure, premature EOF, or abort becomes one terminal error | Only provider-shaped errors have an SSE counterpart. Local network/EOF/cancellation has no corresponding successful Messages completion. |

Buffer `message_start`, `content_block_start`, and `signature_delta` metadata. Ignore `ping`
for canonical content. Do not add successive cumulative `message_delta.usage` totals together.
Unknown block/event types require explicit handling instead of silently becoming text.
See [stream event ordering and types](https://platform.claude.com/docs/en/build-with-claude/streaming).

For `error-after-part`, `ModelError.kind` can be `overloaded` and `partialOutput` is true. For
`interrupted-tool-json`, use `stream_interrupted`; `partialOutput` is false under the current
contract because no part completed, despite emitted argument deltas. This distinction needs
care in retry policy. A user abort maps to `cancelled`; neither EOF nor abort emits `completed`.
The core, not the provider, records the assistant message as `interrupted`.
See [provider errors](https://platform.claude.com/docs/en/api/errors).

## StopReason: both directions

These are response metadata. Request messages have no `stop_reason` field to replay.

| Canonical StopReason | Incoming wire | Reverse response metadata |
|---|---|---|
| `end_turn` | `stop_reason:"end_turn"` | Same value |
| `tool_use` | `stop_reason:"tool_use"`; distinguish client and server blocks | Same value only with the corresponding call context |
| `max_tokens` | `stop_reason:"max_tokens"` | Same value |
| `refusal` | `stop_reason:"refusal"` | Same value; category/explanation in `stop_details` cannot be recovered |
| `interrupted` | Local interruption/error state, not a Messages stop value | No wire stop value; do not invent one or convert it to `end_turn` |

Refusal-looking prose alone does not establish a provider `refusal` stop reason.

`stop_sequence` plus its matched string, `pause_turn`, and
`model_context_window_exceeded` have no lossless canonical stop. Collapsing them to `end_turn`,
`tool_use`, or `max_tokens` changes the continuation or truncation meaning. Keep them unsupported
or preserve their provider metadata pending D2. The beta `compaction` stop and signed
compaction block are additional gaps, separate from a core-authored compaction record.
See [stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons)
and [beta on-demand compaction](https://platform.claude.com/docs/en/build-with-claude/compaction-on-demand).

## Usage: both directions

The current `Usage` does not specify whether `inputTokens` includes caches. This is a semantic
gap, not evidence that either convention is already implemented. Let `i`, `r`, and `w` denote
wire `input_tokens`, `cache_read_input_tokens`, and `cache_creation_input_tokens`.

| Canonical field | Incoming wire | Reverse response metadata |
|---|---|---|
| `inputTokens` | Raw-field convention: `i`; proposed total-input convention: `i+r+w` | Raw: unchanged; total: subtract known `cacheReadTokens` and `cacheWriteTokens` |
| `outputTokens` | `usage.output_tokens` | `output_tokens` |
| `cacheReadTokens?` | `usage.cache_read_input_tokens` when reported | `cache_read_input_tokens`; absent does not prove zero |
| `cacheWriteTokens?` | `usage.cache_creation_input_tokens` when reported | `cache_creation_input_tokens`; absent does not prove zero |

Recommendation for D2: define total-input semantics across providers and retain raw usage for
lossless replay. In `text-end-turn`, raw input is 11, cache reads 40, writes 20: total input is
71, not 11. Without known cache counts, reverse subtraction cannot safely infer uncached input.
Cache TTL breakdown (`cache_creation.ephemeral_5m_input_tokens` and
`ephemeral_1h_input_tokens`) is not expressible. See
[prompt-cache accounting](https://platform.claude.com/docs/en/build-with-claude/prompt-caching#tracking-cache-performance).

`output_tokens_details.thinking_tokens`, server-tool counters, service tier, geography, and
iteration-level usage also lack canonical fields. Thinking usage is not the token count of
its displayed summary. Beta compaction accounting can live in `usage.iterations` while the
ordinary top-level totals are zero; summing only those totals undercounts that operation.
See [thinking token accounting](https://platform.claude.com/docs/en/build-with-claude/extended-thinking)
and [compaction accounting](https://platform.claude.com/docs/en/build-with-claude/compaction-on-demand#count-compaction-usage).

## Remaining wire-only gaps and validation limits

- `text.citations` and `citations_delta` carry locations and source identity; flattening to text
  loses them. `document`, `search_result`, and document/search content in tool results are
  outside the five canonical variants. [Citations](https://platform.claude.com/docs/en/build-with-claude/citations)
- Provider/server tool families, toolset/caller metadata, container state, and provider result
  blocks must not enter the local action pipeline as ordinary `ToolCallPart` values.
  [Server tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/server-tools)
- Fine-grained tool streaming can finish with unparseable JSON. Preserve fragments, validate
  before execution, and do not replace them with `{}`. Outgoing `tool_use.input` still requires
  a representable object; the persisted raw string alone cannot guarantee replay.
  [Fine-grained streaming](https://platform.claude.com/docs/en/agents-and-tools/tool-use/fine-grained-tool-streaming)
- Thinking configuration, explicit cache markers, per-message system/tool changes, and beta
  fallback/binding transformation metadata are not covered by `ModelRequest` or the six event
  variants. They need separately scoped adapter decisions, not new guessed content variants.
  [Messages schema](https://platform.claude.com/docs/en/api/messages/create),
  [streaming extensions](https://platform.claude.com/docs/en/build-with-claude/streaming)
- No audio variant exists in the current canonical union. These inspected Messages sources
  establish text/image/document handling, not a direct native audio round-trip. Do not infer
  audio support from an arbitrary MIME string in `ImagePart`.
- `ModelError` has no provider error code, HTTP status, or request-ID field. Normalizing
  authentication, permission, billing, and other provider failures cannot be inverted exactly;
  keep diagnostic metadata separately. [Error schema](https://platform.claude.com/docs/en/api/errors)

Offline validation can check JSON parsing, field structure, block ordering, ID pairing, exact
opaque-block replay, and terminal-event distinctions. It cannot validate a real signature,
model capability, tokenizer count, live API acceptance, or unseen future event variants. No
production mapper or persisted format has been changed.
