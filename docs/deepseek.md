# DeepSeek and model recordings

Batch 6 adds a programmatic DeepSeek provider and deterministic record/replay. The subsequent
batch 7 [CLI](cli.md) connects it through explicit trusted host configuration. The default runtime still makes no network request without explicit configuration.
Automated checks use synthetic protocol responses. Earlier live probes exposed reasoning-metadata,
final-answer-phase and tool-commentary incompatibilities, retained in the historical
[compatibility follow-up](tasks/2026-10-25-deepseek-compatibility.md). The subsequent #19 installation
passed a bounded live file-read/tool-continuation task and offline replay. Broader project-answer
quality has not passed its original criteria. See the [system overview](system-overview.md) for
the distinct merged, installed-candidate and task-acceptance states.

## Offline entry points

```sh
npm run demo:deepseek-replay
npm run eval:deepseek
```

The demo uses handwritten DeepSeek SSE, the real provider, real authorized workspace files and
SQLite. It records normalized requests/events, then runs again with the replay client and checks
results. Its temporary workspaces, stores and recordings are removed. No credential is required.
The eval is independent of the original public task checkers and does not measure model quality.

## Programmatic connection

The trusted application configures `createRuntime` with:

```ts
{
  model: { provider: "deepseek", model: "deepseek-flash" },
  deepseekReasoningEffort: "low",
  dataDirectory: "/absolute/private/new-data-directory",
  deepseek: { getApiKey: async () => /* obtain from the owner's credential store */ key },
}
```

`getApiKey` is called only when a request is sent. It is not a tool, plugin config or prompt field.
The host sends one POST to `https://api.deepseek.com/responses`, prohibits redirects, and discards
secret-bearing network diagnostics. The provider handles text, full visible reasoning and local
function calls; the runtime's existing policy controls file tools. It does not grant tool network,
write or shell access. Only the core can retry a qualifying model error.

### Reasoning effort

