# ADR 0041: Bounded isolated evidence review

Status: withdrawn after one bounded actual-desktop trial, 2026-10-28. This document preserves
the hypothesis, original contract and result; it is not an active runtime or desktop option.
The trial does not reopen previous results, change Flash defaults, or accept M4.

## Evidence and scope

The actual desktop high trial in the [M4 receipt](../tasks/2026-10-28-desktop-m4.md) failed two
original requirements despite reading the relevant implementations. A further read-only audit
expanded all five recorded requests: system/tool/message blob hashes match; all existing tool
results0/6/12/18/22 are represented exactly. Offline Kimi encoding preserves every tool result.
The final request contained27 messages (229,432 encoded bytes); reported input was55,783 tokens.
It stopped at request5 with end_turn, below the request/time/output limits. Missing transport,
context compaction or a forced last-answer boundary do not explain these omissions.

The missing operational implications were not formed in the answer. Context size and anchoring
on earlier interpretations are hypotheses, not established root causes. Generic completeness
guidance and the withdrawn same-history findings tool have already failed; they remain withdrawn.
The core's completed outcome means the run ended, not that factual coverage passed a rubric.

## Narrow research

- [CoVe v2](https://arxiv.org/html/2309.11495v2),25 September2023, distinguishes independent
  verification from reviewing inside the original answer context. Its results support testing
  isolation, but do not establish implicit code-boundary coverage. No paper text/prompt is copied;
  the arXiv non-exclusive license is not treated as a source-code license.
- Anthropic cookbook commit`bfe50e59dbb4f5546a0af9ca36ebb77e637c9ce1`, MIT:
  [evaluator example](https://github.com/anthropics/claude-cookbooks/blob/bfe50e59dbb4f5546a0af9ca36ebb77e637c9ce1/patterns/agents/evaluator_optimizer.ipynb)
  and [request helper](https://github.com/anthropics/claude-cookbooks/blob/bfe50e59dbb4f5546a0af9ca36ebb77e637c9ce1/patterns/agents/util.py)
  show fresh requests without a new framework. Its model-PASS loop has no shared request ceiling
  and is not adopted.
- OpenAI Agents SDK commit`cd26bbbc52847845fde73b9952b51e62e2bcbdc0`, MIT:
  [judge example](https://github.com/openai/openai-agents-python/blob/cd26bbbc52847845fde73b9952b51e62e2bcbdc0/examples/agent_patterns/llm_as_a_judge.py)
  passes accumulated history to its judge and loops on model judgement. Per-Runner max-turn tests
  do not establish a shared multi-stage cap. Neither its SDK nor its prompt is adopted.

These are source/paper reviews, not executed upstream tests. No upstream code, prompt or OpenBot
source is copied or substantially adapted; no dependency is added. The previous three-project
review remains in the M4 receipt. The new hypothesis is isolated inference, not an automatic
correctness judge or another retrieval layer.

## Historical candidate contract

Trusted runtime option `answerReview: true` enables an experimental path; omission/false retains
the old loop. The desktop exposes it explicitly, default off. A total request limit of at least4
is required. Under the original8-request limit there are at most6 investigation requests, then
one evidence request and one answer request. An early answer starts those stages earlier; the
core does not force spending all8. All stages share the existing deadline, response/output limits,
recording, cancellation and actual request counter. No additional model or implicit retry is used.

This experiment requires a new session with a self-contained user question. Core rejects a new
review-enabled run when any prior user message exists, before appending input or calling a model.
The user can disable review to continue that history. This enforced boundary prevents references
to earlier assistant proposals from silently losing their meaning when the projection omits them;
it does not introduce a new summary model. History opening remains read-only and call-free.

The context layer projects recorded user inputs and tool observations into a fresh request.
Original assistant prose, reasoning, replay, evaluator criteria and prior grades are absent.
Tool names, arguments, source identities, statuses and returned text remain; only exactly identical
observations can be deduplicated. Different paths or content versions stay separate. No source
is selected because it contains a known expected answer; no lossy summary is called full evidence.
The ordinary capacity check refuses oversized inputs instead of dropping observations.

The isolated request produces bounded claims with verbatim evidence references, operational
consequences and uncertainty. The host validates structure and reference/quote existence against
successful observations. This establishes provenance only, not entailment or completeness. The
final request receives the same evidence plus the validated claims and produces the user answer.
Neither stage may call tools or change artifacts. Existing grants and unsettled effects remain
visible; review does not confer authority or settle effects.

Core owns stage transitions and accounting; context owns pure projection/validation; runtime owns
the opt-in; desktop only selects and displays it. The optional context port is required when the
mode is enabled. Both requests and responses are durably recorded using existing assistant entries
and renderer versions; `src/contracts/persisted` is unchanged. Evidence JSON is audit data, not a
user-facing final answer or a success score. No repair loop follows malformed claims, bad citations,
service failures, output exhaustion, cancellation or steering during review. Refusals are retained.

## Validation and exit

Offline checks must include real core/store accounting, last-investigation result delivery,
early draft isolation, invalid references/quotes, conflicting versions, failures/truncation,
source injection, opposite lifecycle/dataflow facts, refusal, cancellation, provider errors,
steering, tool denial and zero ninth request. Scripted checks and quote matches never prove model
quality. Defaults and disabled-mode behavior must remain unchanged.

After offline/package checks, freeze one new original-task candidate with the same source1838248,
question, hidden six-item rubric, Kimi CN high profile,8/300/8192 and zero retries. Flash remains
the daily default. Record separately whether observations arrived, the isolated pass formed
needed inferences, and the final answer preserved them without new mistakes. Only independent
original-rubric PASS opens the unchanged lifecycle/dataflow public tasks under their existing
8-request/120-second ceilings. Report files, not model claims, determine those results.

If the new mechanism fails, preserve its result and withdraw its product path; do not revise its
prompt and reroll this question. M4 stays unaccepted, PR47 unmerged and the daily M3 app retained.
If it passes all gates, retain it as an explicit optional configuration, then complete review,
CI and installation with backup. No public release is authorized.

## Executed outcome and withdrawal

Candidate `93b9e8e` passed139 files/2740 tests and34 offline instruction scenarios; native
settings save then revealed a missing outbound-state whitelist field before any model request.
`32545fc` fixed that integration gap and made the package settings fixture use the same
`DesktopProcess` module as the application. It passed139 files/2746 tests, actual external-bundle
verification and all three CI lanes. These checks establish engineering behavior only.

The one live trial used the original source, question, hidden rubric, Kimi CN high profile and
8-request/300-second/8192-output ceiling with zero retries. Six requests were sent. The first
five returned tool calls; the sixth produced partial user-visible text before the original
deadline interrupted it. All six used the ordinary investigation renderer. Neither isolated
evidence nor final-answer stage was reached, so no complete answer exists for six-item grading.
This is an end-to-end acceptance failure and unavailable semantic evidence for the isolation
hypothesis; it does not show that either old omission was fixed. Conditional public tasks were
not opened. No unused quota is transferred and no prompt variant is retried.

Reserving request slots alone did not ensure time for the later stages. This trial does not
separate provider latency, investigation breadth and added budget guidance as causal factors.
It is therefore insufficient to ship the option or to assert that a larger time limit would
fix quality. The experimental core/context/CLI/desktop option and its dedicated fixtures were
removed under the predeclared exit rule. The independently useful packaged-bridge validation
remains for the existing high settings, with the original six settings cases plus one boundary
case. Private request records and public commit history retain the failed candidate.

Flash3/120 settings were restored through the native UI byte for byte against the pre-trial
backup. Daily M3 remains installed; PR47 stays draft. M4's two original answer omissions remain
unresolved, so conditional merge and installation are not authorized by a passed gate.

## Narrow follow-up research

This ADR remains withdrawn. A separate direct-evidence-answer hypothesis belongs to ADR0042;
neither implementation below establishes its semantic effectiveness.

DSPy commit `39dd3e5df9ede98578e6d9d7f53d3c7ee388c6c0` (MIT) uses a separate
[`ChainOfThought` extractor](https://github.com/stanfordnlp/dspy/blob/39dd3e5df9ede98578e6d9d7f53d3c7ee388c6c0/dspy/predict/react.py#L82-L122).
Its trajectory retains earlier thoughts, tool arguments and observations: it is not an
evidence-only projection. Extraction adds a call outside `max_iters`; context overflow can retry
and discard older trajectory entries. ReAct provides no shared wall-clock deadline.
Its [representative tests](https://github.com/stanfordnlp/dspy/blob/39dd3e5df9ede98578e6d9d7f53d3c7ee388c6c0/tests/predict/test_react.py#L296-L339)
use mocked outputs to check invocation, not answer completeness.

LangGraph commit `eb8ec111b3e9d3108af5d7bdcac51e3e913637a0` (MIT) makes another
[`structured_response` call](https://github.com/langchain-ai/langgraph/blob/eb8ec111b3e9d3108af5d7bdcac51e3e913637a0/libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py#L744-L785)
with all state messages, including prior assistant output. Graph recursion limits count steps,
not HTTP attempts; its optional
[`step_timeout`](https://github.com/langchain-ai/langgraph/blob/eb8ec111b3e9d3108af5d7bdcac51e3e913637a0/libs/langgraph/langgraph/pregel/main.py#L737-L738)
limits each step, not the whole investigation and answer. The
[structured-output test](https://github.com/langchain-ai/langgraph/blob/eb8ec111b3e9d3108af5d7bdcac51e3e913637a0/libs/prebuilt/tests/test_react_agent.py#L498-L522)
uses a [fake model returning a preset value](https://github.com/langchain-ai/langgraph/blob/eb8ec111b3e9d3108af5d7bdcac51e3e913637a0/libs/prebuilt/tests/model.py#L52-L58),
so it supplies no factual-coverage evidence.

The narrower hypothesis removes the intermediate claims generation: original user input and
unaltered tool observations feed one fresh answer, without previous assistant drafts, reasoning
or a judge. That reduces generation stages but remains unproven. The withdrawn trial never
reached either later stage, so its timeout does not establish that claims caused omissions.
Any candidate must share the original request/time/output limits and demonstrate actual answer
quality before adoption. No upstream code or prompts were copied, no dependency was added, and
no upstream tests or paid model requests were run for this research.
