# OpenBot provenance

moyyi is a new project. OpenBot's code is not copied wholesale, renamed or used as a fallback.
This file records everything that is taken from OpenBot so the origin stays traceable.

## Rules

- Port failure scenarios and the knowledge in their tests, rewritten against moyyi's contracts.
- Small functions without business dependencies may be copied. Record each one below with its
  source path and revision.
- Not ported: Server authority, Bot/team/channel models, Temporal, old protocols, old database
  migrations.

## Failure scenarios to port

Each becomes a deterministic test using the scripted model and fault injection:

- [x] Cancellation racing a tool start — [executor tests](../src/core/executor.test.ts), including
  cancellation immediately after the durable start barrier, before invocation
- [x] Permission revoked during a run — executor and [protocol tests](../tests/runtime-core.test.ts),
  including revoke/regrant invalidating an approval epoch
- [x] Output and input size limits exceeded — executor truncation and
  [argument validation tests](../src/runtime/validation.test.ts)
- [x] Invalid tool arguments — strict JSON/schema rejection before prepare, paired result
- [x] Symlinks pointing outside the workspace — actual disposable filesystem cases in
  [precondition tests](../src/runtime/preconditions.test.ts); this validates the preflight port,
  not a file capability. The batch 5 operation-time confinement tests remain required
- [x] Overwrite conflicts (file changed after preview or approval) — file-hash preflight plus
  executor/protocol re-approval with a new digest. Phase 2 adds real write/undo conflict tests in `tests/runtime-writes.test.ts`
- [x] Outcome unknown after interruption — [real-process recovery tests](../tests/core-recovery.test.ts)
  kill after execution starts, reopen, retain unknown and never invoke the action again

These are independently written moyyi tests based on the listed failure scenarios. They do not
copy OpenBot code or establish general filesystem/process isolation. Batch 4's synthetic
write tools were synthetic; phase 2 introduces an explicit runtime write grant. The default remains read-only.

## Copied code

| moyyi path | OpenBot source | Revision | Notes |
|---|---|---|---|
| `src/runtime/document-worker.ts` | `apps/server-python/src/openbot_server/parser_worker.ts` (`adaptPdf`, `adaptOffice`, input/output bounds and failure cases) | `010439bb9002fabb7e1facd8450ee85edbafa309` | Narrowly adapted parsing methods only; new runtime/plugin/sandbox/FD reader. MIT notice retained. |
| `src/runtime/fixtures/{encrypted,image-only}.pdf` | `tests/oracles/legacy-server/src/__fixtures__/attachments/` | `010439bb9002fabb7e1facd8450ee85edbafa309` | Fixed synthetic binary inputs, newly exercised against moyyi; old test results are not evidence. |
| `src/plugins/skills/parse.ts` | `packages/employee-publisher/src/agent-skills.ts` | `010439bb9002fabb7e1facd8450ee85edbafa309` | Adapted bounded YAML AST-validation approach (aliases, anchors/tags, scalar keys, node/depth caps); rewritten schema checks and moyyi plugin/port, no publisher or authority code. MIT notice in `THIRD_PARTY_NOTICES.md` |

## Skills boundary experience

Reviewed the same OpenBot revision's `apps/server-python/src/openbot_server/employee_knowledge_inputs.py`
and `apps/server-python/tests/test_skill_yaml.py`. The scalar-type cases (block/folded strings,
comments, YAML 1.2 strings and numeric/boolean/null rejection), duplicate-key cases and inert
`allowed-tools` boundary are independently rewritten in
[src/plugins/skills/parse.test.ts](../src/plugins/skills/parse.test.ts). OpenBot's secret-text heuristic,
publication schemas, author/publisher identity and control plane are not imported. No OpenBot
worktree file was modified. The reviewed source files matched that commit despite unrelated local
OpenBot changes. The runtime reader, request recording, permission and cancellation mechanisms
remain moyyi's existing implementations; see [ADR 0019](decisions/0019-explicit-skills-context.md).

## Web text extraction experience

Independently rewritten in `src/plugins/web/html-text.ts`, its tests and `evals/web/scenario.ts`,
from OpenBot revision `010439bb9002fabb7e1facd8450ee85edbafa309`:

- `apps/server-python/src/openbot_server/public_source.py`: bound input/depth/children/events,
  remove non-content subtrees, preserve UTF-8 on clipping; no raw fallback on parser limits.
- `apps/server-python/tests/test_public_source.py`: `test_python_html_semantics_and_utf8_bound`
  and `test_parser_tree_limits_fail_closed`; new moyyi cases also cover title, hidden attributes,
  malformed HTML and preserved HTTP/source truncation.

No OpenBot source is copied or substantially adapted. The Python process/BeautifulSoup pipeline,
network implementation and Server authority are not ported. [ADR 0020](decisions/0020-bounded-html-text.md)
records the independently chosen TypeScript parser, exact version and limits.

