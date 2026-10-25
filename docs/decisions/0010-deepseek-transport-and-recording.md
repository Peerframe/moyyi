# 0010: DeepSeek transport and deterministic model recordings

Status: accepted for batch 6 (2026-10-25); live service acceptance pending

## Decision and evidence

Implement the [ADR 0007](0007-first-model-provider.md) text/function Responses subset with the
existing Node 26 `fetch`, a provider-owned bounded SSE decoder, and host-owned credential access.
The URL is fixed to `https://api.deepseek.com/responses`; redirects are errors. Each provider call
makes at most one HTTP attempt. Only the existing core retry policy can authorize another attempt.
No dependency, agent harness, persisted v1 field, database schema or boundary rule is added.

The alternative reviewed was **openai 7.32.0**, released **2026-10-09**, Apache-2.0, commit
`2b12eabd29733c8de495bb183b41632e091b4994`. It supports Node 22+, includes Responses streaming and
has no mandatory runtime dependencies. Its default two retries would require `maxRetries: 0`.
It does not validate DeepSeek's narrower content/history rules. Native HTTP avoids a second API
model and version lifecycle for one fixed endpoint; the cost is maintaining framing, cancellation
and error handling locally. This is a transport choice, not rejection of mature SDKs in general.
Revisit when additional supported wire features materially exceed this decoder's scope.

Primary sources reviewed on 2026-10-25:

