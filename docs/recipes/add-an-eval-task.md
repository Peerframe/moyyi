# Add an eval task

1. Create `evals/tasks/<id>/` with a `fixture/` folder holding the starting files.
2. Write `task.ts` exporting an `EvalTask`: the instruction as a user would type it, a budget,
   and `check(workspace)`.
3. The checker judges the final files or command results, never the transcript. Run any code the
   agent produced in a child process with a timeout.
4. Prove the checker both ways in a test: the null agent fails, and a hand-written correct
   solution passes.
5. Register the task in `evals/tasks/index.ts`.

Tasks that come from real personal use are worth more than invented ones. Keep a held-out set
that is never used while tuning prompts or tools.

Example: [fix-range-off-by-one](../../evals/tasks/fix-range-off-by-one/task.ts).
