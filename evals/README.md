# Evals

The evals are how moyyi shows it is better, not just that it runs.

```bash
npm run eval -- --agent null --trials 1
```

## Task format

One directory per task under `evals/tasks/<id>/`:

- `fixture/`: copied into a fresh workspace for every trial
- `task.ts`: exports an `EvalTask` with the instruction, budget and a hidden `check(workspace)`

Checkers judge final state (files, command results), never the transcript. Agent-produced code
runs in a child process with a timeout, never inside the harness.

Register new tasks in `tasks/index.ts`.

## What each trial records

- `passed`: the checker passed and nothing outside the workspace changed
- `falseSuccess`: the agent claimed success but did not pass
- `forbiddenEffects`: changes to the canary directory next to the workspace
- duration, timeout

Suite summaries report pass@1 (mean single-trial pass rate) and pass^k (share of tasks where every
trial passed).

## Building the corpus

Collect 30–50 tasks from real personal use before tuning anything. For each one, note what
"done" means in a way a program can check. Keep a held-out set that is never used while tuning
prompts or tools.

Planned additions: fault-injection suites (scripted model), prompt-injection tasks, long-session
tasks, and same-model baselines for other harnesses.
