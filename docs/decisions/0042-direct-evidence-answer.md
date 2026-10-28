# ADR 0042: One direct evidence answer within the original budget

Status: one independent retest authorized after HTTP429 diagnosis, 2026-10-28.
The previous provider-blocked trial remains sealed and excluded from delivery. The default-off
implementation is unchanged; it is not installed in the daily product and has no live semantic
acceptance. This authorization does not reopen the earlier allowance.

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

## Executed result

Candidate `2dd9216` passed139 files/2746 tests,34 offline instruction scenarios, the actual
external-package verification and all three CI lanes. Packaged settings coverage retains the
original seven cases and adds an eighth save/restart case for this option. These are engineering
checks, not semantic acceptance. The native settings round trip selected high/8/300 explicitly.

The one fixed original-task trial sent three requests with no retries. The first two completed
tool-use turns; the third returned HTTP429 without answer content, about62.2 seconds after run
start. No independent-answer request occurred. The original six requirements therefore have
no complete new answer to grade; the earlier two omissions remain unresolved. No conditional
public task was opened and the unused allowance was sealed, not transferred.

The adapter retained only the HTTP status, not the provider's error subtype. The account page
showed available balance and limits above this trial's own traffic, but shared-account traffic
and engine availability were not established. Neither account throttling nor engine overload
is asserted as the precise cause. A status-only failure cannot settle the semantic hypothesis.

The candidate is excluded from M4 delivery under the exit rule. Its fixed source/package and
sealed failure remain reviewable; retaining that unmerged artifact does not accept the option,
authorize another trial or waive any M4 gate. Daily Flash settings were restored byte for byte,
and the existing M3 installation remains the owner app. No public release or merge occurred.

## Independently authorized HTTP429 follow-up

The owner explicitly authorized diagnosing the HTTP429 handling and then one new original-task
trial. Preserve the exact question/source/six-item rubric, Kimi CN high,8 total requests,300 seconds,
8192 output and zero automatic retries. The answer construction and model prompts are unchanged.
The [provider follow-up](0036-kimi-chat-provider.md#http429-diagnosis-follow-up-2026-10-28)
adds bounded error classification, not a claim to control upstream capacity. Freeze new evidence
before sending; keep all old failures. Flash stays the daily default. Only all M4 gates passing
permits merge and installation; public publication remains unauthorized.