## Document codec distribution

[ADR 0028](decisions/0028-bounded-document-reading.md) records the selected releases and local npm
installation finding. The compiled package includes the unchanged Node files of officeparser 7.8.0
(commit `09b27018450ed4df88fe01494343b43556813b71`), licensed under MIT, with only package metadata's
PDF edge corrected to 6.3.289. No browser bundle or OCR language data is included. SOURCE.json in
the generated copy records every included file hash and the original npm integrity. The original
package.json SHA-256 is `027203373c6f05784a6d87c72a47c412340201046dc6a84c1cc7259185bbdbde`.
The generated metadata SHA-256 is `0e139b68c5354cb9f0d408fcc4ea09b0308874d7f643153f7587593cae2421db`.
The install gate verifies original Node bytes, licenses and both actual PDF resolution paths.

The new seven-format fixtures are independently generated in
`src/runtime/fixtures/document-fixtures.ts`; only the two specifically listed PDF inputs come from
OpenBot. Neither the OpenBot checkout's unrelated work nor its legacy runtime is imported.

## Planned desktop reuse (not yet ported)

The [current product plan](roadmap.md#openbot-reuse-within-this-sequence) moves a personal desktop
client into the next delivery. The following candidates were read at fixed OpenBot commit
`010439bb9002fabb7e1facd8450ee85edbafa309`, under its
[MIT license](https://github.com/Peerframe/openbot/blob/010439bb9002fabb7e1facd8450ee85edbafa309/LICENSE).
The owner's dirty checkout was not used as source. This is a candidate inventory: no UI source
has been copied, upstream tests have not been run, and no desktop behavior is certified by it.
Record actual adapted files/notices and moyyi verification when each port is implemented.

| Candidate at the fixed revision | Reuse decision and dependency boundary | Planned slice |
|---|---|---|
| [ApprovalCard.tsx](https://github.com/Peerframe/openbot/blob/010439bb9002fabb7e1facd8450ee85edbafa309/apps/web/src/components/ApprovalCard.tsx) | First candidate for narrow view adaptation: pending/error/duplicate-click presentation. Replace Bot/channel/risk DTOs with moyyi's actual effect summary and exact digest-bound callbacks. The view cannot decide authority. | M1 |
| [ArtifactCard.tsx](https://github.com/Peerframe/openbot/blob/010439bb9002fabb7e1facd8450ee85edbafa309/apps/web/src/components/ArtifactCard.tsx) | Adapt presentation and save/cancel/existing-file feedback; replace HTTP downloads and Desktop bridge with receipt-backed local actions. Existing PNG/Markdown distinctions do not establish arbitrary-file preview support. | M2 |
| [ComposerAttachmentPicker.tsx](https://github.com/Peerframe/openbot/blob/010439bb9002fabb7e1facd8450ee85edbafa309/apps/web/src/components/ComposerAttachmentPicker.tsx) | Reimplement local selection/import using drag/drop, cancellation and late-response lessons. Do not port channel IDs, upload service, OCR/transcription or duplicate existing parsers. | M2 |
| [ModelSelector.tsx](https://github.com/Peerframe/openbot/blob/010439bb9002fabb7e1facd8450ee85edbafa309/apps/web/src/components/ModelSelector.tsx), [ModelSettingsScreen.tsx](https://github.com/Peerframe/openbot/blob/010439bb9002fabb7e1facd8450ee85edbafa309/apps/web/src/components/ModelSettingsScreen.tsx) | Reimplement against explicit local host settings. Preserve unavailable selections and save feedback; no silent model change. Exclude Server catalogs, identity/revision and credential DTOs. | M2 |
| [TaskSteps.tsx](https://github.com/Peerframe/openbot/blob/010439bb9002fabb7e1facd8450ee85edbafa309/apps/web/src/components/TaskSteps.tsx), [WorkTasksEntry.tsx](https://github.com/Peerframe/openbot/blob/010439bb9002fabb7e1facd8450ee85edbafa309/apps/web/src/components/WorkTasksEntry.tsx), [WorkTasksScreen.tsx](https://github.com/Peerframe/openbot/blob/010439bb9002fabb7e1facd8450ee85edbafa309/apps/web/src/components/WorkTasksScreen.tsx) | Reimplement bounded progress/history/late-response behavior from runtime events and session catalog. No Server polling, WorkSnapshot, Bot or database model. OpenBot local-session-recovery restores Server login, not moyyi task state; do not port it. | M1/M3 |

The core, state, policy and result truth remain moyyi's. Reuse is judged by integration and
maintenance cost for the defined user flow, not the number of old files copied. A selected view
must adapt to the new contract; the old application architecture must not become a dependency.
