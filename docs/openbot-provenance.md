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
| `apps/desktop/renderer/ApprovalCard.tsx`, `styles.css` | `apps/web/src/components/ApprovalCard.tsx`, `apps/web/src/tokens.css`, `apps/web/src/styles.css` | `010439bb9002fabb7e1facd8450ee85edbafa309` | Narrow view/token adaptation; new authority and session bridge. MIT retained in app. |
| `apps/desktop/renderer/ArtifactCard.tsx` | `apps/web/src/components/ArtifactCard.tsx`, `apps/web/src/artifact-shell-save.ts` | `010439bb9002fabb7e1facd8450ee85edbafa309` | Narrow presentation/pending/error and identity-only action adaptation. New moyyi receipt/hash checks and local plain-text/reveal actions replace Server downloads. MIT retained; M2 accepted and installed through PR #45. |
| `apps/desktop/renderer/EffectsPanel.tsx`, `effects-state.ts` | `apps/web/src/components/TaskSteps.tsx` | `010439bb9002fabb7e1facd8450ee85edbafa309` | Narrow folded-list/row adaptation for actual effect history. No upstream fetch, Server/domain types or assumed completed stages. MIT retained; M3 candidate evidence is recorded below. |
| `src/plugins/skills/parse.ts` | `packages/employee-publisher/src/agent-skills.ts` | `010439bb9002fabb7e1facd8450ee85edbafa309` | Adapted bounded YAML AST-validation approach (aliases, anchors/tags, scalar keys, node/depth caps); rewritten schema checks and moyyi plugin/port, no publisher or authority code. MIT notice in `THIRD_PARTY_NOTICES.md` |

## Desktop M1 adaptation

`apps/desktop/renderer/ApprovalCard.tsx` adapts the fixed revision's
`apps/web/src/components/ApprovalCard.tsx`: pending decisions, both-buttons-disabled behavior
and failure feedback. moyyi adds a synchronous duplicate-click lock and keys cards by the exact
`effectId + digest`. The new host validates the currently pending operation; a resolved send
promise is not a task-success claim, and old history cannot restore a pending approval.
`styles.css` adapts a small color/font-token subset from `apps/web/src/tokens.css` and
approval presentation from `apps/web/src/styles.css` at that revision. The MIT text is retained in
`renderer/OPENBOT-LICENSE.txt` and shipped with the app. Tests independently exercise the new
renderer/bridge, actual readonly runtime, SQLite, denial, stale digest, cancellation and recovery.
No Bot/channel/risk/domain DTO, login recovery, Server API or old task engine was copied.
See [desktop guide](desktop.md) and [ADR 0037](decisions/0037-installed-desktop-client.md).

## Desktop M2 adaptation

`apps/desktop/renderer/ArtifactCard.tsx` adapts the fixed revision's
`apps/web/src/components/ArtifactCard.tsx` and `apps/web/src/artifact-shell-save.ts`: document-card
presentation, in-flight/error feedback and an identity-only action boundary. It replaces Server
URLs and download/PNG behavior with moyyi's session/effect identity, actual create receipts,
fresh file/hash checks, in-app plain text and a Finder-location request. File paths and model
text never become renderer-controlled navigation. The source comment and existing distributed
MIT license retain attribution; see [third-party notices](../THIRD_PARTY_NOTICES.md).

