# Same-model harness comparison protocol

Phase 3 defines the measurement protocol; paid/real-model runs are not authorized in this turn.
The shell conformance suite is not a harness-quality comparison. No scores, cost savings or
latency advantages are inferred from it.

For moyyi and each selected released baseline (initial candidates: Codex, OpenCode, Goose),
record the exact harness commit, local patch, provider API, exact model identifier and date,
sampling parameters, system/tool configuration, context limit, retry policy, request/token/time
budget, sandbox policy and toolchain image/OS. DeepSeek is the first selected provider; if a
baseline cannot use the same API/model, report it as unsupported rather than compare different
models under the same label. Never weaken a sandbox just to increase its pass rate.

Use the existing public 30-task corpus, preserve checkers and fixtures, and separate tasks that
need capabilities not yet delivered. Run each task from an independent clean fixture and session;
pass only instruction/history/allowed workspace contents, never hidden checks, reference solutions
or task IDs in visible paths. Keep identical trial counts, ordering/seed policy and budgets. Run
baseline adapters under the same outer protection, with no real credentials in workspace data.
Do not load the owner's private corpus without separate authorization.

Report each task/trial's final-state check, forbidden effects, claimed success, false success,
timeout/error/refusal and unsupported capability separately. Aggregate pass@1 and pass^k using
the existing definitions, alongside model requests, input/output tokens, cache usage (unknown
when absent), billed cost when actually observed, and wall time. Retain sanitized configuration
and raw trial records to reproduce failures; never substitute a final assistant claim for checks.
Do not present omitted tasks as passed, zero missing usage, or unsupported cases as model failures.

Reference evaluation structures were reviewed in the [upstream comparison](phase-3-execution-backends.md).
Actual baseline adapters and live runs remain unexecuted. Their acceptance requires explicit model
access/budget and verifying each selected baseline's compatible API at that time. Current offline
reports describe conformance only; they do not establish that moyyi is better at solving tasks.
