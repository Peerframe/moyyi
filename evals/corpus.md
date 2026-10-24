# Task corpus

Where the eval tasks come from and which candidates are still waiting. Target: 30–50 tasks
before tuning the agent against them.

## Sources

The first batch was drawn on 2026-10-24 from the owner's own prompts in local Claude Code and
Codex sessions (about 50 interactive sessions, September–October 2026). Only prompts the owner
typed were used; prompts written by agents (for example Claude briefing Codex) were treated as
evidence of the kind of work, not as tasks. Every task is rewritten: no names, IDs, contact
details or private content from the sessions are in this repository.

What the owner asked for most:

- "What is left to do?", "continue with X", "CI failed, fix it"
- Website changes with exact constraints: keep the structure, change only the named parts
- File and document work where the original format must survive: worksheets, spreadsheets,
  note vaults
- Cleanup with clear limits: only what is old and unused

Failure modes the owner named, and the probes that target them:

| Probe | Failure | Tasks |
|---|---|---|
| `false_done` | Says it is done, but part is missing | greet-with-translations, remaining-work, listing-sheet, listener-leak, vault-move, contradictory-tests |
| `collateral_damage` | Changes or deletes what it was told to keep | homework-keep-format, stale-cache-cleanup, english-page, accessible-names, vault-move, listing-sheet, listener-leak |
| `forgotten_constraint` | Drops a constraint stated earlier | homework-keep-format, english-page, stale-cache-cleanup |
| `no_stop` | Keeps going instead of stopping and reporting | contradictory-tests |

## Runnable tasks

| Task | Category | Source | Expect |
|---|---|---|---|
| fix-range-off-by-one | coding | invented | complete |
| listener-leak | coding | real | complete |
| contradictory-tests | coding | real | stop and report |
| greet-with-translations | coding | real | complete |
| english-page | website | real | complete |
| accessible-names | website | real | complete |
| homework-keep-format | documents | real | complete |
| listing-sheet | data | real | complete |
| stale-cache-cleanup | files | real | complete |
| vault-move | files | real | complete |
| remaining-work | research | real | complete |

Every task ships a reference solution. `evals/tasks/tasks.test.ts` proves that each checker
passes the reference and fails an empty or boasting agent, and that the probed near misses fail.

## Candidates

Seen in the sessions, not yet turned into tasks.

| Candidate | Category | Needs | Next batch? |
|---|---|---|---|
| Convert a JavaScript module to TypeScript and split a large file, behavior unchanged | coding | checker runs `tsc` and tests | yes |
| Upgrade the Node version consistently across plan, CI, `.nvmrc` and deploy notes | coding | nothing new | yes |
| Summarize a set of notes in at most 300 characters, keeping the required points | research | length check plus required points | yes |
| Remove an obsolete implementation and its leftovers without breaking the build | coding | shell (phase 3) | |
| Fix a failing CI check in a repository with history | coding | shell and git (phase 3) | |
| Long session where an early constraint must hold ("do not remove features", "keep 60 fps") | any | multi-turn harness | |
| Write an article in the owner's voice from notes | website | rubric judged by a model, calibrated against the owner's ratings | |
| Compare similar open-source projects and recommend one | research | web (phase 5); an offline version from fixture READMEs is possible earlier | |
| Make an animation feel smoother, measured in frames | website | browser and performance measurement | |
| Fill in a real `.docx` worksheet keeping fonts and numbering | documents | document tools plugin | |
| Fill a web form from facts about a project | research | browser | |

Kept out of automatic evals and used as manual acceptance scenarios instead: uninstalling real
applications, clearing real caches on the machine, installing a new build over existing data.

Not used: making brand logos harder to detect so listings pass marketplace review. That would
measure help with evading trademark review, which moyyi should not optimize for.

## Private and held-out tasks

Tasks containing personal material, and the held-out set used to detect overfitting, go in
`evals/private/` (ignored by git). Export `tasks` from `evals/private/index.ts` in the same
format; `npm run eval` includes them when the folder exists.
