# ADR 0042: One direct evidence answer within the original budget

Status: a separately authorized phase-deadline revision is under validation, 2026-10-28.
The default-off experiment remains unmerged and excluded from the daily product until every
M4 gate passes. All earlier failures stay sealed; a new scheduling policy is not a semantic pass.

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

The investigation phase has an absolute deadline at one third of the original run timeout
(100 seconds for a300-second run). A completed draft or the last available request can select
one final answer earlier. At the phase deadline, core stops the investigation request and new
tool admissions. It retains interrupted output, cancels unexecuted calls and drops replay data.
Already executing tools keep the original run signal and must settle; unknown effects prevent
handoff. Pending approvals stop at the phase boundary and late replies cannot launch a tool.

Before final inference, the previous stream and optional recording sink must settle under the
original run deadline and a separate one-second cleanup cap. Failed or stuck cleanup stops the
run instead of overlapping requests. The final request contains the original question and all
actual observations, never resumes the cancelled draft and is never retried. Provider errors,
refusals, truncated output, user cancellation and the global timeout remain terminal; only the
host's investigation cutoff permits this phase transition. A phase abort cannot erase an earlier
terminal outcome, including one withheld by recording acknowledgement or transport cleanup.
Only validated late failure facts can block the handoff; late content and calls are discarded.
An already received HTTP failure is not turned into a retryable phase interruption. User cancel
still wins through the original run signal. All calls count against the original request/output/time limits.

The1/3 allocation is a fixed host scheduling policy: one final generation must process all
observations without fallback, so it receives the larger remaining window. It is not an upstream
recommended number or measured latency guarantee. Settling tools, persistence and final inference
can still exhaust the original timeout; early cutoff may leave insufficient evidence. The default
loop is unchanged, and this opt-in path disables automatic retries even if ordinary retries were
configured. No new prompt, model, output limit, final tool execution or extra budget is introduced.

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


## Independent retest result after HTTP429 diagnosis

The provider fix in `e337d64` passed140 files/2782 tests,4 Kimi runtime scenarios and the
external desktop bundle. A test-only canonical-object comparison bug in the new package probe
was corrected in `a6fd396`; all three CI lanes passed on that revision. The probe still requires
full-value input preservation and now also checks persisted request blobs. No production request,
source question, renderer, model setting or original budget changed for the live trial.

The one authorized original-task retest used6 requests, no retry, and32 read-only
observations (31 succeeded, one failed). No429 occurred. Requests1–4 completed tool use; request5 produced an investigation
draft. Request5 began at127.178 seconds (before the150-second transition boundary) and lasted
147.852 seconds. The final independent answer began at275.068 seconds, leaving about24.932
seconds; it was interrupted at300.021 seconds with reasoning only, no answer text and unknown
usage. Request windows occupied296.665 seconds; other work occupied about3.356 seconds.

This demonstrates a scheduling limitation: checking half the deadline only between calls does
not reserve time when an in-flight call crosses that boundary. It does not establish service
queue versus inference time, or prove another threshold would work. The investigation draft is
not a substitute for the predeclared independent final answer. No semantic pass, public follow-up,
merge or daily installation follows; unused requests are sealed. The next repair must address
time allocation and answer construction, not add retrieval, prompt variants or quota. Flash
settings were restored byte for byte and the daily M3 app remains unchanged.


## Absolute phase deadline follow-up (2026-10-28)

The owner authorized one new independent original-task retest after offline verification, with
8 requests,300 seconds,8192 output and zero retries. Preserve the original source/question/rubric,
Kimi CN high for this opt-in trial, Flash as the daily default and every sealed failure. This
revision changes scheduling and settlement, not the evidence projection or prompts.

Targeted primary-source review informed the boundary, with no copied code or added dependency:

- [Pydantic AI](https://github.com/pydantic/pydantic-ai/blob/bc2213364ca0318f4077110bbc9c240c0ee2f7cd/pydantic_ai_slim/pydantic_ai/models/_request_timeout.py#L55-L96),
  MIT, commit `bc2213364ca0318f4077110bbc9c240c0ee2f7cd`: an absolute request deadline covers
  opening and streamed reads; each chunk does not refresh it. Its
  [tests](https://github.com/pydantic/pydantic-ai/blob/bc2213364ca0318f4077110bbc9c240c0ee2f7cd/tests/test_request_timeout.py#L118-L204)
  distinguish timeout/cancellation and interrupted output. It does not reserve final-answer time.
- [LangGraph](https://github.com/langchain-ai/langgraph/blob/eb8ec111b3e9d3108af5d7bdcac51e3e913637a0/libs/langgraph/langgraph/pregel/_retry.py#L418-L518),
  MIT, commit `eb8ec111b3e9d3108af5d7bdcac51e3e913637a0`: the watchdog closes the write scope
  before cancellation; [late-write tests](https://github.com/langchain-ai/langgraph/blob/eb8ec111b3e9d3108af5d7bdcac51e3e913637a0/libs/langgraph/tests/test_retry.py#L1091-L1200)
  illustrate rejecting late results. Framework cancellation cannot undo external effects, hence
  moyyi waits for already started tools rather than treating them as safely rolled back.
- [AutoGen](https://github.com/microsoft/autogen/blob/004749e6b7102c8fd317b9b1499ce5807223c278/python/packages/autogen-agentchat/tests/test_termination_condition.py#L281-L298),
  code MIT, commit `004749e6b7102c8fd317b9b1499ce5807223c278`: elapsed-time termination is
  checked on invocation after replies. It retains the boundary-only gap observed here, so it is
  not adopted as the deadline mechanism. No upstream tests were run locally.

Offline and new live results are recorded in the existing [M4 receipt](../tasks/2026-10-28-desktop-m4.md).
A passing synthetic timing trace establishes scheduling behavior, not answer correctness. Only
the independent final answer is graded; earlier drafts cannot substitute for it.
