# Upstream navigation and the whole task loop

Research date: 2026-10-26. Decision scope: why bounded source investigations still fail, and what
to change before another paid retest. Product direction and next delivery live in the
[system overview](../system-overview.md). No upstream runtime was installed, no upstream test
suite was executed, and no model was called during this research. Source inspection, local
deterministic probes and real-model behavior are separate evidence classes.

## Reviewed sources

| Project | Pinned source | License and scope |
|---|---|---|
| Codex | [`970111f6cb62cc02fe36a82ea7d71b37a2889c97`](https://github.com/openai/codex/tree/970111f6cb62cc02fe36a82ea7d71b37a2889c97) | Apache-2.0; reviewed main commit, not asserted to be a release |
| OpenCode | [Source snapshot `c0c7bae726798d02592f8d3305891ba2f0cd880a`](https://github.com/anomalyco/opencode/tree/c0c7bae726798d02592f8d3305891ba2f0cd880a) | MIT; inspect both core and legacy tool paths rather than assume they are equivalent |
| Aider | [`5dc9490bb35f9729ef2c95d00a19ccd30c26339c`](https://github.com/Aider-AI/aider/tree/5dc9490bb35f9729ef2c95d00a19ccd30c26339c) | Apache-2.0; tree-sitter query sources have their own notices |
| SWE-agent | [`3ea751c087f32b16e039a2233dd6eefecef325d5`](https://github.com/SWE-agent/SWE-agent/tree/3ea751c087f32b16e039a2233dd6eefecef325d5) | MIT; ACI source and representative tests |
| mini-SWE-agent | [`04d809ceab9df28f9adaed044884180159172930`](https://github.com/SWE-agent/mini-swe-agent/tree/04d809ceab9df28f9adaed044884180159172930) | MIT; loop, limits and completion mechanism |

These are reviewed versions, not new moyyi dependencies. No upstream source or prompt was copied
or substantially adapted into the product. Private review copies retain their licenses.

Version-coordinate correction (2026-10-27): this record originally associated snapshot
`c0c7bae726798d02592f8d3305891ba2f0cd880a` with `v1.19.4`. The
[official tag](https://api.github.com/repos/anomalyco/opencode/git/ref/tags/v1.19.4) resolves to
`148842ef7cb1bc34192b3fff57d0f9721ab9c801`. Original source links remain unchanged to preserve
the inspected snapshot. This corrects release attribution only; it does not establish identical
behavior across the two commits or add execution evidence.

## Concrete mechanisms and their limits

**Codex exposes mature command primitives.** Its public
[prompt](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/models-manager/prompt.md#L260-L265)
prefers `rg`; the [command schema](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/core/src/tools/handlers/shell_spec.rs#L32-L59)
allows file scopes, globs and multiple query patterns through commands. Its
[output budgeting](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/core/src/tools/context.rs#L525-L618)
accounts for wrapping and truncation, with [tests](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/core/src/tools/context_tests.rs#L463-L500).
This does not require moyyi to give a read-only task shell authority. Borrow the useful interface
semantics through its existing guarded file capability. Codex's
[plan handler](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/core/src/tools/handlers/plan.rs#L93-L109)
does not verify source facts merely because a model marks a step complete.

**OpenCode separates selection, observations and repairable errors.** Its
[core grep](https://github.com/anomalyco/opencode/blob/c0c7bae726798d02592f8d3305891ba2f0cd880a/packages/core/src/tool/grep.ts#L94-L104)
passes an exact file basename to [ripgrep](https://github.com/anomalyco/opencode/blob/c0c7bae726798d02592f8d3305891ba2f0cd880a/packages/core/src/ripgrep.ts#L218-L230),
with glob selection and concise file/line output. The
[invalid-argument error](https://github.com/anomalyco/opencode/blob/c0c7bae726798d02592f8d3305891ba2f0cd880a/packages/opencode/src/tool/tool.ts#L18-L33)
includes validation details; [truncated output](https://github.com/anomalyco/opencode/blob/c0c7bae726798d02592f8d3305891ba2f0cd880a/packages/opencode/src/tool/truncate.ts#L124-L140)
provides a way to continue reading. Its [LSP tool](https://github.com/anomalyco/opencode/blob/c0c7bae726798d02592f8d3305891ba2f0cd880a/packages/opencode/src/tool/lsp.ts)
can request definitions/references/call hierarchy, but needs a language server and does not prove
behavior. Caution: this inspected snapshot's [legacy grep](https://github.com/anomalyco/opencode/blob/c0c7bae726798d02592f8d3305891ba2f0cd880a/packages/opencode/src/tool/grep.ts#L60-L68)
uses the parent directory without the exact-file argument. Its
[single-file test](https://github.com/anomalyco/opencode/blob/c0c7bae726798d02592f8d3305891ba2f0cd880a/packages/opencode/test/tool/grep.test.ts#L171)
does not include a matching sibling. This inspection is a reason to test scope semantics ourselves,
not to copy a popular repository blindly. No upstream issue was filed.

**Aider's repository map is navigation, not a truth graph.**
[Definition/reference extraction and ranking](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/repomap.py#L279)
use tree-sitter, identifier relationships and PageRank, with lexical fallbacks. Same-name edges
are not exact runtime calls. [Map cache tests](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/tests/basic/test_repomap.py#L49)
allow old maps until refresh in some modes. A future moyyi navigation index must identify its
snapshot and re-read current bodies before treating them as evidence. Do not add a whole-language
index stack before measuring whether basic file selection is still the limiting step.

**SWE-agent studied the tool interface as a whole.**
[Directory search](https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/tools/search/bin/search_dir)
summarizes files/counts; [windowed reads](https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/tools/windowed/lib/windowed_file.py#L145)
show lines and omissions, with [output tests](https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/tests/tools/test_default_utils.py#L114).
Its [ACI experiments](https://arxiv.org/html/2405.15793v3#S5.SS1) support testing tool design together
with the model; their older model/bug-fixing results are not Flash source-question scores.

**mini-SWE-agent keeps execution and correctness separate.** Its
[loop](https://github.com/SWE-agent/mini-swe-agent/blob/04d809ceab9df28f9adaed044884180159172930/src/minisweagent/agents/default.py#L97)
records actions, observations and limits. [Submission](https://github.com/SWE-agent/mini-swe-agent/blob/04d809ceab9df28f9adaed044884180159172930/src/minisweagent/environments/local.py#L45)
is a completion signal, not independent proof of a correct patch. We should preserve moyyi's
small core, strict authority and pre-send request accounting rather than import a new harness.

Anthropic's official [tool-design guidance](https://www.anthropic.com/research/writing-tools-for-agents)
also emphasizes useful returned context, explicit selection and actionable errors. Its
[eval guidance](https://www.anthropic.com/research/demystifying-evals-for-ai-agents) distinguishes
the recorded trajectory, actual outcome and grader. These reinforce measuring complete tasks;
neither source establishes a universal automatic fact checker.

## Deterministic probes run in this research

The reviewed moyyi product tree is PR #25 head `650a00b`; the command primitive is local ripgrep
15.2.0 (`e89fff89ac`). Synthetic files and temporary copies only; zero model requests. This is an
interface comparison, **not** a full upstream-agent benchmark. Original project criteria are unchanged.

| Probe | Observed moyyi behavior | Observed command primitive |
|---|---|---|
| Exact file search | `Search requires a directory` | `rg -n -F publishRecord src/entry.ts` returns the requested implementation. |
| Explicit file filter | 31 hits, 30 in a test file; include/exclude fields rejected | `-g '*.ts' -g '!*.test.ts'` returns the one implementation hit. Tests remain available when requested. |
| Invalid context value | `contextLines:25` yields only `Tool arguments do not match the schema` | The actionable product requirement is to identify the field and allowed range without exposing arbitrary input. |
| Discover files first | 31 repeated content hits from two files; no files-only mode | `rg -l -F publishRecord src` returns two paths. |

Additional command probes on fixed source `1838248` found the known implementation in an exact file,
and three literal patterns returned five plugin/core/context hits in 537 bytes. This is human-chosen
navigation, not evidence that a model would choose those queries. A 25-line context window still
did not establish a complete function. Missing files and no matches have distinct command exits.
Private reproducible scripts/results are retained by the owner; no task answer or private session
was added to product prompts or source.

## Recommendation and rejected shortcuts

Deliver a consistent file-navigation interface, safe actionable errors and whole-task measurements
together. Prefer explicit file-pattern selection to silently hiding tests, and explicit bounded
output modes to indiscriminately returning more context. Keep read confinement and hard total limits.
Whether presentation requests above a cap should be normalized or rejected is an ordinary API design
choice; either way report the effective scope precisely. Never normalize authority or path escape.

Keep Flash + Responses + low for the current investigation. No evidence here authorizes a model
switch, new paid calls or an SDK dependency. The exhausted grant is not reusable. LSP/repository maps
are later options if direct navigation measurements show the need. An evidence checklist or second
agent cannot certify its own truth, and an extra reviewer must not silently increase the request cap.
The next milestone and per-layer decision rules are in the system overview, so this research does
not become another disconnected list of possible improvements.


## Original task boundary audit, 2026-10-27

A later inspection used the sealed autonomous Flash trace over source `1838248`, rather than
inferring a missing tool from the final answer. Request three searched `readEnabled` under `src`
with `contextLines:6` and `maxMatches:20`. All16 hits and12 windows reached request four exactly;
6,580 bytes of source context, `truncated:false`, `skippedFiles:0`. Eleven hits were in tests, but
they did not displace other matches. The `instructions.ts` windows were99–111 and160–172; the
actual definition spans105–149. Calculating the existing20-line windows still omits126–145.
The lower-level reader in `files.ts:225–250` and core collection in `core/index.ts:565–592` do not
contain that search term. A larger local window cannot establish the whole call chain.

The reviewed [Pi grep](https://github.com/earendil-works/pi/blob/4a080252f06caf63a525d7873c5d94d3c23887e0/packages/coding-agent/src/core/tools/grep.ts#L195-L216)
and [context tests](https://github.com/earendil-works/pi/blob/4a080252f06caf63a525d7873c5d94d3c23887e0/packages/coding-agent/test/tools.test.ts#L876-L936)
(v1.4.0, MIT) likewise expose explicit line windows, not complete call chains. The released
[Codex0.164 handlers](https://github.com/openai/codex/blob/6aaac694803004a63c6f393d153c96d22521a6b9/codex-rs/core/src/tools/handlers/mod.rs)
(also reviewed above) support composable command execution, not an applicable standalone
indentation-block reader. [Serena symbol tools](https://github.com/oraios/serena/blob/9e1cced0c34ed48d668e179f7c56c77b4d14a3e3/src/serena/tools/symbol_tools.py#L73-L196)
and [reference tests](https://github.com/oraios/serena/blob/9e1cced0c34ed48d668e179f7c56c77b4d14a3e3/test/solidlsp/test_referencing_symbols.py#L61-L85)
at `9e1cced0c34ed48d668e179f7c56c77b4d14a3e3` provide definition bodies/references through Python
and language servers. That deployment and confinement cost is not justified by this trace. Its
[application license](https://github.com/oraios/serena/blob/9e1cced0c34ed48d668e179f7c56c77b4d14a3e3/LICENSE)
is GPL-3.0-or-later; the separate SolidLSP component is MIT. None was copied, installed or executed
for this audit. Exact-file filtering and merged guarded-snapshot windows already exist in moyyi.

The frozen user question explicitly prohibits running commands as well as writes and web access.
Enabling a read-only shell while retaining that question would be an invalid diagnostic. More
critically, the visible original question permits8 model requests, but the later4+4 regression
allocation enforced4 for this question; request four therefore prohibited further tool calls.
This is a declared budget difference, not a transport defect or proof of architectural inferiority.

The owner explicitly restored the original eight-request ceiling on2026-10-27: one fresh original
question trial, total8 requests, with the existing public-task pass reused. Source, question,
six-item rubric, Flash/Responses/low, output8192, zero retries and all original tool prohibitions
remain fixed. Preserve the earlier four-request failures. The newer installed product also
contains intervening read-budget/completion fixes, so this is current-product acceptance under
the restored original budget, not an isolated causal cap experiment. Results belong in the
existing delivery record; this audit does not justify a new parser, index or search abstraction.


## Edit-result visibility, 2026-10-27

A separate trace shows that the web report's final revision reached disk and matched the recorded
write hash, while its8,700-byte body did not enter the final model request. moyyi's
`runtime/writes.ts` already performs a guarded post-publication read and checks hash/mode before
returning success; `post.version.text` is then discarded from the returned receipt.

Cline's [editor executor](https://github.com/cline/cline/blob/c35b729049c7bb26c340df63ea9235c40b32dd29/sdk/packages/core/src/extensions/tools/executors/editor.ts#L162-L191)
at `c35b729049c7bb26c340df63ea9235c40b32dd29` (Apache-2.0) returns a bounded diff from its in-memory
updated text, without a post-write disk read. Its [wrapper](https://github.com/cline/cline/blob/c35b729049c7bb26c340df63ea9235c40b32dd29/apps/vscode/src/sdk/sdk-diff-edit-coordinator.ts#L118-L140)
does not add model-visible readback. Aider's [next-request assembly](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_coder.py#L598-L657)
and [text read](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/io.py#L453-L476)
(earlier pinned Apache-2.0 source) reload selected files, but do not bind those decoded strings to
the edit's verified hash; Python text decoding can normalize line endings. Neither is proof of
byte-exact postcondition observation. No upstream code was copied or upstream tests executed.

A possible narrow enhancement is to expose moyyi's existing verified postcheck text under the
existing result budget and afterHash, preserving the original receipt fields. Disclosure would
need an independent read-policy check: write authorization alone does not authorize returning a
file body. Denied/approval-required reads should leave a successful write receipt without body;
post-publication verification failure remains unknown. This is a design candidate, not an
implemented capability or a substitute for fact checking, ordinary reads after later changes,
or the old web task's missing readback evidence.

## Answer coverage after evidence delivery, 2026-10-27

PR #40's independent Kimi comparison retained the original source/question/rubric and confirmed
exact delivery of all32 tool observations (98 historical appearances). The remaining lifecycle
and indirect-content boundaries were already present in the evidence. Four requirements met and
two remained partial, as in the earlier Flash trial. Those two requirements extend the visible
question's explicit enumeration; preserve the original strict FAIL without assuming every rubric
omission is a new runtime defect. The observed failure is answer coverage, not a lost reader result.

The owner requested a fix. Rechecking [ADR 0022](../decisions/0022-evidence-guidance-and-focused-reads.md)
rejects simply adding another generic completeness sentence: a candidate with question coverage,
conditions and lifecycle scope already failed and was withdrawn. Current guidance also contains
claim/evidence mapping and final checks. The following primary sources were inspected afresh:

| Maintained source | What it actually provides | Relevant limitation |
|---|---|---|
| [Codex `2cab11ca40aad193382348a7bda46da2fc47596a`](https://github.com/openai/codex/blob/2cab11ca40aad193382348a7bda46da2fc47596a/codex-rs/core/src/tools/handlers/plan.rs), Apache-2.0 | Model-authored plan states and visible progress | The handler publishes state; it does not independently check conclusions or omitted requirements. |
| [OpenCode `5f8ee0f5074f99a8b5d5cafb94126f879a274b50`](https://github.com/anomalyco/opencode/blob/5f8ee0f5074f99a8b5d5cafb94126f879a274b50/packages/core/src/tool/plugin/todo.ts), MIT | Todo state/counts and model-specific working guidance | [Tests](https://github.com/anomalyco/opencode/blob/5f8ee0f5074f99a8b5d5cafb94126f879a274b50/packages/core/test/tool-todo.test.ts) exercise the tool contract, not factual answer completeness. |
| [OpenHands SDK `d0d9d81324210414462fb676b377e0563a08a0cb`](https://github.com/OpenHands/software-agent-sdk/blob/d0d9d81324210414462fb676b377e0563a08a0cb/openhands-sdk/openhands/sdk/conversation/goal/judge.py), MIT | A separate model call assesses goal completion against the conversation | This consumes a request and remains a model judgment. Its parser tests are not reliability evidence for moyyi. |

No upstream prompt/source was copied, no dependency was added, and no upstream test suite was
executed. These sources support distinguishing task tracking, same-pass guidance and an actual
second-stage review; none certifies that an answer is correct.

Before changing the product, freeze one separate draft-revision diagnostic: the original Flash
final request's complete evidence/history plus its exact old completed answer, followed by an
original general review request. Do not send the rubric, expected facts or specific omissions.
Use Flash/Responses/low, one request, no tools, zero retry and the original output ceiling. Preserve
old scores and ledgers. This diagnoses whether a second stage can improve a fixed draft; it is
not an autonomous original-task pass or a ninth request added to the old trial. If it fails, do
not ship a review mechanism or repeat the same probe until green. If it improves, independently
check regressions and test the cost of reserving that stage inside the original task's eight
requests before claiming product improvement. No core/provider change is justified in advance.


The single continuation diagnostic is sealed: one HTTP200, zero retries/tools,52.347 seconds.
The raw Responses terminal is `incomplete/max_output_tokens`; all8,192 output tokens are reported
as reasoning and no answer text was emitted. Input was35,278 tokens (31,232 cached). Independent
raw-SSE review confirmed this was not a decoder or saving loss. No product review stage is adopted
from this result, and the original Flash/Kimi scores remain unchanged.

The [DeepSeek Responses schema](https://api-docs.deepseek.com/api/create-response/) makes the
output cap shared by reasoning and visible text; its reasoning control is effort, not a reserved
answer allowance. The [Anthropic compatibility table](https://api-docs.deepseek.com/guides/anthropic_api/)
explicitly ignores `thinking.budget_tokens`. The [Kimi Chat schema](https://platform.kimi.com/docs/api/chat)
and [effort guide](https://platform.kimi.com/docs/guide/use-reasoning-effort) likewise expose the
total completion limit and effort, not an independent thinking cap or guaranteed answer reserve.
Existing adapters send the documented fields. Do not infer that low was ignored, invent an
unsupported parameter, silently disable thinking, or increase the accepted output cap.

The earlier nine-observation Flash review in the delivery record also exhausted output without
an answer. A final bounded diagnostic therefore changes the tested mechanism explicitly: Kimi's
own completed draft and all32 observations are data in a fresh system/user pair, with no old
assistant reasoning or budget notices. It asks only for compact, evidence-backed defects and
corrections, not another full answer or a self-certified PASS. The reviewed OpenHands judge uses
[a fresh request](https://github.com/OpenHands/software-agent-sdk/blob/d0d9d81324210414462fb676b377e0563a08a0cb/openhands-sdk/openhands/sdk/conversation/goal/judge.py#L54-L87),
which is different from continuing an old assistant reasoning stream. No rubric, expected facts,
prior assessment or manual correction enters the diagnostic. Preserve every observation's call,
arguments, status, complete result, order, duplication and truncation markers. Freeze the exact
transformation before one Kimi/Chat/low request,8192 output,180 seconds, no tools/retries. If it
has no usable final result or identifies neither remaining material omission, close this route;
do not vary the same question until it passes. A successful defect audit would still require
separate correction and in-budget autonomous validation before any product-quality claim.


The fresh compact Kimi diagnostic is also sealed: one request, HTTP429 with
`engine_overloaded_error`,36.129 seconds, zero retries/tools, no answer or findings. Usage is
unknown, not zero. Independent comparison verified the original question/draft and all32 paired
observations against the frozen source records. This is unavailable semantic evidence, not a
finding that Kimi missed the defects or that the review mechanism works. No further request,
prompt variant, review framework or default-model change is made. Separately, the concrete
final-attempt output-limit classification defect is corrected under [ADR0034](../decisions/0034-incomplete-response-outcomes.md#correct-the-final-request-cause-2026-10-27);
that product change does not resolve or regrade the source-answer omissions.

## Form findings during investigation, 2026-10-27

A fresh audit distinguishes proposition formation from final copying loss. Both original final
answers ended normally below8,192 output tokens. Their recorded final visible reasoning had the
frozen-selection fact but did not explicitly form either complete missing proposition. Original
source observations remained in the final requests: Flash20 results/101,155 characters; Kimi32
results/243,845 characters. Exact numbered-line duplication was negligible. This suggests attention
competition and incomplete operational inference, not another lost-result or duplicate-read defect.
It does not establish either as the cause. The old six-item rubric and both strict FAILs remain.

Additional primary-source review settles the next bounded candidate:

| Pinned source and license | Relevant mechanism and limits |
|---|---|
| [LangChain1.4.7 todo middleware](https://github.com/langchain-ai/langchain/blob/575db57ab3658e38ba1d8c40c2bf62110c8a0c27/libs/langchain_v1/langchain/agents/middleware/todo.py), MIT | Structured state, with rejection of parallel whole-list updates; statuses are model assertions. Its tests check state/message handling, not factual completeness. Open issues [39945](https://github.com/langchain-ai/langchain/issues/39945) and [36624](https://github.com/langchain-ai/langchain/issues/36624) show why completed status and stored-but-unread state are insufficient. |
| [LangGraph1.2.18 join tests](https://github.com/langchain-ai/langgraph/blob/858891aaa164ebdacf33b8f5e7f88b38b9132211/libs/langgraph/tests/test_pregel.py) and [current official workflow](https://github.com/langchain-ai/docs/blob/df8e50b7a43d29baf36ea6b48c4b8eca49a226cf/src/oss/langgraph/workflows-agents.mdx), MIT | Collect component results, then synthesize them. Tests establish deterministic data flow, not whether the components are true or complete. |
| [Anthropic think-tool update](https://www.anthropic.com/research/claude-think-tool) and [cookbook](https://github.com/anthropics/claude-cookbooks/blob/bfe50e59dbb4f5546a0af9ca36ebb77e637c9ce1/managed_agents/CMA_plan_big_execute_small.ipynb), MIT cookbook | The December2025 update prefers extended thinking in most cases. The planning example also records missing premises. A free-form thinking tool or a separate strong planner is not evidence for Flash. |
| [DeepAgents default-todo removal](https://github.com/langchain-ai/deepagents/pull/4929), MIT | Maintainers report no statistically significant accuracy gain across three models and higher cost for two. Current [tests](https://github.com/langchain-ai/deepagents/blob/1f4237af32eef17581e507f914424d523fd7b296/libs/deepagents/tests/unit_tests/test_graph.py) assert no default todo. This is negative evidence against adding a generic checklist. |

No upstream source or prompt is copied, no dependency is added, and upstream tests were inspected,
not executed. The candidate instead records compact source facts, conditions, operational
consequences and limits *during* investigation. It has no completion status or truth score. The
model-declared source references are explicitly unverified; notes are fallible and cannot grant
permissions. A pure plugin returns the whole bounded record through the existing tool transcript;
there is no workspace-keyed memory, context rewrite, hidden review model or automatic continuation.
At most two successful records per run,12 findings and8KiB arguments limit its cost. The final
request remains tool-free and every note-producing request consumes the original request budget.

Selection is opt-in until evidence supports adoption. First freeze one original-task candidate:
unchanged source1838248/question/rubric, Flash/Responses/low,8 requests/300 seconds/8,192 output,
zero retries. No rubric, old answer, manual correction or omitted proposition is supplied. Compare
with the sealed original Flash baseline; intervening diagnostic fixes mean this is a product
candidate comparison, not isolated causal proof. If original completeness improves without false
facts, run the unchanged source-lifecycle-report and source-dataflow-report tasks once per current
baseline/candidate with their8-request/120-second limits. Their executable checks and dynamic-config
counterexample guard against simple overfitting; they do not establish autonomous discovery of
unasked resource boundaries. Do not rerun an arm or relax checkers. If notes fail to form the
missing propositions, reject this candidate; if formed notes are lost in final prose, the evidence
then supports examining final assembly. Record outcomes separately from implementation and offline
transport conformance before deciding whether to ship or enable it.

The candidate was implemented and tested in isolation, then **withdrawn**. Offline24 focused
checks and the full check2,577 tests passed; the real runtime retained the complete notes in the
final request and enforced permissions/final-none. Private preflight used nine synthetic requests
and no credentials/network. The single live original-task run used eight HTTP200, zero retries;
all source bytes stayed unchanged. It produced one note record and a normal answer. Neither the
notes nor the answer included the two complete missing propositions, and the answer again falsely
claimed allowed-tools was absent from model-visible text. Successful state transfer therefore did
not improve proposition formation. Do not ship this plugin, call its synthetic checks a semantic
pass, proceed to the conditional public trials, or tweak its guidance until this question passes.
The rejected implementation/build and all evidence remain in the private review archive; the
product and daily host are unchanged. Independent rubric review is recorded in the delivery log.

### Conditional complex-task configuration control

The next control changes model configuration rather than adding guidance or working-state tools.
Use Kimi K3.1 Pro `high` once with the exact isolated4e3cddb runtime used by its sealed `low`
comparison. The [official effort guide](https://platform.kimi.com/docs/guide/use-reasoning-effort)
confirms low/high/max are supported and complete reasoning/tool messages must be replayed; the
existing adapter already does both. Keep the same source/question/rubric, system and tools,
8 requests/300 seconds/8,192 output and zero retry. The credential configuration and daily Flash
host remain unchanged during this control. Only the request effort changes. The previous low arm ended normally in
six requests with remaining output capacity but close to the time ceiling; a high timeout or
truncation is a failed budget-constrained delivery, not permission to extend the trial.

This is preferable to another Flash-high/source-pack run: historical high source-supplied controls
already exhausted output without a complete answer. It does not prove high autonomous Flash would
fail, but supplies less actionable evidence than the already-connected Kimi route. Do not run both
routes or reroll either. No notes, hidden rubric, previous answer or expected facts enter Kimi's
input. All six old criteria and absence of new material factual errors are required before
implementing an optional complex-task entry and running the unchanged public lifecycle/dataflow
counterexamples. Historical comparison, nondeterminism, latency and cache differences limit causal
claims; a single pass cannot establish general reliability. The owner explicitly approved this
conditional route, preserving Flash default, request budgets and the no-public-release boundary.


The high control is sealed after its first actual request: HTTP429 `engine_overloaded_error`,
23.867 seconds, no answer/tools, unknown usage, zero retry, original source unchanged. Offline14
gates/nine synthetic requests had passed. The [official troubleshooting guide](https://platform.kimi.com/docs/guide/troubleshooting)
distinguishes this server-capacity subtype from `rate_limit_reached_error` and
`exceeded_current_quota_error`; adding credit or raising tier cannot directly remove it. Do not
change prompts, credentials, region, or retry limits to manufacture a quality result. This run
provides no semantic answer to score. The conditional optional entry and public-task arms remain
unstarted. Previous credentials-helper/configuration hashes differ from the old low run but match
this run's frozen records; the compared model inputs/runtime are unchanged. Preserve this service
failure separately from completed semantic FAILs and do not reopen its ledger.
