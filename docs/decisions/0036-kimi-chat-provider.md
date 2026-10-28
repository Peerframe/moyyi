# ADR 0036: Kimi K3.1 Pro through an independent Chat Completions provider

- Status: accepted
- Date: 2026-10-27
- Scope: optional text, visible reasoning and local function tools; no default-model change

## Decision and evidence

Add an independent `provider-kimi` using Kimi Open Platform Chat Completions. Keep the self-owned
core, permission pipeline, request budget and persisted format unchanged. Do not present Kimi as
DeepSeek or load an upstream agent SDK. The owner's Flash default remains unchanged.

The [official API](https://platform.kimi.com/docs/api/chat),
[thinking guide](https://platform.kimi.com/docs/guide/use-thinking-models) and
[tool-choice guide](https://platform.kimi.com/docs/guide/use-tool-choice) were reviewed on this date.
Use the fixed `kimi-k3.1-pro` identifier, `reasoning_effort` low/high/max, `max_completion_tokens`,
one streamed choice and usage reporting. Low is the moyyi default for this opt-in connection.
The provider's same-named effort is not evidence of equal compute to Flash low.

Native Responses was considered first to minimize protocol differences. A two-request synthetic
live probe received a valid K3.1 Pro tool call (HTTP200), then an explicit HTTP400 rejecting
`tool_choice: "none"`. The [Responses reference](https://platform.kimi.com/docs/api/responses)
also declares only auto. Dropping the final-request guarantee or hiding prior tool definitions
is not an acceptable compatibility fix. A separate Chat probe completed the same synthetic
tool/result/final-none flow in two HTTP200 responses, with no retry. These are connection facts,
not task-quality results. Private ledgers preserve both trials; no keys or private logs are copied.

## Boundaries

- The trusted host explicitly selects China (`api.moonshot.cn`) or global (`api.moonshot.ai`).
  Each credential is used only at that fixed HTTPS origin; no redirect or regional fallback.
  Key lookup happens only on an actual request through an explicit callback, never environment
  discovery. No key, transport exception or authorization header enters model events.
- Preserve visible `reasoning_content`, text, function identifiers and verbatim argument strings
  through the common content format. Summary/opaque reasoning and incomplete assistant history
  are not silently converted into a complete Kimi continuation. No new replay envelope is needed
  for this bounded plaintext profile; foreign replay data grants no authority.
- Bound bytes, event counts and tool counts. Validate model, choice, identity, finish reason and
  SSE completion. A partial tool is never executable. Preserve observed usage as partial until
  completion; missing counters are unknown, not zero. Input includes cache subsets and output
  includes reasoning. Refusal, truncation, transport and protocol errors remain distinct.
- Keep definitions/history on the final request with `tool_choice: "none"`; core still independently
  refuses new calls. Provider performs one HTTP attempt, with no tools, loop or automatic retry.
- Record/replay identity includes this adapter profile and reasoning setting. Existing permission,
  compaction, recording and restart tests apply; Kimi Code subscriptions, third-party endpoints,
  server tools, images and other models are outside this connection.

## Reuse and validation

The HTTP cleanup/error pattern and bounded SSE framing are adapted from moyyi's existing
providers. Kimi wire assembly and decoding live in their own plugin; there is no cross-plugin
import, new dependency or copied upstream agent implementation. A general provider framework
is not required for this concrete integration.

Offline acceptance covers the real runtime, SQLite, read results in the next request, final-none
enforcement, interrupted tools, compaction/restart, recording/replay, fixed-region transport and
an installed package outside the source checkout. Live original-task comparison uses the
unchanged source, prompt and six required rubric items, independently of connection acceptance.
The historical Flash FAIL remains a sealed result. See the [system overview](../system-overview.md)
for the current observed outcome and remaining limitations.

## HTTP429 diagnosis follow-up (2026-10-28)

The status-only adapter erased a distinction required by the official
[error reference](https://platform.kimi.com/docs/api/errors) and
[troubleshooting guide](https://www.kimi.com/help/kimi-api/api-troubleshooting):
`engine_overloaded_error` is service capacity, `rate_limit_reached_error` is an account rate
limit, and `exceeded_current_quota_error` is account quota/balance. A bare429 cannot distinguish
them. Earlier private controls captured engine overload; the subsequent M4 third-request429
discarded its body and cannot be retrospectively assigned that cause.

The [official limits](https://platform.kimi.com/docs/pricing/limits) are shared across keys and
models; input plus requested output tokens contribute to admission estimates. The owner's
console showed positive balance and Tier1 limits above this trial's own traffic. That does not
establish other account traffic or service availability. Do not recharge, change region/model,
reduce original output limits or add automatic retries as an unproven workaround.

Read only a bounded error body, classify the three exact `error.type` values, and emit fixed
actionable text. Never expose the provider's arbitrary message, code or raw body. Malformed,
missing, oversized, stalled or otherwise unreadable diagnostics preserve an unknown429; host
cancellation still cancels the run. The phase-deadline follow-up in [ADR0042](0042-direct-evidence-answer.md)
preserves an already received HTTP failure when its diagnostic read is cancelled, so a known429
cannot authorize a fresh final request; user cancellation retains priority in core. This adds no model request, dependency, new persistent format or
retry. An authorized independent acceptance remains necessary to establish service availability
and answer quality; diagnosing an error is not a semantic pass. No upstream source was copied.
