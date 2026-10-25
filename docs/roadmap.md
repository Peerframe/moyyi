# Roadmap

Each phase ends with a usable, measured result. Eval numbers come from `npm run eval`.

The remaining phase 0 work and phase 1 are split into batches in the
[Codex handoff brief](tasks/2026-10-24-codex-handoff.md).

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
- Task corpus: 14 tasks, 13 rewritten from the owner's real requests; every checker proven
  against a reference solution and near misses ([evals/corpus.md](../evals/corpus.md))

Remaining:

- Grow the corpus from 14 to 30–50 tasks, including a held-out set in `evals/private/`
- Validate the accepted security design ([threat-model.md](threat-model.md),
  [ADR 0006](decisions/0006-security-boundaries.md)) in the relevant implementation phases
- Two-protocol mapping for the content model, with recorded fixtures
  ([ADR 0003](decisions/0003-provider-neutral-content.md))
- Land the accepted D1/D2/D3/D5 decisions and finish the separately authorized D2 v1 amendment
  before storage writes data; see the [batch 3 prerequisites](tasks/2026-10-24-codex-handoff.md#31-开始批次-3-之前)

## Phase 1: read-only loop

Core loop, `provider-deepseek` ([ADR 0007](decisions/0007-first-model-provider.md)),
`project-instructions`, read and search tools in `fs`, SQLite store (driver comparison in
batch 3; `node:sqlite` first candidate), record/replay, plugin hot reload in development mode.
Run the read-only subset of the corpus. Qwen and shasha training are deferred directions,
not requirements for this phase or the first release.

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
