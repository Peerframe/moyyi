# Same-model harness comparison protocol

Phase 3 originally defined this measurement protocol without paid-run authorization. The owner
has since authorized necessary paid product validation; current execution evidence is recorded
in the [system overview](../system-overview.md), separately from this comparison protocol.
The shell conformance suite is not a harness-quality comparison. No scores, cost savings or
latency advantages are inferred from it.

For moyyi and each selected released baseline (initial candidates: Codex, OpenCode, Goose),
record the exact harness commit, local patch, provider API, exact model identifier and date,
sampling parameters, system/tool configuration, context limit, retry policy, request/token/time
budget, sandbox policy and toolchain image/OS. DeepSeek is the first selected provider; if a
baseline cannot use the same API/model, report it as unsupported rather than compare different
models under the same label. Never weaken a sandbox just to increase its pass rate.

Use the existing public 32-task corpus, preserve checkers and fixtures, and separate tasks that
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

## Bounded feasibility check, 2026-10-27

The official [DeepSeek integration guide](https://api-docs.deepseek.com/quick_start/agent_integrations/codex/)
documents Flash through Responses with selectable reasoning effort. This establishes a supported
provider route, not equal execution limits or a quality result. Inspection of Codex
[`rust-v0.164.0`, `6aaac694803004a63c6f393d153c96d22521a6b9`](https://github.com/openai/codex/tree/6aaac694803004a63c6f393d153c96d22521a6b9)
and OpenCode
[`v1.19.4`, `148842ef7cb1bc34192b3fff57d0f9721ab9c801`](https://github.com/anomalyco/opencode/tree/148842ef7cb1bc34192b3fff57d0f9721ab9c801)
did not establish an equivalent built-in total-request cap. A future comparison needs a clearly
identified external gate that counts auxiliary requests and prevents transport/session retries;
moyyi's final-request `none` rule must not silently alter the baseline agent.

A finite offline probe used the already installed Codex **0.163.0**, not the inspected 0.164.0
release. It used a temporary private configuration, a readonly native sandbox and a fixed
loopback synthetic Responses service. Strict configuration rejected `model_max_output_tokens`;
removing that unsupported key then failed during managed-preference synchronization before any
request. The pinned
[0.163.0 loader](https://github.com/openai/codex/blob/rust-v0.163.0/codex-rs/config/src/loader/macos.rs)
terminates on that synchronization failure. Five local startup diagnostics produced zero
synthetic model requests, zero external requests and zero real credential reads. No global Codex
configuration, binary or managed-policy bypass was changed. Processes and temporary workspaces
were cleaned up; original failures were retained privately.

This route stopped at the startup boundary. No paid comparison, upstream quality score or
claim that moyyi performs better follows from it. It does not justify expanding the sandbox
or building a new harness before a usable, comparable entry is established. The private evidence
coordinate is `~/.moyyi/acceptance/harness-comparison-2026-10-27/`.
