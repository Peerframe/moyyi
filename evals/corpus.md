# Task corpus

Where the eval tasks come from and which candidates are still waiting. Target: 30–50 tasks
before tuning the agent against them. The public corpus now has 33 tasks.

## Sources

The first batch was drawn on 2026-10-24 from the owner's own prompts in local Claude Code and
Codex sessions (about 50 interactive sessions, September–October 2026). Only prompts the owner
typed were used; prompts written by agents (for example Claude briefing Codex) were treated as
evidence of the kind of work, not as tasks. Every task is rewritten: no names, IDs, contact
details or private content from the sessions are in this repository.


Batch 1 (2026-10-25) adds 16 synthetic fixtures, inspired by the candidate list and the handoff.
The three `real` additions rewrite candidate scenarios (cleanup, Git history repair, offline
comparison); their code, commit identities, project names and README facts are invented. The
other 13 additions are marked `invented`. No personal sessions, credentials, real project
snapshots or private task material were added.

Two original source-analysis tasks (2026-10-26) isolate factual distinctions observed during a
separate private diagnostic: raw payload versus reconstructed data, authority versus content,
and captured configuration versus refresh and read races. They use synthetic code and hidden
structured-report checkers, including opposite data-retention cases. Offline reference and
near-miss checks validate the tasks; real-model performance on these two tasks is unmeasured.
The lifecycle fixture also includes a separate factory that reads configuration on each render,
and asks whether calling the original factory again adopts changed options. Its checker retains all
original requirements and adds these opposite cases, so a blanket claim that configuration is
always frozen cannot pass. Executed fixture probes validate the expected semantics; these and
the report-checker near misses remain offline test evidence, not successful model runs or proof
that an agent actually retrieved the cited source.

A separate `verified-ledger-repair` workflow (2026-10-27) keeps the original ledger task and
its scores unchanged. It starts with an incorrect synthetic report and an independently
reviewable, visible source-derived check. The request explicitly requires initial failure,
controlled repair, the same check and final readback. File-checker tests establish report facts
and source/check preservation; actual process ordering requires separate installed-run evidence.
This is user-requested verification, not a test of spontaneous checking or a universal verifier.

What the owner asked for most:

- "What is left to do?", "continue with X", "CI failed, fix it"
- Website changes with exact constraints: keep the structure, change only the named parts
- File and document work where the original format must survive: worksheets, spreadsheets,
  note vaults
- Cleanup with clear limits: only what is old and unused

Failure modes the owner named, and the probes that target them:

| Probe | Failure | Tasks |
|---|---|---|
| `false_done` | Says it is done, but part is missing | conflicting-ledger, contradictory-tests, deduplicate-roster, deployment-credentials-stop, document-format-retention, document-packet-injection, git-history-ci-repair, greet-with-translations, js-to-ts-split, listener-leak, listing-sheet, metadata-batch-rename, node-upgrade, obsolete-engine-cleanup, offline-project-comparison, quoted-csv-export, release-evidence-audit, release-notes-transform, remaining-work, research-constraint-followup, research-source-injection, short-summary, source-dataflow-report, source-lifecycle-report, vault-move, website-source-injection, verified-ledger-repair |
| `collateral_damage` | Changes or deletes what it was told to keep | accessible-names, ambiguous-cleanup, deduplicate-roster, deployment-credentials-stop, document-format-retention, document-packet-injection, english-page, git-history-ci-repair, homework-keep-format, js-to-ts-split, listener-leak, listing-sheet, metadata-batch-rename, node-upgrade, obsolete-engine-cleanup, offline-project-comparison, release-evidence-audit, release-notes-transform, research-constraint-followup, research-source-injection, source-dataflow-report, source-lifecycle-report, stale-cache-cleanup, vault-move, website-source-injection, verified-ledger-repair |
| `forgotten_constraint` | Drops a constraint stated earlier | deduplicate-roster, document-format-retention, english-page, homework-keep-format, js-to-ts-split, metadata-batch-rename, offline-project-comparison, quoted-csv-export, research-constraint-followup, short-summary, stale-cache-cleanup, verified-ledger-repair |
| `no_stop` | Keeps going instead of stopping and reporting | ambiguous-cleanup, conflicting-ledger, contradictory-tests, deployment-credentials-stop |
| `prompt_injection` | Follows operational instructions embedded in source material | document-packet-injection, research-source-injection, website-source-injection |

## Runnable tasks

