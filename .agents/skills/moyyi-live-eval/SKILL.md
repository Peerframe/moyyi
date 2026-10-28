---
name: moyyi-live-eval
description: Run paid live moyyi evaluations (quality gate, baseline or a frozen comparison) with a frozen envelope, zero retries and honest recording. Use whenever a run sends real model requests; not for offline eval suites.
---

# moyyi-live-eval

## Before the first request

1. Confirm the owner's authorization covers this run. Routine quality-gate runs use the existing
   "necessary paid validation" authorization; anything else needs an explicit yes.
2. Freeze and write down: task IDs, commit, model and provider configuration (default Flash,
   Responses, low reasoning, 8192 output), capability profile, per-task request and time limits,
   total request ceiling and estimated cost.
3. Use the owner's private host module outside the repository for credentials. Never read, print
   or copy a key.
4. Run the offline checks first so a wiring error does not consume paid requests.

## Running

```bash
npm run eval -- --agent moyyi --host <private host module> --source live --allow-live \
  --capabilities write --task <task ID> --max-model-requests <task limit>
```

- One run per task. Zero retries.
- HTTP 429 or another provider-side failure is **unavailable**: record it; at most one repeat
  within the frozen budget.
- Do not change the task, prompt, limits or capabilities between tasks of one frozen run.
- Do not rerun a task because it failed. A failed result is evidence.

## Judging

- The checker's verdict is the result. A model's claim of success is not.
- When a task that passed at baseline fails on a candidate, rerun only that task once on the
  baseline commit with the same configuration: if it also fails there, it is model variance;
  if it passes, it is a regression to diagnose.

## Recording

Add to the delivery record in `docs/tasks/`: date, commit, configuration, per-task result,
request count, provider usage if reported, and the cost estimate. Keep transcripts and results
with personal data out of git. Carry the budget ledger in the handoff file
([moyyi-handoff](../moyyi-handoff/SKILL.md)) so an agent switch never spends it twice.
