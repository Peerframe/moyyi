# moyyi contributor instructions

These apply to human contributors and coding agents. `CLAUDE.md` imports this file; edit this one.

## What moyyi is

A personal, general-purpose agent with a small self-owned core. The core owns guarantees
(recording, permission, approval, cancellation, recovery); capabilities are plugins. Start with
[the system overview](docs/system-overview.md) for current status and
[the architecture](docs/architecture.md) for layer boundaries.

## Repository layout

```
src/contracts/      plugin API, model/tool contracts, ports, client protocol
src/contracts/persisted/  on-disk format, versioned and locked by fixtures
src/core/           run loop, executor, approvals, budgets, cancellation, recovery
src/store/          SQLite, blob store, migrations
src/context/        model request rendering, section ordering, compaction
src/policy/         base permission policy
src/runtime/        plugin registry, wiring, confined file/process/web/document capabilities
src/cli/            terminal client
src/plugins/<name>/ one capability per folder (providers, fs, shell, web, documents, skills ...)
apps/desktop/       Electron client: trusted host, validated bridge, sandboxed React renderer
evals/              task corpus, harness and offline conformance suites
docs/               overview, architecture, ADRs (docs/decisions), recipes, task briefs
.agents/skills/     shared workflow skills for Claude and Codex (.claude/skills links here)
design/brand/       selected brand assets; UI rules live in docs/design.md
```

Nested rules: [src/plugins](src/plugins/AGENTS.md), [apps/desktop](apps/desktop/AGENTS.md),
[evals](evals/AGENTS.md), [docs](docs/AGENTS.md).

## Commands

All commands need Node 26. None reads a credential or sends a paid request unless noted.

```sh
npm run check            # typecheck + lint + unit tests; required before handoff
npm run eval:<suite>     # offline conformance: core, files, documents, deepseek, shell,
                         # long-sessions, anthropic, kimi, web, instructions, runtime, skills, writes
npm run eval             # public task corpus with the null agent (offline)
npm run eval -- --agent moyyi --source live --allow-live ...   # PAID: real model, see evals/AGENTS.md
npm run verify:package   # packaged CLI/client acceptance (add --offline for no network)
npm run desktop:build    # build the desktop app
npm run desktop:package  # package the desktop app
npm run verify:desktop   # external-copy desktop acceptance with synthetic providers
npm run moyyi            # run the CLI from source
```

## How we work

- **Roles.** Claude designs and writes delivery briefs in `docs/tasks/`, then reviews and accepts
  the result. Codex implements a brief as one complete delivery. Use the
  [moyyi-brief](.agents/skills/moyyi-brief/SKILL.md) and
  [moyyi-change](.agents/skills/moyyi-change/SKILL.md) skills.
- **Granularity.** One delivery is one user outcome, usually one branch and one PR, accepted once
  at its end. Do not split it into small PRs or add intermediate approval points.
- **Finish, then fix.** Collect non-blocking problems during the delivery and fix them in one pass
  after the end-of-delivery checks. Stop immediately only for decisions the brief reserves for the
  owner, persisted-format changes, wider authority or security changes, new external services or
  credentials, and paid usage beyond the frozen budget.
- **Interruption and switching.** Keep every delivery resumable: checkpoint progress to a handoff
  file and a `wip:` commit after each part, so work can stop when a paid plan runs out and
  continue under another account or model. See
  [moyyi-handoff](.agents/skills/moyyi-handoff/SKILL.md).
- **Learning from other projects.** DeepSeek Harness is the first reference; OpenBot supplies
  already-adapted UI pieces and failure cases. See
  [moyyi-learn-from-dsh](.agents/skills/moyyi-learn-from-dsh/SKILL.md).

## Before changing code

- For substantial work, read the system overview: identify the user outcome, current version,
  demonstrated failure layer and next bounded result. Follow its links rather than loading every
  historical brief. Routine changes need no new planning document or renewed approval of
  accepted decisions.
- Find the one layer or plugin your change belongs to in the architecture; most changes touch
  only that folder and its tests.
- Recipes: [add a plugin](docs/recipes/add-a-plugin.md),
  [change the persisted format](docs/recipes/change-persisted-format.md),
  [add an eval task](docs/recipes/add-an-eval-task.md),
  [verify a result](docs/recipes/verify-a-result.md).

## Rules

- Layer rules are enforced by `tests/boundaries.ts`. If a check fails, change the import, not the
  rule. Changing a rule means changing `docs/architecture.md` and that file together.
- `src/contracts/persisted` is on users' disks. If its fixtures stop type-checking, follow the
  persisted-format recipe; never edit old fixtures to make them pass.
- `contracts` and `core` perform no I/O and import no packages. Add a port instead.
- New capabilities go in a plugin. Change the core only for a guarantee (recording, permission,
  approval, cancellation, recovery) or a new extension point, and record that in an ADR.
- New side effects need an `EffectProfile`, a policy decision, bounded inputs and outputs, and
  tests for denial, cancellation and interruption.
- Anything a model can see must be reconstructable from recorded requests.
- Behavior changes to prompts, tools or the loop need eval evidence, not only unit tests. Describe
  the model experience with [moyyi-model-experience](.agents/skills/moyyi-model-experience/SKILL.md).
- Code taken from OpenBot, DeepSeek Harness or other projects is recorded in
  [docs/openbot-provenance.md](docs/openbot-provenance.md) or the relevant ADR, with its commit
  and license.
- Desktop UI follows [docs/design.md](docs/design.md).

## Before handing off

- Run `npm run check` and the checks the change affects; see
  [moyyi-check](.agents/skills/moyyi-check/SKILL.md). Report only commands you actually ran.
- Do not commit credentials, private transcripts or eval results containing personal data.
- English is used for code, comments and documentation. Task briefs in `docs/tasks/` are working
  documents for the owner and may be written in Chinese.
- When working from a brief in `docs/tasks/`, follow its rules and stop at decisions it reserves
  for the owner.
- When delivery changes what users can do or what has actually been verified, update the affected
  status/evidence row in the system overview. Keep dated task records as history; do not equate
  implemented, installed, offline-tested and live-task-verified.

## Editing these instructions

Each rule lives in one place. Keep this file under 150 lines: detailed procedures belong in a
skill under `.agents/skills/`, area rules in the nested `AGENTS.md`, and rationale in an ADR.
