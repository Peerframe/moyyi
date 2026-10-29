# Roadmap

Delivery order and future scope. The [system overview](system-overview.md) owns current status;
the [post-M6 plan v2](tasks/2026-10-28-post-m6-plan.md) holds the owner's decisions behind this
order. The previous roadmap, including the M1–M6 desktop plan and the original M6–M13 OpenBot
transfer order, is kept in the [archive](tasks/2026-10-29-roadmap-archive.md). A merged delivery
does not prove that a real model completes tasks correctly.

## Implemented foundations

| Delivery | What exists | Contract and evidence |
|---|---|---|
| Contracts and eval foundation | Versioned persisted content, ports, plugin registry, task harness, public checkers | [Architecture](architecture.md), [corpus](../evals/corpus.md) |
| Read-only loop and CLI | SQLite, core loop, context, policy, file tools, DeepSeek Responses, recording and replay | [CLI](cli.md), [DeepSeek](deepseek.md) |
| Controlled writes | Confined create and edit, digest-bound approval, snapshots and undo | [Writes](writes.md) |
| Native command execution | Explicit process grants, OS confinement, bounded output, unknown-effect handling | [Shell](shell.md), [ADR 0013](decisions/0013-native-process-sandbox.md) |
| Recovery and longer sessions | Crash recovery, immutable history, explicit compaction | [Long sessions](long-sessions.md) |
| Second provider and web | Anthropic adapter, granted fetch and search, bounded HTML text | [Anthropic](anthropic.md), [web](web.md) |
| Installable candidate | Private tarball, installed CLI and client checks | [Installation](installation.md) |
| Guidance, Skills, task measurement | Default and project instructions, selected Skills, runtime task adapter | [Instructions](instructions.md), [Skills](skills.md), [runtime evals](runtime-evaluation.md) |
| Desktop candidate M1–M6 | Installed macOS app: approvals, materials, reports, editing and undo, backup and rollback, web sources, material library, previews, complete history | [Desktop](desktop.md); receipts M4–M6 in `tasks/` |

Accepted D1–D6 remain in their ADRs. Incompatible persisted changes need versioning and migration.

## Current sequence

The owner accepted this order on 2026-10-29. Each delivery is one user outcome, usually one branch
and one PR, accepted once at its end; non-blocking problems are fixed in one pass afterwards.
Claude writes the brief and accepts the result; Codex implements it.

| Delivery | User outcome | Status |
|---|---|---|
| **Zero: agent environment** | Shared `AGENTS.md`, skill library, design rules, handoff for switching accounts or models | Accepted ([PR #51](https://github.com/Peerframe/moyyi/pull/51)) |
| **One: model experience aligned with DeepSeek Harness** | Better task completion through a todo list, repeat reminders, read-tool timeouts, output spill and pruning, prompt assembly, DeepSeek adapter review and keyless replay tests | Accepted ([PR #53](https://github.com/Peerframe/moyyi/pull/53), [record](tasks/2026-10-29-delivery-1-model-experience-record.md)) |
| **Two: desktop feature modules** | Each desktop feature in its own module with declarative UI slots; no behavior change | Accepted ([PR #52](https://github.com/Peerframe/moyyi/pull/52), [record](tasks/2026-10-29-desktop-modules-delivery.md)) |
| **Three: settings, Skills and search** | Model connections (P07/P08), personal instructions (P09), a Skills library (P10), a search backend with recorded sources (P15), todo display, and stopping and switching connection when a model's quota runs out | Next |
| **Four: conditional capabilities** | Reviewed memory (P17), MCP tools (P18), image OCR (P12), controlled browser (P16), schedules and notifications (P20/P21) | Each starts when the owner uses it weekly or a real eval task needs it |

Every new store added by deliveries three and four extends backup, restore and software rollback
(P25) in the same delivery.

**Deferred by the owner (2026-10-28)**: template import and export (P11), voice recording and
transcription (P14), encrypted PDF and binary vision input (P13), interactive MCP Apps (P19),
audit export (P24) and remaining preferences and menus (P22). They stay in the
[inventory](openbot-provenance.md#complete-transfer-inventory) and can be proposed again.

## Rules for every delivery

- DeepSeek Harness is the first reference, OpenBot the second. Adapt designs, code and failure
  cases under their licenses and record them in [provenance](openbot-provenance.md); never add
  Cordis, a DSH package or OpenBot's runtime as a dependency.
- Core, context, SQLite store, effect journal, policy and client protocol remain moyyi's.
  Plugins cannot intercept the loop ([ADR 0005](decisions/0005-plugins.md)). Parsing, external
  processes and browser connections stay outside the renderer and core.
- One authority and one execution history. No Bot, team or channel routing, remote workers,
  PostgreSQL, Temporal or a second task engine.
- Defaults stay: Flash, Responses, low reasoning, zero retries, existing request, file, document
  and output limits. New providers are explicit connections, never silent fallbacks.
- Model output, imported files, Skills, memory and MCP output cannot grant permissions. Reopening
  does not restore execution authority. New effects have an effect profile, scoped grant,
  approval where required, cancellation and truthful unknown-outcome handling.
- New stores need a reviewed schema and a versioned migration with backup and rollback
  compatibility, following the [persisted-format recipe](recipes/change-persisted-format.md).
- User chats, credentials, cookies, browser profiles, memories and permissions are never copied
  from OpenBot or another tool without an explicit owner request.

## Quality lane

Answer quality is measured, not assumed:

- The frozen [quality gate](tasks/2026-10-28-post-m6-plan.md#5-质量门) runs at the end of each
  delivery that changes prompts, tools, providers or the loop. A task that passed at baseline must
  not fail on the candidate; a failure goes to the fix pass with a single baseline comparison.
- The original source-analysis task runs once at the end of delivery one with its frozen budget,
  as the comparison for that delivery. Its earlier failures keep their scores.
- Diagnose failures along one chain: input and settings → evidence acquisition → context delivery
  → model interpretation → effect execution → result verification → presentation. Fix the first
  demonstrated break; do not rerun the same question, add prompt variants or add automatic
  reviewers to hide a lack of progress.
- Keep three outcomes separate: capability available, task correctness demonstrated, public
  release ready.

## Outside the current sequence

- General visual or scanned-PDF understanding, arbitrary skill scripts, autonomous
  self-learning, sub-agents and computer drivers.
- DSH `goal` auto-continuation; it changes the loop and needs its own ADR after delivery one's
  results.
- Remote Bot, team or cluster operation; account or employee ownership transfer; a second core.
- Optional Docker backend; native isolation remains the default.
- Qwen/shasha model training and other model projects.
- Other desktop platforms until their bundles and user flows are exercised.
- Public versions, signed or notarized installers and automatic updates need separate release
  authorization.
