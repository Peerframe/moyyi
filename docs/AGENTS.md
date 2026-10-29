# Documentation rules

## Where facts live

| Document | Owns |
|---|---|
| [system-overview.md](system-overview.md) | Current product, what users can do, current delivery status |
| [architecture.md](architecture.md) | Layer boundaries and extension points |
| [roadmap.md](roadmap.md) | Delivery order and future scope |
| [decisions/](decisions/) | Accepted decisions and their rationale (ADRs) |
| [design.md](design.md) | Desktop UI rules |
| [recipes/](recipes/) | Step-by-step procedures for common changes |
| [tasks/](tasks/) | Dated briefs and delivery records (history) |
| [openbot-provenance.md](openbot-provenance.md) | Code and designs taken from other projects |
| Plugin `README.md` | What the plugin does, its configuration, model experience and limits |

Each fact has one home; other documents link to it.

## Writing

- Current-state documents describe what is true now. Move dated narratives, trial details and
  superseded status to the delivery record in `tasks/`; never delete recorded failures.
- Distinguish implemented, installed, offline-tested and live-task-verified. Do not let a passing
  test suite or a model's own claim stand in for task correctness.
- English for everything except briefs and records in `tasks/`, which may be Chinese.
- Put a space between a number and its unit or a following word (`144 files`, `8 requests`,
  `120 s`).
- Prefer short sentences and tables. A document that keeps growing with history is a sign the
  history belongs in `tasks/`.

## ADRs

Write an ADR when changing the core, adding an extension point or capability port, changing a
persisted or settings format, or adding a dependency. Number ADRs sequentially; an accepted ADR
is amended by a dated section or superseded by a new ADR, not silently rewritten.

## Task briefs

Briefs for a delivery follow the [moyyi-brief](../.agents/skills/moyyi-brief/SKILL.md) skill.
Name them `tasks/YYYY-MM-DD-<topic>.md` and link them from the plan that owns them.
