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

Planned additions: fault-injection suites (scripted model), prompt-injection tasks, multi-turn
long-session tasks, and same-model baselines for other harnesses.