The settings form and material picker are independently rewritten against the local host.
Review of `ModelSettingsScreen.tsx`, `ModelSelector.tsx` and `ComposerAttachmentPicker.tsx` informed
credential clearing, explicit unavailable choices, cancellation and stale-result handling.
No Server catalog, revision/identity DTO, upload endpoint, channel model or attachment parser is
copied. This slice uses only workspace-local native selection; upstream drag/drop, OCR and
transcription are not ported. New renderer tests exercise escaped result text, historical states,
empty result pages, input clearing and action locking. Upstream tests were read, not run.
The external candidate and both original live document tasks passed through the native UI;
actual report text and comparison-file Finder selection were observed. This is moyyi candidate
evidence, not an upstream test result or a general reliability claim. Final rebuilt-app restart,
CI, merge and owner installation are recorded in the accepted [M2 PR #45 receipt](https://github.com/Peerframe/moyyi/pull/45).

## Desktop M3 adaptation

`EffectsPanel.tsx` and `effects-state.ts` adapt the fixed revision's
[`TaskSteps.tsx`](https://github.com/Peerframe/openbot/blob/010439bb9002fabb7e1facd8450ee85edbafa309/apps/web/src/components/TaskSteps.tsx)
folded-list and row presentation: show short lists in full, otherwise the first three and last
six, with an explicit middle expansion. moyyi corrects the upstream10–12-row omission, keys
expansion by session/run/effect page identity, and displays recorded states rather than marking
all rows done. Existing MIT comments/notices cover this adaptation.

The fixed [`WorkTasksScreen.tsx`](https://github.com/Peerframe/openbot/blob/010439bb9002fabb7e1facd8450ee85edbafa309/apps/web/src/components/WorkTasksScreen.tsx)
and [its tests](https://github.com/Peerframe/openbot/blob/010439bb9002fabb7e1facd8450ee85edbafa309/apps/web/src/components/WorkTasksScreen.test.tsx)
informed unknown-result, lost-ACK and late-response handling. `WorkTasksEntry.tsx` informed
explicit retry/read invalidation; its Bot/login/hash-routing implementation is not copied.
moyyi retains its existing subscription receiver and action gate, not Server polling, revision
storage or login recovery. The new permissions form is independently implemented over the native
host bridge. Undo/check controls prepare editable drafts; source receipts do not authorize them.

The four renderer test files passed32 tests, desktop typecheck and scoped Biome passed at this
implementation checkpoint. Tests cover10–12-row retention, expansion identity, unknown/failed/
cancelled effects, expected absence, escaped text and draft-only callbacks. These are component
and pure-state checks, not native interaction or installed acceptance. Upstream tests were read,
not run; M3 package, native UI and fixed workflow acceptance remain pending.

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

<a id="planned-desktop-reuse-not-yet-ported"></a>

## Desktop reuse inventory

The [current product plan](roadmap.md#openbot-reuse-within-this-sequence) moves a personal desktop
client into the next delivery. The following candidates were read at fixed OpenBot commit
`010439bb9002fabb7e1facd8450ee85edbafa309`, under its
[MIT license](https://github.com/Peerframe/openbot/blob/010439bb9002fabb7e1facd8450ee85edbafa309/LICENSE).
The owner's dirty checkout was not used as source. This is a candidate inventory: no UI source
was copied during planning. M1 adapts the approval view; the M2 source candidate now adapts the
result card and independently implements the settings/material interactions described above;
upstream tests have not been run, and this inventory itself certifies no desktop behavior.
Record actual adapted files/notices and moyyi verification when each port is implemented.

| Candidate at the fixed revision | Reuse decision and dependency boundary | Planned slice |
|---|---|---|
| [ApprovalCard.tsx](https://github.com/Peerframe/openbot/blob/010439bb9002fabb7e1facd8450ee85edbafa309/apps/web/src/components/ApprovalCard.tsx) | First candidate for narrow view adaptation: pending/error/duplicate-click presentation. Replace Bot/channel/risk DTOs with moyyi's actual effect summary and exact digest-bound callbacks. The view cannot decide authority. | M1 |
| [ArtifactCard.tsx](https://github.com/Peerframe/openbot/blob/010439bb9002fabb7e1facd8450ee85edbafa309/apps/web/src/components/ArtifactCard.tsx) | M2 source adaptation recorded above; local receipt/hash checks and plain-text/reveal actions replace HTTP downloads. Existing PNG/Markdown distinctions do not establish arbitrary-file preview support. | M2 candidate |
| [ComposerAttachmentPicker.tsx](https://github.com/Peerframe/openbot/blob/010439bb9002fabb7e1facd8450ee85edbafa309/apps/web/src/components/ComposerAttachmentPicker.tsx) | Reimplement local selection/import using drag/drop, cancellation and late-response lessons. Do not port channel IDs, upload service, OCR/transcription or duplicate existing parsers. | M2 |
| [ModelSelector.tsx](https://github.com/Peerframe/openbot/blob/010439bb9002fabb7e1facd8450ee85edbafa309/apps/web/src/components/ModelSelector.tsx), [ModelSettingsScreen.tsx](https://github.com/Peerframe/openbot/blob/010439bb9002fabb7e1facd8450ee85edbafa309/apps/web/src/components/ModelSettingsScreen.tsx) | Reimplement against explicit local host settings. Preserve unavailable selections and save feedback; no silent model change. Exclude Server catalogs, identity/revision and credential DTOs. | M2 |
| [TaskSteps.tsx](https://github.com/Peerframe/openbot/blob/010439bb9002fabb7e1facd8450ee85edbafa309/apps/web/src/components/TaskSteps.tsx), [WorkTasksEntry.tsx](https://github.com/Peerframe/openbot/blob/010439bb9002fabb7e1facd8450ee85edbafa309/apps/web/src/components/WorkTasksEntry.tsx), [WorkTasksScreen.tsx](https://github.com/Peerframe/openbot/blob/010439bb9002fabb7e1facd8450ee85edbafa309/apps/web/src/components/WorkTasksScreen.tsx) | Reimplement bounded progress/history/late-response behavior from runtime events and session catalog. No Server polling, WorkSnapshot, Bot or database model. OpenBot local-session-recovery restores Server login, not moyyi task state; do not port it. | M1/M3 |

The core, state, policy and result truth remain moyyi's. Reuse is judged by integration and
maintenance cost for the defined user flow, not the number of old files copied. A selected view
must adapt to the new contract; the old application architecture must not become a dependency.

## Desktop M5 reuse

M5 reuses the already adapted approval and artifact components from M1–M3 and the bounded HTML
reader described above. No new OpenBot files are copied or substantially adapted. The ephemeral
web grant, validated bridge and recorded-source projection are original moyyi code connected to
the existing public runtime. The old control plane, login/session system and browser authority
remain excluded. See [ADR0043](decisions/0043-desktop-web-sources.md).
