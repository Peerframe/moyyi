# Content model mapping: Messages, Responses and Chat Completions

Research date: **2026-10-25**. Reviewed contract baseline: `main` at `e7e270a`.
**D2 option B is now accepted in [ADR 0003](../decisions/0003-provider-neutral-content.md).**
The proposals and alternatives below preserve the research-stage rationale. The format amendment
and provider implementation remain pending; this research changes no persisted contract.

The current five `ContentPart` variants and six `ModelStreamEvent` variants do not provide a
lossless representation of all three wire formats. The common text/function-call path is
expressible, but replay metadata, refusal content, termination details and missing usage still
need the separately authorized contract amendment. A provider-neutral interface is feasible
without flattening these differences.

## Scope and notation

Reviewed contracts: [content](../../src/contracts/persisted/content.ts),
[transcript, stop reasons and usage](../../src/contracts/persisted/transcript.ts),
[model request/stream](../../src/contracts/model.ts), and
[stream conformance](../../src/contracts/model-conformance.ts).

Every current content variant, stream event, stop reason and usage field has **both directions**
below. `wire → M` means decoding/import into moyyi; `M → wire` means rendering a request or,
for stream/response-only fields, the conceptual inverse for replay diagnostics. APIs do not
accept response SSE events, stop reasons or usage as ordinary request fields. A conceptual
inverse is not permission to send those fields in a request.

- **Exact**: the listed value survives unchanged, within the stated subset.
- **Normalized**: logical meaning can survive, but wire framing, spelling or metadata cannot.
- **Gap Gn**: the current contract cannot preserve the distinction; do not silently discard it.
- Proposals in this document are not decisions. Unsupported variants should be rejected by a
  future adapter until an explicit capability/normalization policy exists.

Vendor APIs expose additional content and event families. They are listed as gaps, not claimed
as supported by the five-part model. Any unlisted semantic extension is unsupported by default.

## Primary evidence and version scope

All sources were consulted on 2026-10-25. These are rolling official documents unless a version
is stated. No SDK or runtime dependency was added or selected.

