# ADR 0042: One direct evidence answer within the original budget

Status: experimental candidate, 2026-10-28. Default off; no live quality result yet.

## Evidence and hypothesis

The original completed M4 high answer omitted two operational implications despite receiving
their source. The later ADR0041 experiment timed out during investigation, before either of
its two additional generation stages. Both failures remain sealed. Request preparation, tool
execution and publication outside model windows occupied about3.2 seconds of the300-second
trial; repeated identical calls were absent. More retrieval or a tool cache is not a supported
repair. Deadline accounting worked, but reserving slots did not reserve answer time.

The narrow follow-up source review in [ADR0041](0041-isolated-evidence-review.md) covers fixed
DSPy and LangGraph implementations. Their separate final calls retain model thoughts/answers,
and their quotas cannot be substituted for moyyi's shared HTTP/deadline limits. No dependency,
upstream code or prompt is copied. These examples do not prove improved factual coverage.

This candidate removes the intermediate claims generation and validation stage entirely.
It tests one direct inference from original user inputs and actual tool observations, without
earlier assistant interpretations. Isolation was already a hypothesis in ADR0041; the new
difference is one answer generation and an earlier request-boundary transition. Neither is
claimed to fix the two omissions before the unchanged independent acceptance passes.

## Contract

Trusted runtime option `evidenceAnswer: true` requires at least two total requests and the
context port. It is explicit in desktop settings and defaults off. It requires a new session
with a self-contained question. Existing user history is rejected before mutation/model calls;
steering is rejected because references to an excluded assistant draft could lose their meaning.
Cancel and use a new session, or disable the option to continue ordinary history.

The existing investigation loop is retained. At a safe request boundary, a completed draft,
the last available request, or elapsed time of at least half the run limit selects one final
answer. The half-time boundary is a transparent scheduling policy, not a latency prediction:
a slow in-flight request or later generation can still exhaust the original deadline. No
request is cancelled and restarted to make room. All calls, including the final answer, share
the original request/output/time bounds. This opt-in path disables automatic retries, even if
the host's ordinary retry allowance is nonzero. No final retry or new tool execution is permitted.
Refusal, error, cancellation and truncated output do not start another answer attempt.

Context projects all original user input and paired tool calls/results, including statuses,
raw arguments, source identities and exact returned content. It retains all context sections
and unsettled effects, removes no observations and calls no summarizer. Prior assistant prose,
reasoning, replay and obsolete budget notices are not part of this fresh request. Evidence is
quoted data, not authority. Capacity failure refuses the request instead of pruning evidence.
The projection rejects compaction, multiple user turns and incomplete call/result groups.

Core owns the transition and accounting; context owns the pure projection; runtime and desktop
only configure it. Existing entries and request blobs record the draft, transition and final
answer (`moyyi-evidence-answer-v1`); persisted contracts are unchanged. Completed means protocol
completion, never a factual correctness verdict. The original transcript remains intact.

## Bounded acceptance and exit

First run offline core/context/runtime tests and instruction evals with unrelated, opposing
lifecycle/dataflow facts; verify the actual packaged bridge and original desktop gates. Then
freeze one new autonomous original-source trial with unchanged source, visible question and
hidden six-item rubric, Kimi CN high,8 requests/300 seconds/8192 output and zero retries.
Flash remains the daily default. No rubric or reference answer enters the model context.
Only an independent strict pass opens the unchanged public lifecycle/dataflow tasks.

No prompt variants or best-of reruns follow a failure. Preserve the result and withdraw the
candidate if it fails; M4 remains unaccepted and PR47 unmerged. An engineering pass alone does
not authorize daily installation. A pass of every M4 gate permits the already authorized
review, merge and backed-up installation, with no public release.
