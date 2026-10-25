# ADR 0021: Request-budget guidance and a reserved final answer

Status: accepted for this implementation, 2026-10-26. D1–D6 are unchanged.

## Problem and evidence

A bounded real-project read-only trial exhausted eight DeepSeek requests on evidence gathering
without a final answer. All eight HTTP calls succeeded; the trial's byte limits did not trigger.
The model corrected one tool error, but the initial user instruction to reserve an answer was
insufficient. Raising the request limit would not establish bounded completion behavior.

Reviewed on 2026-10-26 against the existing pinned implementation:

- [DeepSeek Responses reference](https://api-docs.deepseek.com/api/create-response/) supports
  `tool_choice: "none"` to disable tool calls; the [Responses guide](https://api-docs.deepseek.com/guides/responses_api/)
  requires complete stateless history and says `max_tool_calls` is ignored.
- [Anthropic tool selection](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools)
  supports `{type: "none"}`, including thinking modes. Existing signed thinking must remain
  unchanged; see [Anthropic errors](https://platform.claude.com/docs/en/api/errors).
- moyyi's Anthropic replay binds system, tool definitions and historical messages. Clearing
  definitions or updating a system prompt on every attempt would invalidate those prefixes.
  Ordinary consecutive user messages deliberately act as interruption barriers in that adapter.

No external source or prompt is copied, no dependency is added, and no persisted schema changes.

## Decision

The core owns this execution guarantee. Before each ordinary conversation request, it appends
a `model_request_budget` notice containing the upcoming attempt number, total and remaining
requests **including this one**. Every actual attempt, including a retry, consumes the existing
`maxModelRequests` limit. The default and host-configured limits are not increased.

The last permitted attempt is reserved for an answer. The notice asks for findings based only
on available evidence, distinguishing verified results, incomplete work and uncertainty. A
one-request run starts in this mode: it can answer from existing context but cannot gather
new tool evidence. Earlier responses can finish normally without using all available requests.

`ModelRequest.toolChoice?: "none"` is an optional, nonpersisted model-port control. Definitions
remain available to interpret prior tool history. DeepSeek maps it to `tool_choice: "none"`;
Anthropic maps it to `{type: "none"}`. Omission retains prior wire behavior; invalid values are
rejected. Custom providers must honor the control, but core enforcement does not trust them.

On the last attempt, any completed tool call is paired with a `denied` result without running
prepare, approval or execute and without inventing an effect. The run ends with request budget
exhaustion, not completion. Interrupted calls retain the existing failed/cancelled pairing.
Cancellation during assistant or result publication wins over the budget outcome. A final
provider error fails without retry/backoff; it cannot spend a ninth request or create a second
allowance. Timeouts, cancellation, context capacity and other safety checks retain precedence.

Only a complete `end_turn` or explicit `refusal` containing nonblank text/refusal is accepted as
a final response. Empty, reasoning-only, truncated and other stop reasons cannot masquerade as
completion in this mode. `completed` describes protocol completion, not independent proof that
the user's task is correct or fully solved; task evaluators still judge the answer.

## Context, persistence and replay

Budget guidance is durable history, not a changing system prefix. Context appends this specific
core notice to the immediately preceding user message's content when possible, after tool
results. It does not merge arbitrary adjacent user messages or remove interruption barriers.
Each old notice remains in its original position; later requests extend earlier prefixes.
Notices do not confer permission, alter tool policy, or remove evidence.

Context receives the optional tool choice so its normal size accounting includes the control;
core also enforces it on a custom builder's returned final request. Rendered request blobs use
`moyyi-core-v2` and record the optional control with origin/system/output metadata. Existing
`RenderedRequestRef` and `src/contracts/persisted` remain unchanged. Model recordings validate
and hash the optional field; removing it or changing the request fails exact replay matching.
Old recordings without the field still parse and replay against their exact old requests.
New guidance is not silently backfilled into old recordings; there is no live fallback.

Explicit compaction retains its dedicated tool-free summary behavior and is not a second
closeout budget. A context failure before the reserved request can still prevent an answer.
This change does not add automatic compaction, time-budget prediction, model judgement of
success, a new execution loop, or a guarantee of correct model prose.

## Validation

Core/runtime tests and the existing core conformance suite cover countdown, one-request mode,
successful closeout with prior tool results, forbidden final calls, blank/truncated answers,
refusal, retry accounting, no final retry, and cancellation at durable publication boundaries.
The core suite is now part of CI. Provider tests preserve full tool history and valid Anthropic
signed replay through budget notices and final tool choice. Recording tests bind the control.
Existing public-task checkers, quotas, timeouts and persisted fixtures are not relaxed.

Synthetic checks prove wiring and enforcement, not live model quality. The owner authorized a
separate bounded read-only DeepSeek retest after offline acceptance, within the existing eight
requests and zero automatic retries. Public release is explicitly excluded; delivery is a branch,
PR and local candidate installation. Live observations are recorded separately from fixture results.
