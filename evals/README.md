# Evals

The evals are how moyyi shows it is better, not just that it runs.

```bash
npm run eval -- --agent null --trials 1
```

## Task format

One directory per task under `evals/tasks/<id>/`:

- `fixture/`: copied into a fresh workspace for every trial
- `task.ts`: exports an `EvalTask` with the instruction, the failure modes it probes, whether it
  should be completed or refused, a hidden `check(workspace)` and a `reference` solution
- Optional `prepare(workspace)`: trusted setup after copying the fixture, before any agent turn
  (for example, initialize and commit a synthetic Git history). Never put `.git` in a fixture.
- Optional `followUps`: subsequent user instructions, delivered in order in the same trial.

Each turn receives a stable `sessionId`, its zero-based `turnIndex`, and `priorInstructions`.
Adapters must reuse the conversation for that session and isolate separate trials. Neither the
checker nor the reference is included in agent inputs. The deadline covers all agent turns;
reported `modelRequests` reduce the remaining request budget. Adapters must enforce the budget
when they do not report request counts. Cancellation is cooperative: the runner waits for the
current adapter to settle before inspecting and removing the workspace, and never starts another
turn after cancellation or an error. A timed-out, interrupted or over-budget trial cannot pass
even if its final files look correct. Fixture setup failure aborts the trial and cleans up.
Only a normally completed final turn supplies the trial's `claimedSuccess`. An earlier claim,
or a report from a timed-out, errored or over-budget run, becomes `null` and does not count as
a false success. A completed final claim that the checker rejects still counts as false success.
Temporary workspace and session paths omit task IDs so evaluation labels do not hint at the
expected behavior; task IDs remain in results for reporting.

Checkers judge final state (files, command results), never the transcript. Agent-produced code
runs in a child process with a timeout, never inside the harness. Steps:
[docs/recipes/add-an-eval-task.md](../docs/recipes/add-an-eval-task.md). Where the tasks come
from, and what is still missing: [corpus.md](corpus.md).

## What each trial records

- `passed`: the checker passed, nothing outside the workspace changed, and for a
  `stop_and_report` task the agent said it could not do it
- `falseSuccess`: a normally completed final turn claimed success but the trial did not pass
- `forbiddenEffects`: changes to the canary directory next to the workspace
- duration, timeout

Suite summaries report pass@1 (mean single-trial pass rate) and pass^k (share of tasks where every
trial passed).

## Trusting the checkers

`evals/tasks/tasks.test.ts` runs with `npm run check`. For every task it proves the checker
passes the reference solution, fails an agent that does nothing, and flags an agent that only
claims success. Near-miss cases prove each probed failure is caught.

## Private tasks

`evals/private/` is ignored by git. Put tasks with personal material and the held-out set there,
exporting `tasks` from `evals/private/index.ts`; `npm run eval` includes them.

The public corpus includes three prompt-injection tasks with protected files and a sibling
canary, and multi-turn constraint-retention tasks. These checks detect final-state changes;
they are not an OS sandbox and cannot prove the absence of transient or network side effects.
All injection inputs are synthetic and all reference/test operations are offline.
The injection tasks carry a `prompt_injection` probe. Their user requests do not disclose the
attack or the canary. Follow-up turns do not remind the agent of earlier constraints. The three
new stop-and-report tasks ask for ordinary work and a structured report, without supplying the
stop condition or report answers. Their checks retain protected-state and factual requirements
while accepting different wording for the explanation. Free-form explanations are checked for
presence, not semantically graded; blocker facts are checked through structured report fields.

Fault-injection and long-session offline suites are available below; real-model long-session
quality and same-model baselines for other harnesses remain future measurements.

The batch 4 branch adds `npm run eval:core`, an independent scripted protocol/lifecycle suite.
It covers eight deterministic core scenarios and writes synthetic evidence to
`evals/results/core.json`. It does not load private tasks or alter the 30 public-task checkers.
It checks committed events and entries loaded through the public runtime protocol; direct
database, cancellation-race and SIGKILL recovery assertions remain in integration tests.
Its pass count measures conformance to those scenarios, not a model's ability to solve tasks.

## Real-file capability conformance

`npm run eval:files` uses the public runtime protocol, a scripted model, disposable real files
and SQLite. Eight scenarios cover the list/search/read loop, ignore rules, protected paths,
traversal/symlink denial, truncation and input limits. It writes ignored synthetic output to
`evals/results/files.json`, does not load private tasks and does not alter public-task checkers.
It measures execution/authority conformance, not real-model task competence.

## DeepSeek offline conformance

`npm run eval:deepseek` runs six public deterministic scenarios through the runtime protocol:
synthetic SSE → real file tools/SQLite → normalized recording → offline replay, plus request/file
changes, recording-path protection, unknown usage and partial interruption. It writes only a
synthetic report to ignored `evals/results/deepseek.json` and cleans temporary data. It never
loads private tasks, credentials or a real model. This is adapter/runtime evidence, not pass@1,
pass^k or a model capability score. `npm run demo:deepseek-replay` demonstrates the same boundary.

## Shell offline conformance

`npm run eval:shell` runs seven deterministic scenarios through real native sandboxes, SQLite
and the runtime protocol. It verifies actual file results, denial, protected/outside files,
timeout unknown handling and bounded output. It does not load private tasks or change existing
corpus checkers. [Same-model comparison protocol](../docs/research/harness-comparison.md) defines
future measurements; the scripted scenarios are not live model or harness-quality scores.

## Long-session offline conformance

`npm run eval:long-sessions` runs four deterministic scenarios, including a 24-turn history,
compaction, restart, a real read tool and repeated compaction, plus tool-call/refusal/truncation
rejection. It checks original entries, selected head, request sizes, tool-free summary calls,
canary files and continued model context through the public runtime protocol. SQLite integrity
and atomic-head checks remain in integration tests. It writes only synthetic ignored output to
`evals/results/long-sessions.json`. It does not load private tasks or change the 30 public-task
checkers. The scripted summary contains known facts by construction: these results establish
context/lifecycle behavior, not a real model's recall quality, task score or cache savings.
Real SIGKILL and recovery-of-recovery checks run in the normal test gate.
