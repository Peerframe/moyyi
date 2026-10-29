# Evaluation rules

Formats and suites are described in [README.md](README.md); adding a task follows
[the recipe](../docs/recipes/add-an-eval-task.md).

## Offline and live

- `npm run eval:<suite>` and the null-agent `npm run eval` are offline. They prove wiring and
  conformance, never model quality.
- A live run (`--source live --allow-live`) sends paid requests. Follow the
  [moyyi-live-eval](../.agents/skills/moyyi-live-eval/SKILL.md) skill: freeze the tasks, model
  configuration, request and time limits and budget before the first request.
- Credentials stay in a host module outside the repository. Never put keys in source, arguments,
  fixtures or results.

## Integrity

- Never change a task's instruction, fixture, checker or budget to make a run pass. A changed
  task is a new task with a new ID.
- The agent never sees task IDs, checkers, reference answers or expected outcomes.
- Zero retries. Do not rerun the same task until it passes; a provider error such as HTTP 429 is
  recorded as unavailable, not as a pass or failure.
- Sealed trials and their scores are never rescored or reused.
- Report a task result separately from claims the model made about it; a model saying it finished
  is not evidence.

## Results and privacy

- `evals/results/` and `evals/private/` are ignored by git. Committed records may contain public
  fixtures and aggregate numbers only, never personal data or private transcripts.
- Dated live results go to the delivery record in `docs/tasks/`, with commit, configuration,
  request count and checker output.