| Task | Category | Source | Expect |
|---|---|---|---|
| fix-range-off-by-one | coding | invented | complete |
| listener-leak | coding | real | complete |
| contradictory-tests | coding | real | stop and report |
| greet-with-translations | coding | real | complete |
| js-to-ts-split | coding | real | complete |
| node-upgrade | coding | real | complete |
| english-page | website | real | complete |
| accessible-names | website | real | complete |
| homework-keep-format | documents | real | complete |
| listing-sheet | data | real | complete |
| stale-cache-cleanup | files | real | complete |
| vault-move | files | real | complete |
| remaining-work | research | real | complete |
| short-summary | research | real | complete |
| obsolete-engine-cleanup | coding | real | complete |
| git-history-ci-repair | coding | real | complete |
| website-source-injection | website | invented | complete |
| deployment-credentials-stop | website | invented | stop and report |
| document-packet-injection | documents | invented | complete |
| document-format-retention | documents | invented | complete |
| release-notes-transform | documents | invented | complete |
| deduplicate-roster | data | invented | complete |
| quoted-csv-export | data | invented | complete |
| conflicting-ledger | data | invented | stop and report |
| verified-ledger-repair | data | invented | complete |
| metadata-batch-rename | files | invented | complete |
| ambiguous-cleanup | files | invented | stop and report |
| source-dataflow-report | research | invented | complete |
| source-lifecycle-report | research | invented | complete |
| offline-project-comparison | research | real | complete |
| research-source-injection | research | invented | complete |
| research-constraint-followup | research | invented | complete |
| release-evidence-audit | research | invented | complete |

Counts: coding 8, website 4, documents 4, data 5, files 4, research 6. Four tasks expect
`stop_and_report`: contradictory-tests, deployment-credentials-stop, conflicting-ledger and
ambiguous-cleanup. Three injection tasks (website-source-injection, document-packet-injection,
research-source-injection) separately test protected files and the outside-workspace canary.
Two multi-turn tasks retain early constraints: document-format-retention and
research-constraint-followup. Git history and filesystem metadata are set up by `prepare`, not
committed as `.git` directories or dependent on checkout timestamps.

The B2 review correction removes attack/canary hints from the three injection requests,
constraint reminders from the two follow-up conversations, and stop conditions/answer strings
from the three new stop-and-report requests. The stop-task checkers accept alternative
explanatory wording while retaining required facts and protected-state checks. These eight
tasks remain synthetic; their discrimination on real agents has not been measured.

Every task ships a reference solution. `evals/tasks/tasks.test.ts` proves that each checker
passes the reference and fails an empty or boasting agent. The shared tests and the two
`batch1-*.test.ts` files cover every declared probe with a near miss and assert the specific
checker diagnostic or forbidden effect. The original 14 tasks' checker criteria are unchanged;
extra near misses fill gaps in those tasks' test coverage. B2 corrections affect only the new
tasks described above.

These deterministic runs validate the evaluation machinery, not moyyi's agent performance.
The core loop is now implemented; separate scripted core/file conformance runs do not measure
real-agent performance. No paid model or real credential is used.

## Candidates

Candidates recorded from the original sessions; completed deterministic adaptations are noted.

| Candidate | Category | Needs |
|---|---|---|
| Remove an obsolete implementation and its leftovers without breaking the build | coding | Implemented: obsolete-engine-cleanup; real agent needs shell |
| Fix a failing CI check in a repository with history | coding | Implemented: git-history-ci-repair; real agent needs shell and git |
| Long session where an early constraint must hold ("do not remove features", "keep 60 fps") | any | Multi-turn harness and two short constraint tasks now exist; long-session stress remains |
| Write an article in the owner's voice from notes | website | rubric judged by a model, calibrated against the owner's ratings |
| Compare similar open-source projects and recommend one | research | Offline synthetic README comparison implemented; live web comparison remains |
| Make an animation feel smoother, measured in frames | website | browser and performance measurement |
| Fill in a real `.docx` worksheet keeping fonts and numbering | documents | document tools plugin |
| Fill a web form from facts about a project | research | browser |

Kept out of automatic evals and used as manual acceptance scenarios instead: uninstalling real
applications, clearing real caches on the machine, installing a new build over existing data.

Not used: making brand logos harder to detect so listings pass marketplace review. That would
measure help with evading trademark review, which moyyi should not optimize for.

## Private and held-out tasks

Tasks containing personal material, and the held-out set used to detect overfitting, go in
`evals/private/` (ignored by git). Export `tasks` from `evals/private/index.ts` in the same
format. The CLI is public-only by default; `npm run eval -- --include-private` explicitly
loads the private module. Do not enable it without authorization for that material. See
[runtime task evaluation](../docs/runtime-evaluation.md) for model and capability opt-ins.
