# ADR 0039: Desktop controlled changes, checks and recovery

Status: accepted; M3 feature acceptance evidence complete2026-10-28. Functional repair/recovery
passed in a separately authorized live retest. Its extra DOM explanation contains an error, and
the first live repair failure remains sealed. Final integration/installation coordinates are
owned by the [PR #46 delivery receipt](https://github.com/Peerframe/moyyi/pull/46).

## Problem and decision

The installed [M2 baseline, PR #45](https://github.com/Peerframe/moyyi/pull/45), provides material
selection and exact report creation. The next user outcome is to inspect a proposed edit, deny
or approve it, run a supported check, reopen interrupted work and undo a recorded file change.
Expose the existing core/runtime guarantees through the same desktop client. Do not add a second
task engine, direct effect executor, Server state model or implicit retry.

## Authority and execution

- File modification and Node checks are independent, initially disabled grants for the selected
  workspace. A named main-process bridge uses native confirmation and rechecks session/workspace
  afterwards; generic renderer commands cannot enable them. The host changes permissions only
  while idle, closing and recreating the runtime over the same SQLite store.
- Both grants reset when creating/reopening a session or configuring the model. Changing grants
  clears the exact report target; selecting a report target removes the broader grants. A view
  of history or a prior approval never recreates current authority. Worker failure clears the
  bridge's active grants, target and inspections.
- Snapshot-backed `create`, `edit` and `undo` use the existing write policy and exact digest-bound
  approvals. Checks use the existing process policy, native sandbox and supported Node toolchain,
  with a read-only workspace and no network. Each proposed command still requires approval.
  A check grant does not permit command-based file changes or installation of dependencies.
- The existing `discoverNodeToolchain` is exported through the public runtime entry for the
  desktop host. No new core I/O port, persisted schema, provider default or dependency is added.

The undo button prepares a user-editable request from a successful file receipt's actual
`snapshotId`; it neither executes the effect nor sends the request. The check button likewise
prepares ordinary editable intent, without a free-form command execution bridge. Sending either
request consumes the normal model budget and uses the existing tool/approval loop. For multiple
changes the user can review and request the actual snapshots in reverse order. Cancellation stops
further work; it does not roll back already completed changes.

## Observations and presentation

Project all entries of the existing20-effect `session.results` page, not just successful report
creates. Preserve run/effect identity, state and optional matched receipt. File receipts retain
path/snapshot/before-and-after hashes; process receipts retain exit code, termination and output
truncation. A failed, cancelled or unknown record must remain visible even without a receipt.
No receipt, command ACK, normal model stop or exit code0 proves that the user's task is correct.

File inspection performs a fresh guarded hash comparison. `current` means bytes matched when
checked; `absent` means the file is absent as the receipt expects. `missing`, `changed` and
`unavailable` are separate outcomes. This does not check mode or certify that undo will succeed;
the actual undo tool rechecks current bytes/mode and refuses changed targets. There is no poll or
automatic action replay. Reopened history explains that the old grants were reset and unknown
outcomes require read-only inspection. A cancelled started process can retain an unknown effect
and workspace lease. Subsequent writes may remain protectively blocked even after reauthorization;
inspection does not release the lease and this UI adds no force-retry/unlock control. Cancelling
only a pending approval does not imply an unknown started effect or prevent later undo of a
settled earlier edit after explicit reauthorization.

Retain the existing M2 layout, native dialogs, subscription receiver and action lock. Use the
OpenBot fixed MIT revision `010439bb9002fabb7e1facd8450ee85edbafa309` only for the narrow folded
history-list view. Source and tests reviewed:

- [TaskSteps](https://github.com/Peerframe/openbot/blob/010439bb9002fabb7e1facd8450ee85edbafa309/apps/web/src/components/TaskSteps.tsx)
  and [tests](https://github.com/Peerframe/openbot/blob/010439bb9002fabb7e1facd8450ee85edbafa309/apps/web/src/components/TaskSteps.test.tsx):
  adapt first-three/last-six folding; fix10–12-row loss and replace unconditional done markers.
- [WorkTasksScreen](https://github.com/Peerframe/openbot/blob/010439bb9002fabb7e1facd8450ee85edbafa309/apps/web/src/components/WorkTasksScreen.tsx)
  and [tests](https://github.com/Peerframe/openbot/blob/010439bb9002fabb7e1facd8450ee85edbafa309/apps/web/src/components/WorkTasksScreen.test.tsx):
  reuse interaction lessons for unknown outcomes, lost acknowledgement and late responses;
  do not copy polling, WorkSnapshot, Server revisions or Bot identity.
- [WorkTasksEntry](https://github.com/Peerframe/openbot/blob/010439bb9002fabb7e1facd8450ee85edbafa309/apps/web/src/components/WorkTasksEntry.tsx):
  read retry invalidation only; login/deep-link routing is outside this local workflow.

The upstream tests were read, not executed. Adaptation and MIT notices are recorded in
[provenance](../openbot-provenance.md#desktop-m3-adaptation). No dirty OpenBot files are reused.

## Evidence and exit gate

The external bundle source `4274de2` passed the installed-copy M3 gate (10 cases/33 synthetic
requests) and the instrumented native gate (9 cases/7 synthetic requests). The QA app keeps the
candidate main/preload/renderer/host and explicitly substitutes only a synthetic worker with
isolated data; this native gate does not establish live semantics. Writes/shell evals passed8/8
each. Final source check passed131 files/2644 tests; checkpoint `33ed114` CI passed all three jobs.

The first live repair failed before its functional check; its5-request repair/recovery group
remains sealed. One separately authorized pair used the same original task/source/prompt/standards
and its own shared12-request ceiling: repair5 requests/51.047s, then reopen with reset grants and
reverse undo of both actual snapshots3 requests/30.123s. The unchanged functional checker passed;
original bytes/mode were restored, other inputs/checker/canary stayed unchanged, and no retry ran.
Daily Flash3/120 defaults were restored.

Functional/recovery PASS does not mean the whole answer is correct: the repair answer wrongly
claimed that a null `removeEventListener` callback throws in real DOM. The callback is nullable
and no matching listener means no removal under the [DOM standard](https://dom.spec.whatwg.org/#dom-eventtarget-removeeventlistener).
The [delivery record](../tasks/2026-10-26-optimization-plan.md) retains that error, both live groups,
fixture corrections and actual check history. No new request was made to repair the explanation;
original source-analysis FAILs remain unchanged. Final integration and owner installation are
recorded separately in [PR #46](https://github.com/Peerframe/moyyi/pull/46); M4 is not claimed.

Keep the [roadmap's fixed PR28 workflow](../roadmap.md#quality-lane-independent-progress-explicit-final-gate):
two runs, each8 requests/180 seconds/8192 output, shared12 HTTP and zero retries, original
listener-leak source/checker, functional repair and two byte/mode-exact undos. Native denial,
stale approval, cancellation/reopen and no-replay checks are additional interaction evidence.
Do not replace the functional checker with a successful command or file existence, and do not
rescore the original source-analysis failures. Feature acceptance evidence is complete within these limits. Final package, CI and owner
installation coordinates belong in the delivery receipt; they are not implied by source checks.
M4 remains separate.