The trusted host may set `deepseekReasoningEffort` to `none`, `low`, `high` or `max`.
Omission preserves the existing `high` behavior. `none` disables thinking; the other values select
the provider's thinking effort. These are the canonical values from the
[official mapping](https://api-docs.deepseek.com/guides/thinking_mode/); aliases such as `medium`
are deliberately rejected. The setting requires a built-in DeepSeek connection or replay and is
captured when the runtime is created. Changing the host object afterward has no effect; recreate
the runtime to use another effort. It never grants tool permissions or changes the model or endpoint.

The 8,192-token output cap includes reasoning and answer tokens. Lower effort can leave more room
for an answer, but does not guarantee shorter thinking or correct conclusions. The owner-authorized
comparison motivating this option found completed answers with remaining factual errors; see
[ADR 0023](decisions/0023-configurable-deepseek-reasoning.md). None/max have offline protocol coverage,
not live task-quality acceptance.

Session request records contain the common `ModelRequest`, not provider-specific effort. Session
storage alone therefore cannot reconstruct the exact wire configuration. For strict diagnostic
replay, use the effort-specific recording profile below; keep the chosen host configuration and
actual wire audit with live evaluation evidence when optional recording is disabled. No transcript
format change or extra system instruction is introduced by this setting.

The supported request profile is intentionally narrow. Images, opaque-only/summarized reasoning,
refusal content items, unknown assistant phases, hosted tools and stored server
conversations are rejected. Assistant output accepts only absent/null/`"final_answer"`/`"commentary"`
phase, then discards the annotation while retaining the text and order. Added metadata
is provisional; contradictory explicit phases at item done and response terminal fail. Missing/null
annotations do not contradict an explicit value. Phase never overrides the response terminal,
promotes an interrupted or failed response to success, or changes a tool turn into a final answer. Common recordings and
the next plaintext request do not carry `phase`.
An auxiliary `encrypted_content` string in reasoning output is accepted only alongside visible
reasoning, bounded to 64 KiB UTF-8, and discarded. It is not a replacement for plaintext or a replay
credential. An item that carries it must finish with nonblank visible reasoning, even when the
field disappears at completion. The documented stateless input sends only full visible reasoning;
the auxiliary field never reaches normalized recordings, context or a later request.
The adapter also refuses incomplete or unproven assistant history when tools or historical calls
are present. It retains all actual visible reasoning, without requiring or fabricating reasoning
on every complete turn. A cancelled or truncated conversation may therefore require a new session;
automatic context rebuilding is not
implemented. No partial reasoning is silently presented as a complete continuation.

## Opt-in recording and offline replay

Installed hosts import `FileRecordingSink`, `loadModelRecordings` and `deepSeekApiProfile`
from `moyyi/runtime`. Add to a connected runtime:

```ts
modelRecording: {
  sink: new FileRecordingSink("/absolute/private/new-recordings"),
  apiProfile: deepSeekApiProfile("low"), // matches deepseekReasoningEffort: "low"
  source: "live", // use "synthetic" for injected fixtures
}
```

Use a fresh directory. Records include private prompts, complete reasoning and tool results; keep
it outside repositories and do not publish it. File permissions are 0700/0600, not encryption.
The built-in file sink is automatically excluded from workspace file tools. Protect a custom sink's
paths through `protectedPaths`. Custom sinks implement `write(recording, writeId)` and
`invalidate(writeId)`; a rejected write must leave no replayable successful artifact from that attempt.
The built-in file sink uses a pending marker and rejects recovery of an incomplete publication. No HTTP authorization headers are captured. Explicit live/synthetic
labeling is the trusted caller's responsibility, not evidence inferred from response text.

For replay use a new runtime/data directory, the same workspace state and model, and:

```ts
deepseekReasoningEffort: "low",
modelReplay: {
  records: loadModelRecordings("/absolute/private/new-recordings"),
  apiProfile: deepSeekApiProfile("low"),
}
```

Do not supply `deepseek` or `modelRecording` during replay; configuration rejects the combination.
A changed request, model, effort/profile or invalid record fails without network fallback.
`DEEPSEEK_API_PROFILE` names the current high profile,
`deepseek-responses-text-v2-2026-10-26`; other efforts have distinct suffixes. This version sends
tool results as native text parts with an explicit status, preserving readable newlines without
a nested JSON envelope. Existing v1 recordings remain unchanged, but the built-in runtime rejects
them under v2 rather than silently relabeling their wire configuration. Low records cannot replay
as high or vice versa. See [ADR 0026](decisions/0026-readable-evidence-and-action-budget.md). Runtime snapshots recording options
and validates replay records before asynchronous plugin setup, so caller mutations cannot relabel
their configuration. Sequential recordings are bounded at 8 MiB/8,192 events per exchange and 64 MiB/1,024 files per directory.
Concurrent model requests in one recording/replay wrapper fail explicitly; use separate runtimes
and directories for independent captures. `runtime.idle()` and `runtime.close()` wait for
recording finalization, including consumer cancellation; custom sinks must settle their operations. The lower-level `ReplayModelClient.assertConsumed()`
checks that a whole sequence was used.

These files replay normalized model events, not raw HTTP timing or tool side effects. Tool execution
still goes through the ordinary policy and journal. Changed files, policy or cancellation timing can
change the outcome; this is not an instruction to retry an unknown effect after a crash. Integrity
hashes are not signatures and do not make a hostile recording trusted.

## DeepSeek Harness comparison

Delivery one compares this adapter with DeepSeek Harness (DSH), MIT, fixed commit
[`f3803c96974ad4a94195fb97e5c637e9c2a3afe3`](https://github.com/deepseek-ai/deepseek-harness/tree/f3803c96974ad4a94195fb97e5c637e9c2a3afe3).
This is a source-level capability comparison. The delivery's frozen quality gate separately
measures task results. DSH uses Anthropic Messages; moyyi retains Responses, the daily/gate low
effort setting, 8192 output tokens, existing budgets and zero retries.

| Concern | DSH at the fixed commit | moyyi behavior and decision |
| --- | --- | --- |
| Request prefix | Stable prompt/history can reuse the cache. Messages can append system updates on a declared `in-history` route and supports tool-change blocks. | Context keeps `static → session → turn` sections and sorts tools by name. Budget notices and ordinary tool observations append to history. Changed earlier sections or schemas can still invalidate the later prefix. Messages-specific system/tool updates are recorded as a protocol difference. |
| Cache accounting | Messages reports uncached `input_tokens`, `cache_read_input_tokens` and `cache_creation_input_tokens`; the token meter adds these buckets to obtain the prompt total. | Responses `input_tokens` already includes cache reads. The codec records `input_tokens_details.cached_tokens` as a subcount; `cacheWriteTokens` stays `null` when unavailable. Every attempt's usage is persisted. Adding cache counts to input again would double-count; retain the existing contract. |
| Reasoning between tools | All retained assistant reasoning is passed back, with model-bound Messages thinking signatures when valid. | All actual visible reasoning from complete assistant turns is passed back, with or without tools. Incomplete assistant history is rejected. Auxiliary encrypted metadata and phase annotations are validated and discarded under the existing plaintext Responses profile; Messages signature replay is a protocol difference. |
| End of stream | Requires settled content blocks, a stop reason and `message_stop`; unexpected EOF fails. Empty successful output is rejected. | Requires a consistent Responses terminal and output lifecycle. EOF fails with `stream_interrupted`, retaining partial output and known usage. Core rejects empty/incomplete answers and treats `max_tokens` as output-budget exhaustion. No automatic continuation or retry is added. |
| Errors | Auth, quota, rate limit, context, request, transport and server failures have stable categories; all HTTP 5xx are server failures. | Existing categories and redacted diagnostics remain. Delivery one fixes 502/504 and other 5xx falling through to `protocol`: HTTP 500–599 now maps to `overloaded`. One transport invocation, cleanup and the zero-retry setting remain unchanged. |
| Output limit | Default `maxTokens` is 256000; an explicit request or model cap takes precedence. | The existing 8192-token cap includes reasoning and answer tokens and is validated before transport. This is the chosen local limit; no increase is adopted. |

Source map for the comparison:

- DSH `packages/llm/llm-deepseek`: `README.md`, `src/serialize.ts` (history and request limits),
  `src/translate.ts` (terminal and cache accounting), `src/replay.ts` (thinking signatures),
  `src/transport.ts` (failure categories), and `src/defaults.ts` (output/idle defaults).
- DSH `packages/llm/token-meter`: `README.md`, `src/turn-usage.ts` and `src/usage-projection.ts`.
  Its exact turn totals require available counters; estimated pressure is separate from billing.
- moyyi: [`codec.ts`](../src/plugins/provider-deepseek/codec.ts),
  [`index.ts`](../src/plugins/provider-deepseek/index.ts),
  [`context`](../src/context/index.ts), [`core`](../src/core/index.ts), and the existing
  [`Usage` contract](../src/contracts/persisted/transcript.ts).

DSH's [`deepseek-llm-api-wire-extensions.md`](https://github.com/deepseek-ai/deepseek-harness/blob/f3803c96974ad4a94195fb97e5c637e9c2a3afe3/docs/deepseek-llm-api-wire-extensions.md)
describes identity headers, `dsh_session_log` and `dsh_plugin_packages`. These fields are outside
model input and expose additional session/package metadata to the endpoint. This delivery does
not add them, Files API uploads, catalog discovery or DSH's retry policy. No new external service,
credential, transcript format or authority is needed for the adopted 5xx classification rule.

## Owner-only live smoke (acceptance incomplete)

This procedure requires explicit owner authorization and a bounded paid-call budget. One later
owner run stopped at commentary parsing before any tool execution; it did not complete acceptance.
No live command is run by the automated tests, demo or this compatibility implementation.

1. Use a disposable workspace outside protected paths (including `.moyyi`), containing only
   `note.txt` with synthetic text. Preflight an actual tool read with a synthetic transport first.
   Create separate fresh
   private store/recording directories outside it. Supply a credential callback from your trusted
   host; never paste the key into a task, source file, fixture or PR.
2. Configure the runtime as above, with live recording and limits `maxModelRequests: 3`,
   `timeoutMs: 120000`, `maxRetries: 0`, `maxModelResponseBytes: 65536` and
   `maxToolOutputBytes: 8192`. The adapter uses its local 8,192-token output cap. Send `session.create`,
   then `run.start` asking it to read `note.txt` and quote its contents. Use the event subscription,
   `idle()` and `close()` lifecycle demonstrated in `scripts/demo-deepseek-replay.ts`.
3. Verify the remote service accepted the request, all actual visible reasoning and function arguments
   decode, the actual read succeeds, and the next request contains the full reasoning, call and
   result. Confirm the final response and capture unknown versus reported token usage truthfully.
4. Replay locally with the captured records and identical workspace; verify no network call and
   identical final answer/tool results. Separately exercise owner-triggered cancellation, without
   pretending offline cancellation timing exactly repeats a live run.
5. Record date, requested alias `deepseek-flash`, API profile, reported model string, any independently
   known server revision, and actual usage/charge. A reported alias alone means the underlying model
   revision remains **unknown**. Keep raw private records local and report only sanitized evidence.

### Historical compatibility snapshot, before the successful #19 smoke

The following failures are retained as historical evidence. They do not describe the current
installation or authorize another request; current outcomes are in the [system overview](system-overview.md).

At that checkpoint the tool smoke had not completed. Three separately authorized single-request
probes received HTTP 200, without retries. The second captured a partial stream exposing auxiliary
reasoning metadata; its prefix still correctly reports interruption. The third captured all 23 events,
including a final `OK`, but the installed decoder rejected `phase: "final_answer"`. Offline replay
through the corrected source produces `completed` / `end_turn`, final input 34 and output 11 tokens
(including 9 reasoning tokens). No response content or terminal was fabricated. The private wire
is not committed; repository regressions use synthetic data.

A subsequent owner-authorized read task made one HTTP request with zero retries (four total historical
requests). It received 200 but stopped at a message that began as `final_answer` and completed as
`commentary`, followed by a function-call start. No file tool ran. Its private capture has no terminal,
so usage and billing remain unknown. The source correction is verified offline; no paid request is
made by this fix and an unmerged branch does not replace the installed candidate. The diagnostic
workspace was also mistakenly inside protected `.moyyi`; separate offline checks confirmed denial
there and successful reads in an external temporary workspace. No permission rule was relaxed.

Actual billing, underlying model revision, phase-sensitive continuation, real-agent pass@1/pass^k,
tool continuation, normal task latency and model quality were unverified at that checkpoint.
The subsequent #19 tool-continuation run is summarized at the top of this document; it does not
retroactively change these incomplete records. An old normalized error recording still replays
its original error. No further paid request is authorized by this documentation.
The CLI, controlled writes, native commands, compaction and second provider are merged.
The local installable candidate is described in [installation.md](installation.md); no official
release or live acceptance is implied.
