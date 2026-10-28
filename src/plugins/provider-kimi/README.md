# Kimi text and local function provider

This plugin translates the common model contract to Kimi's Chat Completions API for
`kimi-k3.1-pro`. It implements text, full visible reasoning, refusal, and local function calls.
The trusted runtime injects the transport, regional endpoint and credentials; this plugin has
no I/O, SDK dependency, retries, provider fallback, or tool execution authority.

`createKimiPlugin(transport, { reasoningEffort })` accepts `low`, `high`, or `max`; the default
is `low`. `host.config` must be absent. The model profile is a 1,048,576-token context with an
8,192-token local output ceiling. Requests use `max_completion_tokens`, `n: 1`, streaming and
`stream_options.include_usage: true`. The last-answer `tool_choice: none` retains tool definitions
and complete history; returned calls under that choice are protocol errors.

Assistant history must have a complete `end_turn`, `tool_use`, or `refusal` outcome. Full
visible `reasoning_content` is preserved exactly; summary/opaque reasoning, images, unsupported
content and interrupted/unproven assistant history fail before transport. Local function IDs
include both the response ID and provider call ID. Provider IDs can repeat in later turns;
each result still pairs with the correct local call. Arguments remain verbatim, including
malformed JSON; common validation owns execution decisions. Tool results explicitly include
their succeeded/failed/denied/cancelled/unknown status and original text.
Refusal text uses the documented assistant `content` field on continuation; no undocumented
`refusal` input parameter is sent. A content-filter terminal without explanation produces an
explicit common refusal fact, not a fabricated model quote.

The decoder requires stable response identity, exact model identity, choice zero, valid function
identity, a finish reason, the usage tail, and `[DONE]`. It rejects duplicate/trailing events,
invalid UTF-8/JSON and unsupported semantic content. EOF and cancellation produce errors,
never executable calls. `length` and `content_filter` retain their `max_tokens` and `refusal`
outcomes; the common core only executes calls after `tool_use`. Usage is partial until a complete
stream; missing counters remain null. Cache read/write are disjoint subsets of input, and
reasoning is a subset of output. No absent counter becomes zero.

Limits: requests 4 MiB; streams 8 MiB; one SSE event 1 MiB; 100,000 events; 1,024 function calls.
The host owns HTTP cancellation, deadlines and credential security. HTTP bodies and transport
diagnostics are never reflected into common errors.

HTTP 429 diagnostics read at most 16 KiB and 128 data chunks (including empty chunks), with
a separate two-second deadline and host cancellation. Only the exact documented `error.type`
values `engine_overloaded_error`, `rate_limit_reached_error` and `exceeded_current_quota_error`
select fixed overload, rate-limit or account-quota messages. Raw `message`, `code` and other
provider strings are never reflected. Invalid UTF-8/JSON, duplicate keys, missing/unknown types,
oversized bodies, read failures and diagnostic timeouts retain HTTP 429 with an explicitly
unknown cause; this uses the existing common `rate_limited` kind without asserting a specific
account limit. Once an HTTP failure is known, cancellation of its diagnostic read preserves that
failure; the core still gives user cancellation and the overall run deadline priority. Iterator cleanup and the single response
close are started without waiting on a stuck cleanup for this path. It makes one transport
attempt and adds no retry, request or success-stream change. These diagnostics cannot recover
the subtype of an older HTTP-only failure.

The 429 classification follows the official [error types](https://platform.kimi.com/docs/api/errors)
and [troubleshooting guide](https://platform.kimi.com/docs/guide/troubleshooting), reviewed on
2026-10-28. The parser reuses the local strict JSON contract; no upstream source is copied.

Protocol references reviewed on 2026-10-27:

- [Current Chat API](https://platform.kimi.com/docs/api/chat)
- [Thinking continuation](https://platform.kimi.ai/docs/guide/use-thinking-models)
- [Reasoning effort](https://platform.kimi.ai/docs/guide/use-reasoning-effort)

The separate authorized route probe observed one tool call followed by `tool_choice: none`
completion on this API. That establishes route compatibility, not task quality. Responses was
not selected: its live continuation rejected `none`. Fixtures here are handwritten protocol
data, not service recordings or proof of paid-model acceptance.

Implementation provenance: the bounded SSE framing, one-attempt transport wrapper, strict
request validation and common usage/error mapping were narrowly adapted from moyyi's existing
`provider-deepseek` implementation. They are local code under the repository license; there is
no cross-plugin import or external framework runtime. Kimi-specific message/stream assembly is
implemented here from the documented protocol.
