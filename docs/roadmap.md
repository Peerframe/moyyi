# Roadmap

The [system overview](system-overview.md) owns the dated current state, user-outcome matrix and
next engineering checkpoint. This roadmap separates implementation history from remaining
product acceptance and future scope. A merged phase does not prove that a real model completes
all tasks using its capabilities.

## Implemented foundations

| Delivery | What exists | Contract and historical evidence |
|---|---|---|
| Contracts and eval foundation | Versioned persisted content, ports, plugin registry, task harness, public checkers and negative cases | [Architecture](architecture.md), [corpus](../evals/corpus.md), [historical handoff](tasks/2026-10-24-codex-handoff.md) |
| Read-only loop and CLI | SQLite, core loop, context, policy, file tools, DeepSeek Responses, recording/replay, interactive CLI and development reload | [CLI](cli.md), [DeepSeek](deepseek.md), [batch 7 record](tasks/2026-10-25-batch-7-cli.md) |
| Controlled writes | Confined create/edit, digest-bound approval, snapshots and undo | [Writes](writes.md), [phase 2 record](tasks/2026-10-25-phase-2-writes.md) |
| Native command execution | Explicit process grants, OS confinement, bounded output, interruption and unknown-effect handling | [Shell limitations](shell.md), [D6 / ADR 0013](decisions/0013-native-process-sandbox.md), [phase 3 record](tasks/2026-10-25-phase-3-shell.md) |
| Recovery and longer sessions | Crash recovery, immutable history and explicit bounded compaction | [Long sessions](long-sessions.md), [phase 4 record](tasks/2026-10-25-phase-4-long-sessions.md) |
| Second provider and web | Anthropic adapter, separately granted fetch/search, bounded HTML text | [Anthropic](anthropic.md), [web](web.md), [phase 5 record](tasks/2026-10-25-phase-5-anthropic-web.md) |
| Local installable candidate | Private tarball, installed CLI/PTY/client/type checks | [Installation](installation.md), [phase 6 record](tasks/2026-10-25-phase-6-candidate.md); merged, not officially published |
| Working guidance, Skills and task measurement | Default/project instructions, explicitly selected Skills, runtime task adapter, bounded request closeout | [Instructions](instructions.md), [Skills](skills.md), [runtime evals](runtime-evaluation.md), [PR #24 record](tasks/2026-10-26-request-budget-closeout.md) |

Accepted D1–D6 are preserved in their ADRs. D2's one-time v1 amendment is complete; subsequent
incompatible persisted changes require versioning and migration. OpenBot reuse already includes
selected YAML-validation experience and independently rewritten HTML-extraction lessons; see
[provenance](openbot-provenance.md). It does not import the old cluster/control-plane architecture.

## Product acceptance still to establish

1. **Reliable project investigation.** Resolve demonstrated navigation/interface gaps and measure
   the complete task with the fixed model and unchanged criteria. The original project task has
   not passed. Candidate features and the finite next delivery are in the system overview.
2. **Representative task quality.** Exercise existing public tasks through the real runtime with
   explicit capabilities and authorized budgets. Separate unsupported tasks, execution failures,
   evidence gaps and incorrect conclusions. Do not substitute null/scripted results or checker
   tests for real-model performance. Use the existing [comparison protocol](research/harness-comparison.md)
   when a controlled mature-harness baseline can resolve a concrete question.
3. **Controlled editing as a user workflow.** Verify modification, actual checks, reviewable output
   and undo together in bounded tasks; keep file/process grants explicit.
4. **Long-session fidelity.** Measure real-model retained facts and unfinished work across resume
   and compaction, beyond the existing deterministic lifecycle checks.
5. **External-service acceptance.** Verify Anthropic and the configured search service before
   claiming live support; browsing still needs separate implementation. Seven-format document reading
   is now an independent candidate with offline acceptance; model understanding still needs
   separate live acceptance. Do not weaken isolation to make a task pass.

These are outcomes, not automatic authorizations for paid calls, merges or publication. A single
focused delivery should close one meaningful user outcome or one measured prerequisite, then
update the system overview with the result. Avoid growing every future capability in parallel.

## Deferred directions

- A GUI client and UI slots over the existing client protocol.
- MCP and memory/learning plugins, with separate authority, lifecycle and task-quality evidence.
- Optional Docker execution backend; the accepted default remains native OS sandboxing.
- Additional models, Qwen and shasha. Training is deferred until the agent itself is useful.
- Further OpenBot reuse only when it solves a demonstrated need without importing old product roles.
- Official package/release tags, signed installers and automatic updates, only with explicit release
  authorization and their own acceptance. Current local installation is not public release.

The dated task archive is for reproducing earlier decisions and checks. It is not the current
backlog; old phrases such as “next phase” or “awaiting review” retain their historical meaning.
