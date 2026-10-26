# ADR 0023: Explicit DeepSeek reasoning effort

Status: accepted for this implementation, 2026-10-26. D1–D6 and the persisted contracts are unchanged.

## Evidence and scope

The owner authorized exposing reasoning effort while retaining Flash, Responses, the original
source-analysis task, its acceptance criteria and an eight-request live ceiling. A preceding
eight-request diagnostic held the source and prompt fixed across Flash/Pro and Responses/Chat.
All four high-effort conditions exhausted the 8,192-token output cap. An exploratory low-effort
follow-up completed both Flash conditions, while Pro still truncated. Completed answers still
had errors or coverage gaps. Each condition had one sample and low followed high; this is evidence
for making the parameter explicit, not proof of stable superiority or a passed autonomous task.

The [official thinking guide](https://api-docs.deepseek.com/guides/thinking_mode/) and
[Responses mapping](https://api-docs.deepseek.com/guides/responses_api/), checked 2026-10-26,
document `none`, `low`, `high` and `max` in `reasoning.effort`. The token cap covers reasoning and
answer together. The current adapter's fixed high setting prevented hosts from controlling that
tradeoff without rewriting transport bytes.

## Decision

Add `RuntimeOptions.deepseekReasoningEffort`, separate from the live connection so offline replay
can select the same configuration without credentials. Omission remains high for compatibility.
Only the four canonical values are supported. Validate before runtime-owned storage, transport or
credentials; reject an explicit setting without the built-in DeepSeek connection/replay and model.
Capture the primitive in runtime, plugin and client factories and copy the selected model before
asynchronous setup; caller mutation must not alter either selection or recording identity.

Only `wire.reasoning.effort` changes. Keep Flash, Responses, prompts, tool definitions, permissions,
retry policy, request/output limits and common model contracts unchanged. Earlier visible reasoning
is still preserved when reconstructing valid history, including when a later runtime uses none.
No automatic effort switching or provider fallback is introduced.

Expose `deepSeekApiProfile(effort)` to installed hosts. High returns the existing profile ID;
other efforts append distinct suffixes. Runtime validates the chosen profile against effort,
snapshots recording settings and parses replay records before the first asynchronous plugin setup.
This prevents low requests from being labeled or replayed as high after caller configuration drift.
The existing recording metadata and format suffice; no old fixture or persisted contract changes.

Session DB request records deliberately remain common requests, so they do not independently
capture effort. Exact wire reconstruction requires the host settings or optional profile-bound
recording. Live acceptance without that recorder keeps a private configuration and wire-hash audit.
Do not encode configuration into prompts, model identities, provider stop reasons or renderer IDs.

## Alternatives and validation

Changing the global default would silently alter existing hosts and recordings. Raising the output
or request ceiling would violate the bounded comparison. Replacing the API or model is not supported
by that diagnostic. A generic provider-settings framework is unnecessary for this one documented
control, so configuration stays in the existing provider and runtime boundary.

Offline checks cover the four values, byte-equivalent requests except effort, fail-before-I/O
validation, mutation during setup and between requests, low file-tool continuation/record/replay,
cross-effort rejection and the installed public types. The owner-authorized low autonomous trial
retains the original question and source snapshot with no supplied evidence or reference answers;
its outcome is recorded in [the delivery note](../tasks/2026-10-26-configurable-reasoning.md).
Offline conformance and normal completion do not establish model factual accuracy.

No upstream or OpenBot code or prompts were copied or substantially adapted.
