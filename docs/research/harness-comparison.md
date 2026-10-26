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

## OpenCode Responses continuation precheck, 2026-10-27

A distinct route used the released OpenCode v1.19.4 macOS arm64 binary. The Git tag resolves to
`148842ef7cb1bc34192b3fff57d0f9721ab9c801`; the release metadata separately names target commitish
`c0c7bae726798d02592f8d3305891ba2f0cd880a`, which is not treated as the tag identity. The downloaded
release ZIP matches GitHub's published SHA256
`c400a2f8c8ab7e99478a7f4dd1a466b57bf33888e520d85c55780a5464c4b689`.

The executable ran under the existing readonly native sandbox, with a temporary workspace,
private empty configuration/state/cache and only a fixed loopback synthetic Responses endpoint.
No global installation, owner configuration, real credential or provider request was used.
The custom OpenAI Responses route sent `deepseek-flash`, `reasoning.effort:low`,
`max_output_tokens:8192`, `store:false`, and only glob/grep/read tools. Titles, default plugins,
automatic compaction, external Skills, snapshots and update/model fetching were disabled.

Two preplanned offline conditions set `OPENCODE_EXPERIMENTAL_NATIVE_LLM=false` and `true`,
each with DeepSeek-shaped plaintext reasoning, a real read tool call, and a second response.
The saved requests prove the configuration and wire behavior; runtime-selection logs were not
retained, so actual native selection versus SDK fallback is not independently established.
Both exited zero after two local synthetic requests and delivered the exact file text to the
second request. **Neither retransmitted the reasoning content.** A normal exit and successful
read are therefore insufficient for this profile's continuation requirement. The
[DeepSeek contract](https://api-docs.deepseek.com/guides/responses_api/) uses plaintext reasoning
content, and its [thinking guide](https://api-docs.deepseek.com/guides/thinking_mode/) requires
reasoning preservation during tool continuation. The fixed
[native protocol code](https://github.com/anomalyco/opencode/blob/148842ef7cb1bc34192b3fff57d0f9721ab9c801/packages/llm/src/protocols/openai-responses.ts#L446)
contains a plaintext-filtering branch for `store:false`, consistent with this compatibility risk;
the probe does not prove which implementation branch produced each result.

Stop this stock baseline route as unsupported under the required profile. Do not pay for an
invalid comparison, substitute Chat/nonthinking mode, or repair the response in a proxy and
label it stock OpenCode. No model-quality conclusion follows. Error/retry gate and full negative
containment acceptance were not completed because the necessary continuation check failed first.
The private probe, raw synthetic requests, source references and hashes are retained under
`~/.moyyi/acceptance/opencode-control-2026-10-27/`; real requests and credential reads are both zero.


## Linux Codex route decision, 2026-10-27

A later source check considered Linux to avoid the macOS managed-preference startup failure.
In the reviewed release `rust-v0.164.0` / `6aaac694803004a63c6f393d153c96d22521a6b9`,
[managed requirements loading](https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/config/src/loader/managed_requirements.rs#L82-L98)
does not use the macOS loader on Linux. This is a different platform route, not a policy-bypass
switch. However, its
[Responses request type](https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/codex-api/src/common.rs#L279-L304)
and request construction do not expose `max_output_tokens`. The strict configuration also lacks
that setting. Thus a gate that only counts, validates and forwards requests cannot supply the
fixed 8,192-token output ceiling. Linux alone does not establish a matching stock configuration.

The source can serialize plaintext `reasoning_text`; that is not a live continuation test.
No Linux binary was prepared or model request sent after the output-limit gap was established.
The local Docker context existed, but the daemon's bounded five-second `_ping` returned no bytes;
only the coordinator's hung `docker info` client was stopped. Docker and other workloads were
not restarted. This environment observation is separate from the source-level profile gap.

A future explicit adapter that injects an output ceiling or patches the client must disclose
that change under this protocol and prove the resulting request/continuation/containment behavior.
It must not be labeled stock Codex. Such an adapter remains a possible bounded experiment, not
an implemented comparator or a reason to delay the installed product's daily-task acceptance.


## DSH preview source check, 2026-10-27

DeepSeek's official documentation links its new harness preview. The reviewed prerelease is
[`@deepseek-ai/dsh@0.2.1-rc.3`](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.2.1-rc.3),
commit `1f81c047fc48fa190a683e469daa699857e9afe8`, released 2026-10-23 under MIT. A release
coordinate does not establish maturity or baseline compatibility.

Its [native DeepSeek adapter](https://github.com/deepseek-ai/deepseek-harness/blob/1f81c047fc48fa190a683e469daa699857e9afe8/packages/llm/llm-deepseek/README.md#L83-L115)
uses Anthropic Messages. Flash, low effort and an output cap are available, but
[configuration rejects a protocol override](https://github.com/deepseek-ai/deepseek-harness/blob/1f81c047fc48fa190a683e469daa699857e9afe8/packages/llm/llm-deepseek/src/config.ts#L225-L228).
The optional [pi-ai custom Responses route](https://github.com/deepseek-ai/deepseek-harness/blob/1f81c047fc48fa190a683e469daa699857e9afe8/docs/user/guide/providers.md#L27-L33)
is a distinct route; no actual DeepSeek plaintext-reasoning continuation trace was obtained here.
Its [headless entry](https://github.com/deepseek-ai/deepseek-harness/blob/1f81c047fc48fa190a683e469daa699857e9afe8/packages/bundle/headless/README.md#L42-L55)
and [agent-loop configuration](https://github.com/deepseek-ai/deepseek-harness/blob/1f81c047fc48fa190a683e469daa699857e9afe8/packages/core/agent-loop/README.md#L46-L61)
do not establish a total-request cap; [retries default to five](https://github.com/deepseek-ai/deepseek-harness/blob/1f81c047fc48fa190a683e469daa699857e9afe8/packages/llm/llm-retry/README.md#L50).

Independent `DSH_HOME` and a Node headless entry make a later bounded offline probe possible,
but startup containment, zero-retry operation, auxiliary-request accounting and matching
Responses continuation remain unverified. This source check installed nothing, read no real
credential and sent no model request. It is not a successful or failed quality comparison and
adds no framework or dependency to moyyi. If pursued, label the custom Responses route and
external gate explicitly instead of calling the native Messages route protocol-equivalent.
