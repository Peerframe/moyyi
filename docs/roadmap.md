# Roadmap

Each phase ends with a usable, measured result. Eval numbers come from `npm run eval`.

## Phase 0: contracts and evals — in progress

Done:

- Repository and toolchain on Node 26; layer boundary check
- Persisted format (content, transcript tree, effect journal and transitions) with version and
  fixture lock
- Model client contract with `checkModelStream`; tool contract; ports; client protocol
- Plugin API and registry: atomic load, owned registrations, restrictive policy rules, isolated
  observers; `provider-scripted` as the first plugin
- Eval harness: fresh workspace per trial, hidden checker, outside-workspace canary, false-success
  and pass^k metrics, stop-and-report tasks, private task folder
- First task batch: 11 tasks, 10 rewritten from the owner's real requests; every checker proven
  against a reference solution and near misses ([evals/corpus.md](../evals/corpus.md))

Remaining:

- Grow the corpus from 11 to 30–50 tasks, including a held-out set in `evals/private/`
- Threat model filled in ([threat-model.md](threat-model.md))
- Two-protocol mapping for the content model, with recorded fixtures
  ([ADR 0003](decisions/0003-provider-neutral-content.md))
- Decide the proposed parts of ADR 0002 and ADR 0003

## Phase 1: read-only loop

Core loop, `provider-openai-compatible`, `project-instructions`, read and search tools in `fs`,
SQLite store (`node:sqlite` first), record/replay, plugin hot reload in development mode. Run
the read-only subset of the corpus.

## Phase 2: controlled writes

Confined workspace file access in `ToolContext`; edit and create with hash preconditions,
approval bound to digests, workspace snapshots and undo, effect journal; fault-injection tests.

## Phase 3: shell and reliable stop

Sandboxed processes in `ToolContext`, the `shell` plugin, process-group cancellation, bounded
output, unknown-effect handling. Start same-model comparisons against other harnesses.

## Phase 4: recovery and long sessions

Crash tests at every journal point, compaction, cache-aware context, long-session evals.

## Phase 5: second provider and web

`provider-anthropic` wired to a real model; the `web` plugin with prompt-injection evals.

## Phase 6: release

Packaging, installation, client protocol acceptance. UI slots arrive with the first GUI client.
