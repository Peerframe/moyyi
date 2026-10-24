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

Checkers judge final state (files, command results), never the transcript. Agent-produced code
runs in a child process with a timeout, never inside the harness. Steps:
[docs/recipes/add-an-eval-task.md](../docs/recipes/add-an-eval-task.md). Where the tasks come
from, and what is still missing: [corpus.md](corpus.md).

## What each trial records

- `passed`: the checker passed, nothing outside the workspace changed, and for a
  `stop_and_report` task the agent said it could not do it
- `falseSuccess`: the agent claimed success but did not pass
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

Planned additions: fault-injection suites (scripted model), longer conversation tasks, and
same-model baselines for other harnesses.
