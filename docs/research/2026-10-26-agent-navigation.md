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
