# moyyi contributor instructions

These apply to human contributors and coding agents.

## Before changing code

- For substantial work, start with [the system overview](docs/system-overview.md): identify the
  user outcome, current product/candidate version, demonstrated failure layer and next bounded
  result. Follow its relevant links rather than loading every historical task brief. Routine
  changes do not require a new planning document or renewed approval of accepted decisions.
- Read [docs/architecture.md](docs/architecture.md). Find the one layer or plugin your change
  belongs to; most changes should touch only that folder and its tests.
- Common changes have recipes: [add a plugin](docs/recipes/add-a-plugin.md),
  [change the persisted format](docs/recipes/change-persisted-format.md),
  [add an eval task](docs/recipes/add-an-eval-task.md).
- Nested rules apply: [src/plugins/AGENTS.md](src/plugins/AGENTS.md).

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
- Behavior changes to prompts, tools or the loop need eval evidence, not only unit tests.
- Code taken from OpenBot or other projects is recorded in
  [docs/openbot-provenance.md](docs/openbot-provenance.md) or the relevant ADR.

## Before handing off

- Run `npm run check`.
- Do not commit credentials, private transcripts or eval results containing personal data.
- English is used for code, comments and documentation. Task briefs in `docs/tasks/` are working
  documents for the owner and may be written in Chinese.
- When working from a brief in `docs/tasks/`, follow its rules and stop at decisions it reserves
  for the owner.
- When delivery changes what users can do or what has actually been verified, update the affected
  status/evidence row in [the system overview](docs/system-overview.md). Keep dated task records
  as history; do not equate implemented, installed, offline-tested and live-task-verified.
