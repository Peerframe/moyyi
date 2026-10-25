# 0007: DeepSeek as the first model provider

Status: accepted (D5, owner decision 2026-10-25); batch 6 implementation in review, live acceptance pending

## Decision

Use the official DeepSeek API as moyyi's first real model service. The initial integration
target is `deepseek-flash`, served as DeepSeek-V4.1-Flash-1017 when reviewed on 2026-10-25.
Use its Responses API subset at `https://api.deepseek.com`, with thinking and client-executed
function tools. Implement the provider-specific adapter in `src/plugins/provider-deepseek`;
sharing a wire format does not imply complete OpenAI compatibility.

moyyi retains its own loop, context, recording, permissions, tool execution, retry and recovery.
No external agent harness is adopted. An SDK, if selected later, is transport only and must have
automatic retries disabled. The batch 6 transport decision is recorded in [ADR 0010](0010-deepseek-transport-and-recording.md):
existing native HTTP, no SDK or automatic provider retry.

The immediate objective is a reliable agent using an existing model. Qwen, self-hosting and
shasha training are deferred directions, not first-release prerequisites. This decision neither
selects a training base nor authorizes model training, compute purchases or model calls.

## Rationale and alternatives

The owner selected DeepSeek after considering OpenAI, Anthropic and Qwen. Its documented tool
and image support covers the intended model interface, and its prices permit repeated task
evaluation at modest token cost. These are interface and budget facts, not proof of task quality.
The earlier OpenAI-first recommendation is superseded; there is no automatic fallback or second
provider requirement in phase 1. Another provider can be added later through the same contracts.

## Integration requirements

The [Responses guide](https://api-docs.deepseek.com/guides/responses_api/) describes a subset:

- It is stateless: moyyi must supply history; server conversation IDs and stored responses are
  unavailable. Preserve the raw reasoning needed for continuation, not just summaries.
- The server ignores tool parallelism/count limits. moyyi must enforce execution limits itself.
- `developer` is treated as `user`; do not place trusted system instructions in that role.
- Unsupported items and options may be ignored. The adapter must reject unsupported paths
  locally instead of silently losing information or promising an unenforced limit.

The [thinking guide](https://api-docs.deepseek.com/guides/thinking_mode/) requires full prior
`reasoning_content` when Chat requests carry tools, even for turns without a call. Map this to
Responses reasoning items with synthetic fixtures; do not assume another provider's replay
rules. D2's common content and origin/hash-bound replay information still apply. If required
replay state is invalidated, proceed only with a documented valid request representation;
otherwise stop with an explicit error or use a separately specified context rebuild. Never
repair stale state or automatically repeat an action. This matches the clarified invalidation
rule in [ADR 0003](0003-provider-neutral-content.md); the separate pre-storage amendment brief
must turn it into explicit fields and validation cases.

The model name is a rolling alias, not a pinned model artifact. Acceptance records must include
the requested name, date, API profile and any reported server model version; unknown version
identity must remain unknown. Do not invent a versioned API model ID from the release title.
Resolve replay compatibility across alias upgrades in the amendment/adapter work.

Phase 1 exposes only the authorized read-only moyyi tools. Model support for images or vendor
tools does not add a browser, shell, server-side search or a computer-use feature to this phase.

## Cost snapshot

Official [prices](https://api-docs.deepseek.com/quick_start/pricing/), read 2026-10-25,
in USD per million tokens for `deepseek-flash`:

| Billing item | Off-peak | Peak |
|---|---:|---:|
| Input, cache miss | 0.15 | 0.30 |
| Input, cache hit | 0.003 | 0.006 |
| Output | 0.60 | 1.20 |

Peak hours are weekdays 01:00–04:00 and 06:00–10:00 UTC, excluding Chinese public holidays.
100,000 uncached input plus 10,000 billable output tokens cost USD 0.021–0.042 at these rates.
This is arithmetic, not a per-task estimate; repeated history, reasoning and retries affect
usage. Other services and taxes are excluded. Recheck the price before paid acceptance.

## Acceptance

The batch 6 branch implements the synthetic mapping, provider and record/replay checks below;
executed evidence is in [the current handoff](../tasks/2026-10-25-batch-6-deepseek.md).
Live service acceptance remains outstanding.

Extend batch 2's mapping with DeepSeek-specific role, reasoning, usage, error and stream cases.
Test synthetic decode/replay, cancellation, incomplete/failed/EOF handling and unknown usage
through `checkModelStream`; preserve the no-provider-retries rule. Synthetic examples do not
prove that the service accepts a request. Owner-run live smoke and read-only task evaluation
remain batch 6 / phase 1 gates under the handoff's credential and payment restrictions.

Sources are official documentation, including the [release log](https://api-docs.deepseek.com/updates/).
No model calls were made and no upstream source was copied or adapted for this decision.
