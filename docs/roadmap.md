# Roadmap

Each phase ends with a usable, measured result. Eval numbers come from `npm run eval`.

The remaining phase 0 work and phase 1 are split into batches in the
[Codex handoff brief](tasks/2026-10-24-codex-handoff.md).

## Phase 0: contracts and evals — in progress

Done:

- Repository and toolchain on Node 26; layer boundary check
- CI on pull requests and main pushes, including the tracked eval fixture baseline
- Persisted format (content, transcript tree, effect journal and transitions) with version and
  fixture lock
- Model client contract with `checkModelStream`; tool contract; ports; client protocol
- Plugin API and registry: atomic load, owned registrations, restrictive policy rules, isolated
  observers; `provider-scripted` as the first plugin
- Eval harness: fresh workspace per trial, hidden checker, outside-workspace canary, false-success
  and pass^k metrics, stop-and-report tasks, private task folder
- Task corpus: 30 public tasks with multi-turn and injection cases; every checker proven
  against a reference solution and near misses ([evals/corpus.md](../evals/corpus.md)).
  The B1 final-claim and B2 answer-hint corrections are integrated
- Three-protocol content mapping with synthetic fixtures and integrity tests
  ([content-model-mapping.md](research/content-model-mapping.md)); no live API acceptance
- Accepted D1–D5 decisions; implementation gates remain in the handoff brief
- D2 v1 amendment on [PR #6](https://github.com/Peerframe/moyyi/pull/6): refusal/reasoning,
  usage and termination provenance, bounded hash/origin-bound replay; local checks and CI
  passed before batch 3 started. It is awaiting owner review/merge

Remaining:

- Add more tasks as needed and an owner-supplied held-out set in `evals/private/`; public
  checker results do not yet measure real-agent performance
- Validate the accepted security design ([threat-model.md](threat-model.md),
  [ADR 0006](decisions/0006-security-boundaries.md)) in the relevant implementation phases
- Review/merge the D2 and dependent storage PRs; these branches are not automatically merged

## Phase 1: read-only loop

Core loop, `provider-deepseek` ([ADR 0007](decisions/0007-first-model-provider.md)),
`project-instructions`, read and search tools in `fs`, SQLite store, record/replay,
plugin hot reload in development mode. The batch 3 review branch now implements the store
using `node:sqlite`: transactions, blobs, writer locks, workspace leases and backup/restore.
The runtime is not wired to it yet; the loop, recovery and context remain batch 4 work and
have not started. See the [current handoff](tasks/2026-10-25-v1-and-storage.md).
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