| Source | Evidence used |
| --- | --- |
| [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create) | Blocks, roles, usage and termination |
| [Anthropic streaming](https://platform.claude.com/docs/en/build-with-claude/streaming) | Block starts/deltas/stops, signatures and stream errors |
| [Anthropic extended thinking](https://platform.claude.com/docs/en/build-with-claude/thinking) | Signed and redacted reasoning replay |
| [Anthropic tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls) | Tool/result pairing and result content |
| [Anthropic caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) | Input/cache accounting |
| [Anthropic versioning](https://platform.claude.com/docs/en/api/versioning) | Current `2026-10-21` and historical `2023-06-01` behavior |
| [Responses create reference](https://developers.openai.com/api/reference/resources/responses/methods/create) | Items, content, usage, incomplete reasons |
| [Responses streaming reference](https://developers.openai.com/api/reference/resources/responses/streaming-events) | Item/content indices and terminal events |
| [OpenAI reasoning guide](https://developers.openai.com/api/docs/guides/reasoning) | Reasoning replay, encryption and assistant message phase |
| [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling) | Call IDs, argument fragments and tool output |
| [Chat reference](https://developers.openai.com/api/reference/resources/chat) | Messages, chunks, tool-role limits and finish reasons |
| [Completion usage](https://developers.openai.com/api/reference/resources/completions) | Prompt/completion totals and detailed token counters |
| [OpenAI caching](https://developers.openai.com/api/docs/guides/prompt-caching) | Cache subcounts and request cache controls |
| [vLLM reasoning](https://docs.vllm.ai/en/stable/features/reasoning_outputs/) | Current `reasoning` extension; old `reasoning_content` name |
| [vLLM tool calling](https://docs.vllm.ai/en/stable/features/tool_calling/) | Checkpoint/template/parser-specific tool output |
| [Qwen vLLM deployment](https://qwen.readthedocs.io/en/latest/deployment/vllm.html) | Qwen through the Chat Completions endpoint |

Anthropic fixtures illustrate the current `2026-10-21` API version, not a choice to deploy it.
The version page records changes from `2023-06-01`, including role/content restrictions. OpenAI
and vLLM fixtures are tied to this retrieval date; a future adapter must additionally pin its
model, server version, parser and supported features. The Qwen identifier in a fixture does not
select shasha's base model or authorize training.

## ContentPart: Anthropic Messages

Sources: Messages, extended thinking and tool-use references above. Preserve ordered blocks and
assistant/user message grouping. Canonical `ModelRequest.system` can render to the top-level
`system` field. Current Anthropic also supports mid-conversation `role:system` on specified
models; current moyyi `ModelMessage.role` cannot represent that placement (G10). Do not silently
move such instructions to the beginning or claim the vendor forbids them. See the
[mid-conversation system-message reference](https://platform.claude.com/docs/en/build-with-claude/mid-conversation-system-messages).

| M variant | wire → M | M → wire | Fidelity |
| --- | --- | --- | --- |
| `text` | `text.text` becomes `text`; citations and per-block controls have no slot | Emit a text block in an allowed role | Exact text; G1/G5 for annotations and cache controls |
| `image` | Import authorized base64 bytes into a blob, retaining media type; URL/file references need resolution or preservation | Resolve blob bytes and emit base64 image source; validate accepted media type and role | Normalized bytes; source locator and controls are G3 |
| `reasoning` | Preserve the complete `thinking` block including `thinking` and `signature`, or complete `redacted_thinking` block including `data`, in provider-bound `opaque` | Replay that exact block only to the same provider family and model, under a compatible API/account/prefix profile; never construct a signature from `summary` | Opaque block can survive; summary is not a signed substitute; G1/G4 |
| `tool_call` | `tool_use.id` → `providerCallId`; allocate local `callId`; `name` stays; concatenate streamed `input_json_delta.partial_json` into `rawArguments` | Parse complete `rawArguments` into the required input object, using the original provider ID/name | Exact streamed argument string inbound; non-stream input object loses lexical JSON, and invalid raw JSON is not renderable: G2 |
| `tool_result` | Import pairing via `tool_use_id`; text/image result blocks map recursively; `is_error` is only a binary hint | Look up provider ID from the earlier call; emit a user `tool_result` block, preserving required ordering; explicitly render all non-success statuses | Native status cannot distinguish failed/denied/cancelled/unknown: G2; document/other result blocks G3 |

`ToolResultPart.callId` alone is not the provider ID: rendering requires the preceding call's
lookup. Imported wire results must never be treated as authoritative moyyi effect-journal
outcomes. Opaque provider data likewise cannot grant permission to run tools.

## ContentPart: OpenAI Responses

Sources: Responses create, reasoning and function-calling references. Responses contains an
ordered list of items, not a single assistant message with interchangeable blocks.

| M variant | wire → M | M → wire | Fidelity |
| --- | --- | --- | --- |
| `text` | User `input_text.text` or assistant `output_text.text`; keep text, but the current shape loses annotations, message ID, status and `phase` | Render user `input_text`, or replay assistant message `output_text` in its proper item; phase requires retained metadata | Exact text; item/message envelope and citations G1/G5 |
| `image` | `input_image` source can be URL/data URI/file ID; import available authorized bytes as a blob | Render `input_image` with data URI or an explicitly retained reference; original `detail` is not represented | Normalized bytes; locator/detail G3; hosted image-generation output is a different item |
| `reasoning` | Retain the entire reasoning item, including `id`, `summary`, `encrypted_content` and any relevant status/content, in `opaque` with origin | Replay the complete provider-owned item; `summary` alone is not equivalent continuation state | Opaque item can survive; non-reasoning item envelope remains G1 |
| `tool_call` | `function_call.call_id` → `providerCallId`, not item `id`; preserve `name` and exact string `arguments`; allocate local `callId` | Emit a function-call input item with `call_id`, name and raw argument string; item ID/status need preserved metadata | Exact arguments; distinct item ID, tool kind and status G1/G2 |
| `tool_result` | Pair `function_call_output.call_id` through the earlier call; decode text or supported image output | Emit a `function_call_output` item, with string or supported structured output parts | Text/image subset normalized; file content G3; no native moyyi status union G2 |

The current reasoning guide says `store:false`/ZDR responses return encrypted continuation by
default; `include:["reasoning.encrypted_content"]` is retained as a legacy-compatible request
option. Preserve assistant message `phase` (`commentary` / `final_answer`) on replay; it is not
a reasoning-item field. These are current-source observations, not claims about every older
model or compatible server. See the [reasoning guide](https://developers.openai.com/api/docs/guides/reasoning).

## ContentPart: Chat Completions and Qwen/vLLM

Sources: Chat reference, OpenAI function-calling guide, vLLM reasoning/tool-calling and Qwen
deployment docs. OpenAI-compatible transport does not imply identical model capabilities.

| M variant | wire → M | M → wire | Fidelity |
| --- | --- | --- | --- |
| `text` | Message `content` string or text parts | Render text in a supported user/assistant role | Normalized segmentation; refusal field and annotations G5 |
| `image` | User `image_url` bytes/reference | User `image_url` data URI after authorized blob lookup | Model-dependent; `detail`/URL G3; ordinary assistant output is not an image-part channel |
| `reasoning` | vLLM `reasoning` text can be preserved in a typed provider-owned opaque envelope; `reasoning_delta` can display it | No portable OpenAI reasoning replay field; only a verified server/template-specific renderer may reuse it | G4; never turn reasoning into ordinary assistant text silently |
| `tool_call` | `tool_calls[].id`, `function.name`, exact `function.arguments`; allocate local ID | Assistant function tool-call record, preserving provider call ID and raw string | Exact strings; custom/free-form tool kinds are G2 |
| `tool_result` | Tool-role message `tool_call_id` pairs with the original call | Separate `role:tool` message with string/text content and provider ID | Status rendered explicitly; tool-role image content is unsupported by the reviewed OpenAI schema: G2/G3 |

As retrieved, vLLM names the output field `reasoning`; `reasoning_content` is historical.
Choose an explicit compatibility profile rather than silently trying arbitrary aliases. Parser
and tokenizer template selection determine which calls are exposed, and malformed arguments
still require validation. Qwen text-only and vision checkpoints must not share an assumed image
capability. No model/server was installed or invoked for this research.

## ModelStreamEvent: both directions

These tables cover every current event. Incoming indices need a request-local allocation map;
provider indices from different namespaces are not interchangeable. Outbound rows describe
conceptual reconstruction, **not an API request format**. Exact SSE framing and original chunk
boundaries cannot be recovered from normalized events (G8).

### Anthropic

| M event | wire → M | M → wire / missing information |
| --- | --- | --- |
| `text_delta` | `content_block_delta` / `text_delta.text`, mapped block index | Can reconstruct a text delta; start envelope/framing absent |
| `reasoning_delta` | `thinking_delta.thinking` | Visible delta only; signature/redaction require retained opaque block (G4) |
| `tool_call_delta` | `input_json_delta.partial_json` | Reconstruct argument delta; name/ID need buffered `content_block_start` |
| `part_completed` | Assemble at `content_block_stop`, including signature deltas and original block | Can emit an assembled block and stop; original start/delta partition is lost |
| `completed` | Only after `message_stop`, using final message reason and cumulative usage | Reason/usage alone cannot rebuild message IDs, stop sequence and full envelope (G1/G6) |
| `error` | Wire error, HTTP/network failure, cancellation or missing terminal | Wire error type or local transport failure; no exact inverse for local cancellation/error metadata |

Do not emit completion at `message_delta` then process more content. `ping` is transport-only;
unknown semantic delta types, including beta families, need explicit handling or a protocol error.

### Responses

| M event | wire → M | M → wire / missing information |
| --- | --- | --- |
| `text_delta` | `response.output_text.delta`; map item ID/output index/content index to a local part | Text can be reconstructed; original item indices/IDs require envelope (G1/G8) |
| `reasoning_delta` | `response.reasoning_summary_text.delta` (or a separately supported reasoning-text family) | Summary and reasoning text are not equivalent; current event lacks a subtype (G4) |
| `tool_call_delta` | `response.function_call_arguments.delta` | Arguments only; cannot reconstruct item ID, call ID or sequence number from this event alone |
| `part_completed` | Use the final complete content/item at its done event; finalize each local part once | Can reconstruct selected item payload from retained metadata; multiple done events must not duplicate parts |
| `completed` | `response.completed`, or a recognized `response.incomplete` after classifying its reason | Reconstruct selected terminal outcome only; raw status/reason and response identity may be absent (G6) |
| `error` | `error`, `response.failed`, local cancellation or truncated transport | Kind/message normalize multiple wire errors; code/param/request identity and partial usage have no full inverse |

Lifecycle/progress and hosted-tool events are not text deltas or locally authorized tool calls.
One canonical terminal follows the entire response. `response.output_item.done` alone never
authorizes execution. Partial/incomplete function calls must not execute merely because an item
finished; core acceptance must also consider the response's terminal outcome.

### Chat Completions / vLLM

| M event | wire → M | M → wire / missing information |
| --- | --- | --- |
| `text_delta` | `choices[0].delta.content` | Reconstruct selected choice delta; choice/response envelope is missing |
| `reasoning_delta` | Profile-specific vLLM `delta.reasoning` | Only the same verified extension profile; no portable OpenAI field |
| `tool_call_delta` | Per-call-index `delta.tool_calls[].function.arguments`, concatenated verbatim | Reconstruct arguments with buffered ID/name; canonical index is not the tool-call index |
| `part_completed` | Synthesize assembled text/reasoning/call at the selected choice's finish | There is no native part-completed event; original interleaving cannot be recovered |
| `completed` | After finish, requested usage-only tail and `[DONE]`; reject EOF before terminal | Inverse needs choice index and envelope; must not drop late usage or invent a missing count |
| `error` | HTTP error object, local failure/cancellation or premature EOF | Normalized error only; not an invented Chat finish reason |

Request `n=1` for the initial adapter scope. Supporting multiple choices needs an explicit
selection/representation policy; flattening choices together is incorrect. Empty `choices` in
the final usage chunk is valid. A refusal delta is not an ordinary text delta (G5).

## StopReason: every current value and wire-only gaps

`M → wire` here is a conceptual response reconstruction; request parameters must not contain
`stopReason`. A request stop-sequence option is a separate control, not an observed outcome.

| M reason | Anthropic wire → M / M → wire | Responses wire → M / M → wire | Chat wire → M / M → wire |
| --- | --- | --- | --- |
| `end_turn` | `end_turn` ↔ same | Completed ordinary message → end_turn; reverse needs response status/content | `stop` → end_turn unless refusal; inverse `stop` cannot distinguish supplied stop sequence |
| `tool_use` | `tool_use` ↔ same | Completed response containing actionable client function calls → tool_use; reverse requires those items | `tool_calls` ↔ tool_use with a completed function call; legacy `function_call` needs explicit legacy handling |
| `max_tokens` | `max_tokens` ↔ same | `incomplete` + `max_output_tokens` ↔ max_tokens | `length` ↔ max_tokens |
| `refusal` | `refusal` ↔ same, but text/metadata still need preservation | Refusal content → refusal; reverse needs a refusal part and original status (G5/G6) | `message.refusal`/refusal deltas → refusal; reverse needs content, not only `finish_reason` |
| `interrupted` | No native equivalent; core records it after stream error/cancel | Failed/cancelled transport is an error/core interruption, not successful completion; native cancelled state needs metadata | No native finish reason; EOF/cancel → error and core interruption |

Do not silently fold these wire outcomes into ordinary success:

- Anthropic `stop_sequence`, `pause_turn`, `model_context_window_exceeded`, and beta compaction
  termination need distinct handling. A paused server-tool turn is not a client-tool call.
- Responses `incomplete_details.reason` additionally includes `content_filter`, `max_messages`
  and `steered` in the reviewed reference. The last has successor/steering semantics that an
  ordinary local cancellation does not preserve. Failed/cancelled/background states also carry
  information beyond the five canonical stop reasons.
- Chat `content_filter` is not the same observation as an assistant refusal; `stop` loses the
  natural-stop versus stop-sequence distinction. Unknown/new finish reasons must fail closed.

These are **G6**, with any lossy fallback requiring a named policy rather than a misleading
claim of exact mapping.

## Usage: all fields, both directions

The current `Usage.inputTokens` contract does not define whether cache tokens are included.
**Proposed normalization for D2:** total input tokens including cache reads/writes; output totals
include reasoning tokens already counted by the provider. The table assumes that proposal and
does not change the contract. Missing counters stay unknown, not fabricated zero (G7).

| M field | Anthropic wire → M / M → wire | Responses wire → M / M → wire | Chat wire → M / M → wire |
| --- | --- | --- | --- |
| `inputTokens` | `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`; inverse subtract known cache counters | `input_tokens` ↔ same; cache counts are subcounts | `prompt_tokens` ↔ same; cache counts are subcounts |
| `outputTokens` | `output_tokens` ↔ same; use final cumulative value, not sum of updates | `output_tokens` ↔ same | `completion_tokens` ↔ same |
| `cacheReadTokens` | `cache_read_input_tokens` ↔ same when present | `input_tokens_details.cached_tokens` ↔ same when present | `prompt_tokens_details.cached_tokens` ↔ same when present |
| `cacheWriteTokens` | `cache_creation_input_tokens` ↔ aggregate; per-TTL split cannot be recovered | Current `input_tokens_details.cache_write_tokens` ↔ same when present | Current `prompt_tokens_details.cache_write_tokens` ↔ same when present; compatible servers may omit it |

Example of the proposed accounting: Anthropic 40 new + 10 cache-read + 20 cache-write tokens
normalizes to 70 input tokens. A Responses/Chat total of 70 with those same subcounts stays 70,
not 100. Twelve output tokens including four reasoning tokens stays 12, not 16.

Totals alone cannot reconstruct detailed reasoning/audio/image/prediction counters, cache TTL
breakdowns or provider billing adjustments. Usage is observation, not a field to echo in a model
request. A stream can be interrupted before final usage; the required integer totals and an
`error` event without usage cannot preserve unknown/partial accounting. ADR 0003 accepts the
normalization and presence requirements; the persisted-format amendment remains pending.

## Request placement and capability boundary

The current request model must also be validated before rendering: `system` accepts arbitrary
canonical parts, but Anthropic and Chat system blocks restrict their content. Responses may
render initial text instructions through `instructions` or a supported instruction input item;
these are not equivalent to relocating mid-conversation instructions. Tool results become
Anthropic user blocks, Responses output items, or Chat tool-role messages, not ordinary user
text. `ToolSpec.inputSchema` is a JSON schema whose supported dialect/strictness needs a provider
profile. Output budget fields are `max_tokens`, `max_output_tokens`, and Chat
`max_completion_tokens` (or a verified compatible server's `max_tokens`); the adapter must not
assume every server accepts all aliases. These are rendering constraints, not new core behavior.

## Gaps and suggested treatment

| Gap | Evidence against the current contract | Proposed treatment for owner review |
| --- | --- | --- |
| G1: replay envelope | Responses message/item IDs, message phase, status, provider response IDs; signed replay context is more than flat text | Keep typed common parts plus a bounded, versioned, provider-scoped replay envelope. Preserve item grouping/order. Origin must include sufficient server/account/API-profile identity, not merely a reused model name |
| G2: tools | Anthropic object arguments versus raw strings; distinct Responses item/call IDs; free-form custom tools; native result status weaker than moyyi | Preserve raw arguments plus provenance of synthesized JSON, tool kind and provider pairing; reject unsupported kinds. Define explicit status rendering; never equate unknown with a known failure |
| G3: modalities and references | Images lack URL/file ID/detail; document/file/audio/video families and image tool outputs differ by role/protocol | Explicit supported subset and unsupported errors now; versioned parts/reference metadata only after approval. Blob import requires permission and bounded bytes, never implicit network fetching |
| G4: reasoning | Signed blocks, redacted blocks, encrypted items, visible text and summaries are different; one delta subtype cannot distinguish them | Retain the entire provider-owned object unchanged. Add explicit visible/summary kind if approved. No cross-provider or cross-model replay of opaque state under the current contract, no signature synthesis |
| G5: annotations/refusal/cache controls | Text has no citations, refusal marker or per-block cache boundary; refusal termination alone does not store refusal text correctly | Add typed refusal/annotation metadata or reject unsupported paths. Keep request cache policy separate from stored model claims |
| G6: termination | Pause, stop sequence, filtering, context limit, max-messages, steering and cancellation cannot round-trip through five values | Separate normalized outcome from provider termination detail; distinguish core interruption from successful model completion |
| G7: accounting | Required counts cannot express unknown usage; no partial/error usage or detailed cache/reasoning accounting | Define units/inclusion, presence and partial/final status; preserve provider counters without double-counting |
| G8: streaming | Lost item namespaces, start metadata, sequence IDs, chunk boundaries and progress events | Adapter-local indexed assembly; retain semantic replay metadata. Keep transport framing out of core. Unsupported semantic events must not disappear silently |
| G9: error/retry evidence | `partialOutput` currently means completed parts, while visible deltas can already have escaped before any part completes | Track observed partial deltas for safe retry policy too; preserve errors and partial usage. Do not infer retry safety solely from this flag |
| G10: provider feature profile | System/content role constraints, schema dialects, server tools, parser/template behavior and multiple choices differ | Validate requests against an explicit profile before I/O. Hosted tools are unsupported until separately authorized and modeled; they cannot bypass local policy/journal |

`ReasoningPart.opaque: unknown` can technically hold more data, but using it to smuggle arbitrary
non-reasoning message metadata would weaken the domain model. An existing rendered-request blob
records a request already sent; it is not a complete raw-response envelope and does not by
itself solve reconstruction of the next request after restart/compaction.

## Fixtures and validation scope

All examples are **handwritten from the specification**, not copied documentation examples or
recorded traffic. Each fixture directory has provenance, retrieval date, source URLs and limits:

- [Anthropic](../../tests/fixtures/protocols/anthropic/README.md)
- [Responses](../../tests/fixtures/protocols/openai-responses/README.md)
- [Chat / vLLM](../../tests/fixtures/protocols/openai-chat/README.md)

The `examples.json` envelope is test metadata; its `body` and event `data` are the illustrative
wire values. Synthetic signatures, encrypted payloads and IDs cannot authenticate or resume a
real conversation. JSON/structural checks do not certify acceptance by a service, SDK or model.
No provider adapter, automatic converter, model invocation or recording system is implemented
by this batch. Batch 6 will need actual decoder/renderer tests and `checkModelStream` on their
decoded results under the accepted D2 and D5 decisions and their implementation briefs.

## D2 alternatives considered

Research-stage options, retained to explain the decision:

1. **Keep v1 and enforce a narrow supported subset.** Lowest migration work, but reject or
   explicitly disable unsupported refusal, multimodal, reasoning replay and termination paths.
   Do not advertise full cross-provider round-trip support.
2. **Typed common model plus provider-scoped replay envelope (recommended).** Retain ownership
   of the core and common semantics while preserving real provider differences. Decide G1–G7
   together, including usage normalization, before changing the persisted format; use the
   existing format-change recipe and a new version if needed.
3. **Persist provider-native messages as the main model.** Simplifies same-provider preservation,
   but makes core/context/compaction depend on vendor shapes and complicates model switching.
   Not recommended for the self-owned core goal.

The owner subsequently accepted recommendation 2 in ADR 0003, including its one-time pre-storage
v1 amendment exception. D1, D3 and D5 are also settled; the [current handoff](../tasks/2026-10-24-codex-handoff.md)
records them and their implementation gates. No storage, loop or format amendment is authorized
by this research document. Batch 3 remains unstarted.