- [DeepSeek Responses guide](https://api-docs.deepseek.com/guides/responses_api/)
  and [create response](https://api-docs.deepseek.com/api/create-response/): stateless subset,
  instructions, full reasoning, function items and unsupported/ignored fields.
- [Thinking](https://api-docs.deepseek.com/guides/thinking_mode/),
  [errors](https://api-docs.deepseek.com/quick_start/error_codes/),
  [rate limits](https://api-docs.deepseek.com/quick_start/rate_limit/),
  [model limits/pricing](https://api-docs.deepseek.com/quick_start/pricing/),
  [updates](https://api-docs.deepseek.com/updates/).
- [Responses streaming event definitions](https://developers.openai.com/api/reference/resources/responses/streaming-events),
  only as referenced protocol structure; unsupported DeepSeek paths are rejected.
- [WHATWG event stream parsing](https://html.spec.whatwg.org/multipage/server-sent-events.html#parsing-an-event-stream):
  UTF-8, BOM, CR/LF/CRLF, comments and multiline data; no EventSource reconnection is adopted.
- [SDK release](https://github.com/openai/openai-node/releases/tag/v7.32.0),
  [exact package metadata](https://registry.npmjs.org/openai/7.32.0),
  [retry documentation at that tag](https://github.com/openai/openai-node/blob/v7.32.0/README.md#retries).

No upstream or OpenBot source was copied or substantially adapted. The strict JSON scanner was
moved from moyyi's existing argument validator to contracts so both boundaries reject duplicate
keys, invalid Unicode, nonfinite numbers and oversized/deep input consistently.

## Content and authority

The adapter renders complete stateless history from common content; opaque replay payloads are
not read. It emits full visible reasoning, text and function calls with verbatim arguments and
provider IDs. Tool results carry their status and common text in a JSON string. Assistant history
with tools requires explicit `end_turn`/`tool_use` and nonempty visible reasoning. The nonpersisted
`ModelMessage.stopReason` port preserves the already-stored completion status through context
assembly. Missing, interrupted, truncated or unsupported history fails locally before HTTP.

The supported profile is `deepseek-responses-text-v1-2026-10-25`, with `deepseek-flash`, high
reasoning effort, a 1,000,000-token context declaration and a deliberately conservative **8,192**
output-token limit. This is lower than the reviewed service limit, not a claim about its maximum.
Images, summaries, opaque-only reasoning, commentary/unknown assistant phases, refusal content items, hosted tools,
server-stored conversations and vendor-specific request options are outside this profile.
No `parallel_tool_calls` or `max_tool_calls` promise is delegated to the server; moyyi's existing
execution limits apply. Unsupported cases fail closed and may need a later adapter profile.

### Auxiliary reasoning output compatibility (2026-10-25)

An owner-authorized one-request diagnostic received a reasoning `output_item.added` containing
`content: []`, `summary: []`, status `in_progress` and a nonempty `encrypted_content` string, followed
by a visible reasoning content event/delta. The previous decoder rejected that added item. The
private five-event prefix is not committed; synthetic fixtures reproduce its relevant shape.

The DeepSeek guide's unsupported `encrypted_content` statement concerns **input items**. The
guide refers to the [Responses schema](https://developers.openai.com/api/reference/resources/responses/methods/create),
whose reasoning output field is optional string/null and whose added value may be incomplete.
DeepSeek's own output schema does not explicitly enumerate that field; the observed trace is the
evidence for accepting it here. This does not add support for opaque reasoning or encrypted replay.

Accept a well-formed auxiliary string up to 64 KiB UTF-8 (within existing stream/semantic budgets),
then discard it. Keep only a per-item presence flag so disappearance at done/terminal cannot turn
opaque-only output into a successful visible response. Such an item must finish with nonblank
visible reasoning. Auxiliary values may change; identity, lifecycle, argument and visible-content
consistency checks still apply. The field never enters common content, recordings, replay or
subsequent input. Full visible text remains the evidence required by this stateless profile.

This is an output compatibility correction to the existing profile. Common request/event semantics,
the profile identifier, D2 envelopes, persisted v1 and authority boundaries do not change. No upstream
source or private response text was copied. Offline replay closes this first rejection only; the
captured prefix ends before a terminal event and is correctly reported as interrupted.

### Final-answer output annotation compatibility (2026-10-25)

A subsequent separately authorized minimal request returned HTTP 200 and a complete private wire
capture: visible reasoning, an assistant message with `phase: "final_answer"` in added/done/terminal
snapshots, and `response.completed`. The installed decoder rejected the message's added event.
The capture contains the final answer and usage, so this defect can be reproduced and verified
offline without another paid request. No private IDs, reasoning or wire transcript enter the repo.

Accept only absent, null or `"final_answer"` on message output, validating every item snapshot;
normalize that annotation away. Commentary, unknown phases and invalid types remain unsupported.
This maps the observed final-answer text to the profile's existing assistant text. It does not
declare a successful turn: response status and its terminal event still govern completion, refusal,
truncation, failure and tool execution. EOF remains interrupted, and a response containing a function
call still completes as `tool_use`. Identity, lifecycle and streamed/final content equality remain.

The [DeepSeek guide](https://api-docs.deepseek.com/guides/responses_api/) defines response terminal
events and stateless plaintext continuation; its [input schema](https://api-docs.deepseek.com/api/create-response/)
does not specify a `phase` field. It does not explicitly document this output annotation either;
the actual capture establishes its presence. Within this supported subset, no extra replay state
is needed: common event and request semantics, D2 envelopes, persisted v1 and the profile identifier
stay unchanged. This is not a general rule for other providers' phase or reasoning requirements.
Real DeepSeek multi-turn quality and tool continuation remain unverified.

Synthetic regressions cover lifecycle variants, terminal authority and rejected commentary before
tool execution. The existing runtime/SQLite record-replay eval confirms that normalized recordings
and reconstructed input omit the annotation. Offline decoding of the entire private wire returns
the final answer and reported usage. No upstream implementation was copied or dependency added.

## Recording and replay

Optional `RecordingModelClient` wraps any common model client. Versioned recordings contain the
canonical request, normalized stream events, requested/reported model, timestamp, API profile and
explicit `live` or `synthetic` source. They do not contain HTTP headers or credentials. This is
common-event replay, not a byte-exact wire archive. Handwritten wire fixtures are separately
marked synthetic. A reported rolling alias does not establish an underlying server revision.

Requests and artifacts have SHA-256 integrity hashes over canonical JSON. Replay validates the
whole artifact and requires the same profile and exact request; mismatch never falls back to a
live client. Hashes detect accidental changes, not an attacker who can recompute them. Recordings
can contain complete private prompts/reasoning and must remain local and trusted.

Record/replay handles one sequential model stream per wrapper; concurrent use is rejected without
consuming a record or making another request. Ordinary runtimes retain their existing concurrency.
Replay reexecutes authorized tools: identical tool state and external cancellation schedule are
required for the same whole-run result. It is not recovery, and never replays unknown journal effects.

The file sink creates an empty private directory (0700), atomically publishes 0600 files without
overwrite, and rejects symlinks, corruption and resource-limit violations. The runtime excludes
that directory from ordinary file-tool access. Custom sinks require explicit protected paths.
A sink failure prevents the terminal result from being acknowledged. Write-attempt IDs and an
explicit sink invalidation contract isolate failed publications; pending markers make interrupted
file publications non-replayable. Consumer-return/cancellation finalizes the delivered prefix.
Runtime idle/close waits for recording finalization without making core cancellation wait. Limits are 8 MiB/8,192 events
per exchange and 1,024 files/64 MiB per directory. Data is not application-encrypted; D3 explicitly
does not require that for the first release. Backup and cryptographic authenticity are not claimed.

## Validation and limits

Semantic fixtures, framing/HTTP failures, cancellation, conformance, integrity and real read-only
file/SQLite record-replay integration are tested offline. The transport uses injected synthetic
credentials and fetch in tests. No credential lookup, paid call or private eval is part of acceptance.
See [batch 6 handoff](../tasks/2026-10-25-batch-6-deepseek.md) for executed evidence.
Owner-run live smoke and real-agent quality/cost evaluation remain outstanding; synthetic agreement
cannot prove that the current remote service accepts our requests.
