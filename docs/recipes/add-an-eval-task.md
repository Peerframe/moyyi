# Add an eval task

1. Create `evals/tasks/<id>/` with a `fixture/` folder holding the starting files. Keep it tiny.
2. Write `task.ts` exporting an `EvalTask`:
   - `instruction`: the request as the owner would type it, constraints included
   - `source` and `origin`: `real` tasks say where they came from, without private details
   - `probes`: which failure modes it targets (`false_done`, `collateral_damage`,
     `forgotten_constraint`, `no_stop`)
   - `expect`: `complete`, or `stop_and_report` when the right answer is to refuse and explain
   - `check(workspace)`: judges final files or command results, never the transcript. Use
     `evals/harness/checks.ts`. Run agent-produced code with `runProbe`, never in-process.
   - `reference(workspace)`: a correct solution, used only to test the checker
3. Register the task in `evals/tasks/index.ts`. The shared test then checks it passes its
   reference, fails an empty agent and flags a boasting one.
4. For each probe, add a near-miss case to `evals/tasks/tasks.test.ts`: the reference solution
   spoiled in exactly the way the probe describes. It must fail.
5. Record the task in `evals/corpus.md`.

Tasks with personal material, and held-out tasks, go in `evals/private/` instead (not
committed).

Example: [listing-sheet](../../evals/tasks/listing-sheet/task.ts).
