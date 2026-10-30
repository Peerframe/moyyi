# OpenBot provenance

moyyi is a new project. OpenBot's code is not copied wholesale, renamed or used as a fallback.
This file records everything that is taken from OpenBot so the origin stays traceable. Reuse from
DeepSeek Harness is recorded in its own [section](#deepseek-harness) below.

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
| `apps/desktop/renderer/RichMessage.tsx` | `apps/web/src/components/RichMessage.tsx` | `010439bb9002fabb7e1facd8450ee85edbafa309` | Narrow Markdown presentation adaptation using escaped React nodes; no raw HTML, link navigation or remote image loading. MIT retained. M6 candidate implemented, acceptance pending. |
| `apps/desktop/host/save-result.ts` | `apps/desktop/src/report-save.ts` | `010439bb9002fabb7e1facd8450ee85edbafa309` | Narrow exclusive native-save adaptation; moyyi receipt selection and fresh source/hash validation replace upstream download authority. Result-only, no arbitrary original export. MIT retained. M6 candidate implemented, acceptance pending. |
| `apps/desktop/renderer/SessionSidebar.tsx` | `apps/web/src/sidebar-organization.ts`, `apps/web/src/components/SidebarItemMenu.tsx` | `010439bb9002fabb7e1facd8450ee85edbafa309` | Organization controls adapted for local title/group/pin/mute/recycle state. New revision-checked moyyi management/store boundary; no channel/login/Server state. MIT retained. M6 candidate implemented, acceptance pending. |
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
copied. The M2 slice used only workspace-local native selection; upstream drag/drop, OCR and
transcription were not ported in that slice. M6's later import implementation is recorded separately. New renderer tests exercise escaped result text, historical states,
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
not run. At that implementation checkpoint M3 package, native UI and fixed workflow acceptance
were pending; later acceptance/installation is recorded in [PR46](https://github.com/Peerframe/moyyi/pull/46).

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

The [current product plan](tasks/2026-10-29-roadmap-archive.md#openbot-reuse-within-this-sequence) moves a personal desktop
client into the next delivery. The following candidates were read at fixed OpenBot commit
`010439bb9002fabb7e1facd8450ee85edbafa309`, under its
[MIT license](https://github.com/Peerframe/openbot/blob/010439bb9002fabb7e1facd8450ee85edbafa309/LICENSE).
The owner's dirty checkout was not used as source. No UI source was copied during the planning delivery. Actual M1–M3 adaptations and M6 candidate
adaptations are recorded above and below; upstream tests have not been run. This inventory itself
certifies no desktop behavior. Record actual adapted files/notices and moyyi verification when
each port is implemented.

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


## Desktop M6 candidate adaptation

M6 has **bounded material/result/history acceptance evidence**; PR50 records final integration and installation.
The fixed source remains
`010439bb9002fabb7e1facd8450ee85edbafa309`; no dirty OpenBot source or new dependency is imported.
`RichMessage.tsx` adapts the fixed
[rich-message view](https://github.com/Peerframe/openbot/blob/010439bb9002fabb7e1facd8450ee85edbafa309/apps/web/src/components/RichMessage.tsx)
into a small escaped React-node Markdown renderer. `host/save-result.ts` adapts
[report-save.ts](https://github.com/Peerframe/openbot/blob/010439bb9002fabb7e1facd8450ee85edbafa309/apps/desktop/src/report-save.ts)
for receipt-selected, freshly hash-checked bytes and exclusive native-chosen destinations.
`SessionSidebar.tsx` adapts controls from
[sidebar-organization.ts](https://github.com/Peerframe/openbot/blob/010439bb9002fabb7e1facd8450ee85edbafa309/apps/web/src/sidebar-organization.ts)
and [SidebarItemMenu.tsx](https://github.com/Peerframe/openbot/blob/010439bb9002fabb7e1facd8450ee85edbafa309/apps/web/src/components/SidebarItemMenu.tsx)
for local search/title/group/pin/mute/recoverable removal. Source comments,
[third-party notices](../THIRD_PARTY_NOTICES.md) and the distributed `OPENBOT-LICENSE.txt` retain MIT
attribution. Upstream Server identities, channel state, downloads and persistence are not reused.

The material import/library and session history/store are independently implemented against moyyi's
runtime ports and existing immutable blobs. `owner_files.py`, `attachment_references.py` and
`attachment_purge_files.py` informed original-byte retention, reference protection and cleanup
failure cases; their service/SQL implementation is not copied. New schema3 metadata/material tables
retain transcript/effect format1. Current selection is separate from conservative references;
recycling does not erase history, revoke workspace reads or release references. Missing workspaces
still permit text-history inspection. No second loop, permission store or database is introduced.

Local PNG/JPEG previews require native bounds and remain display-only. Office/PDF preview shows
identity, with body reading left to the existing tools. There is no OCR, image model input, raw HTML
execution, remote image request or automatic fact check. Result saving does not yet implement the
inventory's arbitrary-original/template-save breadth. Message copy/quoted-reply and remaining global
preferences are still pending. Clean moyyi source `e0c26bd7` passed the external-package gates and
[three CI lanes](https://github.com/Peerframe/moyyi/actions/runs/40714161690). The native acceptance
app demonstrated PDF/DOCX import, Markdown tables, bounded PNG preview and receipt-backed saving;
normal1120×800/narrow780×560 windows remained scrollable. One independent Flash trial confirmed
all six frozen facts/artifact/constraint criteria in4 requests/93.743 seconds with zero retries.
Its first4-request failure remains sealed. Native clipboard import, organization, session recycle/restore
and actual process restart/history reopening also passed with no additional model calls. Final
daily integration/installation is recorded in PR50, separately from this acceptance package.
See the [M6 receipt](tasks/2026-10-28-desktop-m6.md) and [PR50](https://github.com/Peerframe/moyyi/pull/50).
These are moyyi evidence, not upstream test results or full transfer completion.
See [ADR0044](decisions/0044-desktop-material-library-and-history.md) and
[M6 operation/limits](desktop.md#materials-previews-and-complete-history-m6-candidate).

## Complete transfer inventory

The owner requested a plan on2026-10-28 to transfer all applicable personal-agent capabilities.
This inventory replaces the earlier UI-only candidate list as the coverage index; the copied-code
table above remains the record of **actual** reuse. Delivery order/acceptance live only in the
[roadmap](roadmap.md#current-sequence). Rows without an implementation status
remain plans/source findings. M6 rows separate source/offline coverage from the completed bounded
native/live evidence above. PR50 records final daily integration/installation; no row
claims complete transfer of all upstream behavior. The copied-code table retains its implementation
checkpoint wording; this section records subsequent acceptance evidence.

Source: OpenBot `010439bb9002fabb7e1facd8450ee85edbafa309` (MIT), inspected through fixed Git objects.
`W/` = [apps/web/src](https://github.com/Peerframe/openbot/tree/010439bb9002fabb7e1facd8450ee85edbafa309/apps/web/src),
`D/` = [apps/desktop/src](https://github.com/Peerframe/openbot/tree/010439bb9002fabb7e1facd8450ee85edbafa309/apps/desktop/src),
`S/` = [apps/server-python/src/openbot_server](https://github.com/Peerframe/openbot/tree/010439bb9002fabb7e1facd8450ee85edbafa309/apps/server-python/src/openbot_server),
`P/` = [packages](https://github.com/Peerframe/openbot/tree/010439bb9002fabb7e1facd8450ee85edbafa309/packages).
Paths below name representative actual entry points; follow their consumers and tests before
copying. The inventory groups all product roots by capability/ownership; it is not a line-by-line
repository audit. Tests cited by source inspection were not executed for this planning delivery.

Disposition: **covered** = existing moyyi behavior/adaptation, with acceptance limits in the system
overview; **adapt** = reuse a small view/helper; **reimplement boundary** = preserve useful behavior
and failure cases while replacing Server/Node/storage authority; **excluded** = stated product
boundary; **unready upstream** = declaration/qualification fixture, not shippable implementation;
**owner deferred** = applicable but not scheduled by owner decision (see the
[roadmap](roadmap.md#current-sequence)); it can be proposed again.
Every new discovery gets a row here rather than an untracked optional backlog.

| ID / capability | Fixed source and actual scope | Disposition / destination / delivery |
|---|---|---|
| C01 Document body parsing | `S/parser_worker.ts`, `S/attachment_processing.py`: bounded seven-format extraction; separate password/OCR/media paths | **Covered**: `src/runtime/document-worker.ts` and documents plugin; retain current pinned parser graph and evidence. Remaining media paths are P12–P14. |
| C02 Public source text | `S/public_source.py`, `S/work_product_web.py`: bounded public HTTPS text and separately configured search | **Covered** for HTML lessons/fetch/M5; desktop search is P15. Keep current web capability and source records. |
| C03 Approvals, operation history and results | `W/components/{ApprovalCard,ArtifactCard,TaskSteps,WorkTasksScreen}.tsx` | **Covered** partial view adaptations in desktop renderer, with own policy/receipts; extend only remaining P01–P06 behavior. |
| C04 Loop and execution guarantees | `P/harness/src/openbot_agent_runtime/{executor,guard,catalog}.py`, `S/work_corrections.py`, `S/work_reconciliation.py`, `S/work_product_result.py` | **Covered by own core**: reuse relevant cancellation, budget, revoke, late-result and unknown-effect cases. Do not add another loop/reviewer or treat model result review as fact certification. |
| P01 External file selection/import | `W/components/ComposerAttachmentPicker.tsx`, `W/composer-context.ts`, `S/owner_files.py`, `S/product_attachment_routes.py`: picker/drop/image paste, cancellation and bounded original bytes | **Candidate implemented; native picker/clipboard verified; Finder drag/drop boundary offline-qualified (M6)**: native picker/drop/explicit clipboard PNG and host import over runtime-owned blobs. Immutable original/hash plus unique workspace copy; no upload, model call or parent-directory permission from selection. |
| P02 Managed materials and retention | `W/components/{AttachmentsManager,SettingsStorage}.tsx`, `S/attachment_references.py`, `S/attachment_purge_files.py`, `S/storage_service.py` | **Candidate implemented; offline lifecycle-qualified; native import/selection restart verified (M6)**: library/current selections/conservative references, recycle/restore and guarded unreferenced purge. Optional30-day housekeeping defaults off and only soft-recycles eligible unreferenced materials; it never deletes arbitrary project files or shared blobs. |
| P03 Readable rich output and images | `W/components/{RichMessage,AttachmentPreview,ArtifactCard}.tsx`: limited Markdown and PNG/JPEG preview; not a general Office/PDF renderer | **Bounded native preview evidence complete; integration/installation receipt in PR50 (M6)**: escaped Markdown and host-checked bounded local PNG/JPEG; inert HTML/links/remote images and actual report receipt/hash checks. Seven-format material preview is identity-only; no OCR or image model input. |
| P04 Save original/result | `D/report-save.ts`, `D/attachment-save-dialog.ts`, `W/components/ShareConversationDialog.tsx`: original/PNG/Markdown/template saving, not hosted conversation sharing | **Native result-save evidence complete; integration/installation receipt in PR50 (M6 subset)**: receipt-backed native Save dialog, fresh bytes/digest, exclusive creation and cancel. Original/template saving remains pending for M13; no hosted sharing. |
| P05 Complete history and organization | `W/sidebar-organization.ts`, `W/components/{SidebarItemMenu,ChannelWorkspace}.tsx`: pin/group/hide/mute/name search, revision-bound rename and cursor history | **Candidate implemented; installed-copy history/organization and native session lifecycle/reopen passed (M6)**: local metadata, complete display-history pages/long-message chunks, revision-checked organization and recoverable removal; references retained. Name/prompt-excerpt search is not full-text indexing; mute is app completion-announcement only. No channel/member identity model. |
| P06 Message and task conveniences | `W/components/{MessageActionBar,TaskActions,ApprovalStack}.tsx`: copy, quoted reply, details and cancellation/correction UI | **Partly covered; remaining adaptation pending (M6/M13)**: existing cancellation/draft actions retain own record/effect IDs; M6 adds long-message inspection. Copy/quoted reply is not implemented by that inspection. No automatic retry or social/team reactions. |
| P07 Model connection management | `W/components/{ModelConnectionsDialog,ModelSelector,SettingsModelServices}.tsx`, `S/model_connections.py`, `S/model_presets.py` | **Adapt UX + reimplement boundary**, M7: desktop/settings and Keychain-backed named connections. Fixed presets have implementation, not proof every service works. Endpoint discovery and completion tests remain distinct. |
| P08 Model protocol adapters | `S/product_model.py`, `S/work_product_model.py`, `S/work_openai_model.py`: actual SDK single-step adapters behind11 presets | **Reimplement only missing compatibility**, M7: existing ModelClient/provider plugins, explicit API/capability fixtures. Preserve reasoning/tool IDs/usage/stream termination; never import Python SDK loop or infer all11 endpoints are live-qualified. Flash remains default. |
| P09 Personal instructions/preferences | `W/components/{EmployeeDescriptionForm,EmployeeProfileView}.tsx`, `S/owner_preferences.py` | **Adapt + reimplement boundary**, M7: one local personal configuration/context source, source/version visible. Description/appearance cannot grant capabilities; no Bot identity graph. |
| P10 Skills catalog/import/review | `W/components/{EmployeeSkillImport,EmployeeSkillReview,SettingsSkills}.tsx`, `S/{skill_yaml,employee_knowledge,knowledge_runtime,work_product_knowledge}.py` | **Adapt + reimplement boundary**, M7: skill library, immutable versions/digests, preview, enable/revoke and bounded discovery/read_skill. Existing YAML safety/explicit loading retained; no automatic script/reference-directory execution. |
| P11 Safe template portability | `W/components/{SettingsTransfer,ExportEmployeeDialog,ImportEmployeeDialog}.tsx`, `S/employee_portability{,_format,_inputs,_publisher}.py`, `P/employee-publisher` | **Owner deferred 2026-10-28.** **Adapt parsers/UX + new local format boundary**, M7: allowed personal settings and reviewed licensed self-contained Skills, preview digest, quarantine and disabled defaults. Exclude source identity, secrets, memories, history and authority. v1 metadata-only differs from explicit v2 single-SKILL.md content; the old REVIEWED_SKILLS doc lags this code. Signature is not execution consent. |
| P12 Local image OCR | `S/parser_worker.ts`, `S/attachment_processing.py`, `W/components/AttachmentActions.tsx`: PNG/JPEG OCR with offline English/Chinese data | **Adapt + reimplement sandbox lifecycle**, M8: documents/media capability and processing UI; independently pin/review language assets and limits. No whole-PDF rasterization or visual-layout promise. |
| P13 Secret PDF input / optional binary vision | `S/attachment_processing.py`, `S/model_media.py`, `S/work_product_attachment_reads.py`: transient PDF password and compatible explicit binary input routes | **Owner deferred 2026-10-28.** **Reimplement trusted boundary**, M8: native transient password handle never in tool params/history; provider capability gates and explicit data submission for selected image/PDF only. Current plaintext docs behavior remains default. |
| P14 Recording and transcription | `W/components/VoiceRecorder.tsx`, `D/microphone-policy.ts`, `S/model_media.py`: record/preview/discard attachment; explicit external transcription | **Owner deferred 2026-10-28.** **Adapt + reimplement boundary**, M8: microphone lifecycle separate from upload/paid transcription. No realtime voice agent or background microphone. Actual service/key acceptance remains separate from synthetic HTTP. |
| P15 Desktop search | `S/work_product_web.py`: configured search service, not arbitrary browser crawling | **Adapt settings over existing web plugin**, M9: selected backend/provenance/rate/bounds, independently checked result/source association. Existing fetch is not search acceptance. |
| P16 Browser observe/action/takeover | `S/{browser_gate,browser_sessions,work_product_browser,work_browser_page_actions}.py`, `apps/node/src/browser-host.ts`, `providers/docker/src/browser-task.ts` | **Adapt bounded patterns + reimplement local composition**, M9: browser plugin/runtime port and desktop approval/view. Native driver/isolation must pass an early installed feasibility gate. Node enrollment/Temporal/remote authority excluded; the Linux composition fixture is not a production installer. |
| P17 Reviewed knowledge/memory | `W/components/{KnowledgeReviewPanel,EmployeeEvolutionArchive,SettingsMemory}.tsx`, `S/{employee_knowledge,knowledge_runtime,work_native_knowledge}.py` | **Adapt + reimplement boundary**, M10: one personal knowledge/memory plugin/store with reviewed candidates and source/revision validation. Existing hint/catalog selection is not semantic/vector RAG. Preserve Hermes attribution; no autonomous acceptance. |
| P18 MCP tools/resources/prompts | `S/{plugin_service,plugin_transport,plugin_inputs,plugin_catalog,work_product_plugins}.py`, `W/components/{PluginManagerPanel,PluginGrantEditor,PluginToolList}.tsx` | **Adapt UX/negative cases + reimplement plugin port**, M11: actual Streamable HTTP, explicit grants/descriptor digests and revoke. Source does not provide stdio/OAuth/sampling/permanent GET-push; these are not promised by this transfer. |
| P19 Interactive MCP Apps | `W/components/PluginAppFrame.tsx`, `W/plugin-app-sandbox.ts`, `S/plugin_service.py` | **Owner deferred 2026-10-28.** **Adapt + reimplement isolated host**, M11 after P18: source AppBridge wires bounded resource reads and denies unwired host capabilities; preserve that scope. Separate frame and identity/origin validation, no default device/network/privileged IPC. Broader in-frame tool execution is new work, not inherited support. A demo or refusal-only path does not pass success acceptance. |
| P20 Fixed-interval schedules | `W/components/AutomationsScreen.tsx`, `S/automation_store.py`, `S/work_product_service.py` | **Adapt views/algorithms + local persistence**, M12: one scheduler client submitting through runtime; durable claim/non-overlap/coalescing/pause/cancel distinctions. No calendar cron/DST guarantee, second loop or implied tool authority. |
| P21 Desktop notifications | `D/desktop-notifications.ts`, `W/system-notifications.ts`: bounded nonforeground notices and navigation | **Adapt**, M12: explicit preference and sensitive-text policy; click opens actual run, never grants approval. Include foreground/background and denial checks. |
| P22 Preferences, menus and accessible dialogs | `W/workspace-preferences.ts`, `W/components/{Dialog,DesktopSettingsScreen,SettingsGeneral,SettingsSearch}.tsx`, `W/components/useModalDialog.ts`, `D/navigation-menu.ts`, `D/platform-preferences.ts` | **Remaining preferences owner deferred 2026-10-28.** **M6 affected native import/save controls verified; daily installation pending**. M13 preferences remain planned: font/density/send key/focus/reduced motion, side panels,12/24-hour format,Dock badge/native menus and shortcuts. Login/background startup stays opt-in/platform-gated; no untested theme/platform claims. |
| P23 First-run diagnostics/help | `W/components/{Onboarding,DesktopInstallScreen,DesktopConnectionScreen}.tsx`, `D/desktop-support-links.ts` | **Covered + adapt gaps**, M7/M13: local connection/runtime diagnostics and bounded safe help; exclude Server/PostgreSQL/login install flow. Startup success is not model acceptance. |
| P24 Audit inspection/export | `W/components/SettingsSections.tsx`, `S/audit_records.py` | **Owner deferred 2026-10-28.** **Adapt views + own event projection**, M13: filters/paging, bounded CSV with formula escaping and content/privacy controls. No invented historical events, raw reasoning or secrets. |
| P25 Maintenance/data recovery | `D/{profile-compatibility,restricted-json-file,local-content,bounded-response}.ts`, related tests | **Covered + M6 schema3 extension offline-qualified; paired daily backup/install pending**: backup includes material blobs; private-copy restore and schema-compatible software rollback preserve data. M13 extends qualification to later stores. An older schema2 app requires its pre-upgrade data backup, never an implicit downgrade. |
| P26 Execution helpers and reusable failure tests | `S/work_product_commands.py`, `S/work_command_*.py`, `apps/node/src/command-*.ts`, `experiments/linux-execution/protected_host.py` | **Covered + selectively port cases** across stages: fixed Linux/input/output offline execution is not a general local PTY. Retain moyyi file/shell/undo implementations; useful deadline/lost-ACK/output integrity cases can strengthen them without remote signing/control-plane dependencies. |
| P27 Shared utilities, schemas and contributor tooling | `P/{config,logging,domain,protocol,work-contract-generator,provider-sdk,provider-conformance-runner,windows-secret-acl}`, source tests/CI/scripts/notices | **Selective helper/test reuse**, each affected stage/M13 final sweep. Inspect exact file/license and consumer; target moyyi's existing contracts/checks. Do not import entire packages, generated old DTOs, maintenance frameworks or Windows support claims from a useful helper. |

### Explicit exclusions and non-shippable upstream paths

| ID / source family | Reason and retained value |
|---|---|
| X01 `apps/server-python` control/login/identity/routing; `P/db`, old migrations; `apps/server`, frozen TS oracle | Server/Bot/team/channel/Owner authority and SQL data model conflict with single local core. Server capability functions above are individually eligible; excluding the control plane does not exclude all Python helpers. Oracle cases may be test references, never product fallback. |
| X02 `apps/node`, `apps/worker-host-{macos,windows}`, `P/python-node-runtime`, Worker enrollment/signing/remote profiles; Temporal composition | Remote multi-host operating architecture is outside the personal local product. Extract independently useful containment/cleanup/validation cases through P16/P26/P27; retain native default and current platform scope. |
| X03 `work_collaboration*`, Bot/member/channel social UI, employee ownership transfer, `P/office-plugin` | Multi-Agent routing/team identity/office simulation excluded. Useful presentation primitives still go through P06/P09; portable personal templates P11 are not employee/account ownership transfer. |
| X04 `providers/{cua,lume,coder}/src/index.ts` | **Unready upstream**: ComputerProvider metadata/capability declarations without an execution implementation. Not transferable working macOS CUA, VM or coding agents; a future implementation would be new work with separate scope. |
| X05 `experiments/browser-execution/composition` and other execution experiments | Real bounded Linux/synthetic HTTPS qualification exists, but not an installed production Host or cross-platform service. Reuse the demonstrated cases for P16/P26; never count experiment success as moyyi native/product acceptance. |
| X06 `D/{desktop-updates,signed-update-port}.ts`, signing/installer scripts and other-platform distributions | Preserve reviewed signature/publisher/hash/confirmation failure cases through P25/P27. Public feed, signing/notarization credentials, automatic updater and Windows/Linux desktop release are outside current local delivery authority. No public publishing occurs during transfer. |
| X07 docs, demo/marketing images, brand assets, example services, fixtures and dependency trees | Documentation/tests are references; generic assets need license/branding review in the actual view port. `P/mcp-example` is a fixture/reference, not the user's extension service. No wholesale node_modules/venv/locks/private assets/imported third-party skill bundles. |

The top-level product roots are accounted for: Web/Desktop capability rows; Python Server capability
rows plus X01; Node/Worker roots X02; providers P16/P26/X04; harness C04; shared packages P27;
employee-publisher P11; DB X01; office-plugin X03; examples/experiments/docs/tests X05/X07.
A newly discovered eligible leaf must be added to the matching row before claiming closure.

### Uncommitted upstream source queue

The OpenBot checkout had172 dirty entries during this inventory. Only file names/status were
used to identify affected families; their uncommitted contents are **not** asserted to be covered
by the fixed revision, and no owner file was committed, reverted or copied. Relevant families:

- Model dialogs/selectors/settings, `model_connections.py`, `work_product_model.py` and shared
  model contracts: revisit P07/P08 after source qualification.
- `attachment_processing.py`, attachment client, `employee_portability.py`, `audit_records.py`
  and tests: revisit P01/P02/P11/P12–P14/P24.
- Desktop settings/main/native and Python service/proxy/packaging files, lockfile, CI/production
  graph: inspect for useful P22/P23/P25/P27 changes; do not import the changed service architecture.
- Work composition/task profiles, identity/Worker state, workspace/HTTP contracts and database
  changes: classify new capability deltas versus X01/X02 before including anything.

At each port, use a new reviewed fixed commit or an explicitly captured content-hash snapshot
for relevant changes and record both base and delta. Do not silently drop this queue, reset dirty
files, manufacture a source commit, or treat old documents as more authoritative than actual
versioned implementation. Source access/credential/platform blockers remain visible until resolved.

## DeepSeek Harness

DeepSeek Harness (DSH, [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness),
MIT) has been moyyi's first reference since 2026-10-29. How to study it is described in the
[moyyi-learn-from-dsh](../.agents/skills/moyyi-learn-from-dsh/SKILL.md) skill.

Rules: adapt designs, model-visible text and failure cases by rewriting them against moyyi's
contracts; never add Cordis or a DSH package as a dependency; record every adapted file below
with the DSH commit and path in the same change.

| Date | DSH commit | What moyyi took | Where in moyyi |
|---|---|---|---|
| 2026-10-24 | `22ddee37` | Plugin design lessons only (one seam per capability, owned registrations, reported plugin failures); no code | [ADR 0005](decisions/0005-plugins.md) |
| 2026-10-27 | `1f81c047` | Provider source check only; no code | [Harness comparison](research/harness-comparison.md#dsh-preview-source-check-2026-10-27) |
| 2026-10-29 | `f3803c96` | Skill structure and wording ideas for `moyyi-model-experience`, `moyyi-desktop-ui` and `moyyi-check` (from `agent-experience`, `dsh-client-ui-ux`, `dsh-pre-push-checks`), rewritten; AGENTS.md layout | [`.agents/skills`](../.agents/skills/), [AGENTS.md](../AGENTS.md) |

Delivery-specific source maps below distinguish earlier code adaptations from later design-only
references. The dated briefs define scope; implementation alone does not establish acceptance.

### Delivery one source map (2026-10-29)

All rows use `deepseek-ai/deepseek-harness` commit
`f3803c96974ad4a94195fb97e5c637e9c2a3afe3`, MIT. The full license is carried in
`THIRD_PARTY_NOTICES.md` (packaged) and `src/plugins/todo/DEEPSEEK-LICENSE.txt`.
No upstream code was executed and no DSH dependency was installed. This map describes adaptation,
not evidence that the candidate improves task quality.

| moyyi file | Pinned DSH source | Adaptation |
| --- | --- | --- |
| `src/plugins/todo/index.ts` | `packages/todo/tool-todo/src/index.ts` | Whole-list schema, trimmed unique content, single active task and count summary, rewritten for the tool contract |
| `src/plugins/todo/index.test.ts` | `packages/todo/tool-todo/tests/tool-todo.spec.ts` | Validation and whole-list failure cases rewritten |
| `src/plugins/todo/README.md` | `packages/todo/tool-todo/README.md` | Model experience and documented constraints |
| `src/runtime/tool-results.ts` | `packages/guard/repeat-tool-reminder/src/index.ts`, `packages/guard/timeout-policy/src/index.ts`, `packages/spill/spill-policy/src/index.ts` | Canonical repeated calls, cooperative deadline and capture ideas; core/runtime ports replace waterfalls |
| `src/contracts/tool-output.ts` | `packages/spill/spill-policy/src/retention.ts`, `src/notice.ts`; `packages/compaction/compaction-tool-result-pruner/src/index.ts` | Bounded head/tail presentation, discoverable handle and older-result projection design |
| `src/plugins/tool-output/index.ts` | `packages/spill/spill/README.md` | Session ownership and bounded retrieval; new moyyi capability, not filesystem path authority |
| `src/plugins/tool-output/README.md` | `packages/spill/spill-policy/README.md`, `packages/compaction/compaction-tool-result-pruner/README.md` | Model/token/cache/limit documentation |
| `src/core/executor.ts`, `src/core/index.ts` | `packages/guard/timeout-policy/src/index.ts`, `packages/spill/spill/README.md` | Cancellation settlement and publication ordering design; new core guarantees and typed references, not copied loop implementation |
| `src/context/index.ts` | `packages/compaction/compaction-tool-result-pruner/src/index.ts`, `packages/todo/tool-todo/README.md` | Pressure-only projection and retaining a todo summary; original log unchanged |
| `src/plugins/default-instructions/index.ts`, `README.md`, `index.test.ts` | `packages/core/system-prompt/README.md`, `packages/context/agent-instructions/README.md`, `packages/preset/persona/README.md` | Separate stable identity/safety sections; no ancestor/global instruction discovery |
| `src/plugins/fs/index.ts`, `README.md` | `packages/core/system-prompt/README.md` | Tool guidance belongs in descriptions; no execution logic copied |
| `src/runtime/session-facts.ts` | `packages/context/time-context/README.md` | Session snapshot of host facts; no per-step clock injection |
| `src/plugins/provider-deepseek/index.ts`, `index.test.ts` | `packages/llm/llm-deepseek/src/transport.ts` | All 5xx classified as server unavailability; no retries added |
| `src/plugins/provider-deepseek/README.md`, `docs/deepseek.md` | `packages/llm/llm-deepseek/README.md`, `src/serialize.ts`, `src/translate.ts`, `src/replay.ts`, `src/defaults.ts`; `packages/llm/token-meter/README.md`, `src/turn-usage.ts`, `src/usage-projection.ts`; `docs/deepseek-llm-api-wire-extensions.md` | Protocol comparison; Responses, existing limits and recorded usage remain authoritative |

| `evals/replay/sequence-client.ts`, `sequence-client.test.ts`, `README.md` | `packages/test-support/llm-replay/README.md` | Eval-only ordered responses and separate request-difference diagnostics; production strict replay unchanged |
| `evals/replay/replay.test.ts` | `packages/test-support/agent-loop-testkit/README.md` | Real-runtime task/result conformance with public recordings; original task checkers retained |

The typed persisted reference, SQL migration, desktop version pairing and session access checks
are original moyyi integration. They are covered by ADR 0046 rather than copied from a DSH store.

### Delivery three design references (2026-10-30)

Every row uses DeepSeek Harness commit
`f3803c96974ad4a94195fb97e5c637e9c2a3afe3`, MIT. These are design, model-experience and failure-case
references. Delivery three copies no DSH implementation, UI component or fixture code and installs
no DSH/Cordis dependency. Existing adapted OpenBot primitives and the delivery-one todo tool keep
their earlier provenance; reusing them does not change their source or license.

| moyyi destination | Pinned DSH source | Decision and boundary |
| --- | --- | --- |
| `apps/desktop/features/settings/renderer/{Connections,SettingsFields,SettingsDialog,index}.tsx`, `host/settings.ts` | `packages/client/ui-settings-models/README.md`, `packages/client/ui-model-selection/README.md` | **Borrow** named settings/selection concepts. UI and private format 2 storage are original moyyi implementation; no dynamic providers, custom endpoints, upstream account layer or credential migration code. |
| `src/contracts/{model,protocol}.ts`, `src/core/index.ts`, `src/plugins/provider-{deepseek,kimi}` | `packages/llm/llm/README.md`, `packages/llm/llm-deepseek/src/transport.ts`, `tests/stream.spec.ts` | **Borrow** structured failure categories and 402/429 cases. Kimi's exact structured quota type follows its official API documentation. **Reject** free-text quota guesses, automatic retries and account fallback. |
| `src/context/index.ts`, both provider codecs, `src/runtime/model-recording.ts`, `tests/provider-connection-continuation.test.ts` | `packages/llm/llm/README.md`, `packages/llm/llm-deepseek/src/serialize.ts` | **Borrow** origin/replay isolation and tool pairing concepts. Existing persisted origins support original moyyi request projection; foreign wire-ID mapping never rewrites stored records. |
| `src/plugins/skill-library/{index.ts,index.test.ts,README.md}`, `src/runtime/personal-skills.test.ts` | `packages/skill/skill/README.md`, `src/index.ts`; `packages/skill/tool-skill/README.md`, `src/index.ts` | **Borrow** summary discovery, exact-name body loads, stale-selection checks and explicit empty availability. Add original immutable SHA-256 binding and pre/post-read revocation checks under moyyi policy. |
| `src/contracts/plugin.ts`, `src/context/{index,evidence-answer}.ts` | `packages/skill/tool-skill/README.md`, `src/index.ts` | **Adapt** current catalog placement after stable context. DSH retains replacement catalog messages; moyyi records a current request suffix. No durable catalog event or promise of full old-tail cache reuse. |
| `src/plugins/personal-instructions`, `apps/desktop/features/preferences`, `host/preferences-storage.ts` | `packages/skill/skill-filesystem/README.md`, `src/index.ts` | **Reject** automatic root discovery/watch and referenced resource access. Personal-file storage, reviewed native imports and the bounded trusted callbacks are original integration; only selected `SKILL.md` is copied. |
| `src/plugins/web/deepseek-search.ts`, `src/runtime/web-deepseek.ts`, `src/runtime/web-deepseek.test.ts` | `packages/web/web-search-deepseek/README.md`, `src/provider.ts`, `tests/deepseek.spec.ts` | **Borrow** fixed auxiliary search, structured-only source extraction, URL deduplication and failure cases. **Reject** generic endpoints, account authentication and citation joining; retain the approved query-only request and real reported usage. |
| `apps/desktop/features/todos/renderer/index.tsx`, `features/web/renderer/SearchCard.tsx` | `packages/client/ui-conversation/README.md`, `packages/todo/tool-todo/README.md` | **Borrow** dedicated conversation-node and whole-list presentation concepts. Original moyyi React views project existing records; model-reported todo progress is explicitly unverified, and absent search usage stays unknown. |

The decisions are detailed in ADRs [0048](decisions/0048-connection-continuation.md),
[0049](decisions/0049-personal-instructions-and-skill-library.md) and
[0050](decisions/0050-deepseek-native-search.md). Desktop file checks, backup/rollback compatibility,
trusted host exports and external-package synthetic checks are moyyi integration, not inherited
upstream safety or live-service guarantees.
