# 0002: Local storage

Status: accepted (D1, owner decision 2026-10-25); implementation pending

## Decision

- One local SQLite database plus a content-addressed blob directory. moyyi owns the schema
  and migrations. Distributed storage and multi-device synchronization are outside this decision.
- Three authoritative record kinds live in the same database: the transcript tree, the effect
  journal and session/run state tables. Related updates commit in one transaction.
- Transcript entries are immutable and linked through `parentId`. Editing or compacting creates
  a new entry/path and retains the originals; a branching UI is not a first-release requirement.
- The request a model saw is stored as one content-addressed blob per rendered message
  (`RenderedRequestRef`), so consecutive requests share their unchanged history.
- Large payloads live outside the database, addressed by sha256 and deduplicated. Publish blobs
  durably before committing references to them. A failed transaction may leave an unreferenced
  blob, but an acknowledged record must not point to a blob that was never made durable.
- Backups must cover a consistent database snapshot and its referenced blobs, not just the
  SQLite file. Retaining transcript history does not override the user's explicit deletion
  policy; see [ADR 0006](0006-security-boundaries.md).
- The persisted format is versioned (`PERSISTED_FORMAT_VERSION`) and locked by typed fixtures in
  `src/contracts/persisted/fixtures/`. The separately accepted D2 pre-storage amendment must
  finish before batch 3; see the [handoff prerequisites](../tasks/2026-10-24-codex-handoff.md#31-开始批次-3-之前).

### Durability

- Use WAL with `synchronous=FULL` for committed transcript, effect and state records, including
  ordinary completed messages. This replaces the earlier proposal of NORMAL for ordinary writes.
- Keep `StoreBatch.durability`'s `normal` and `before_side_effect` intent labels. Both receive
  FULL durability in v1; `normal` must not be interpreted as the SQLite NORMAL setting.
- Persist the `started` record and everything recovery needs before executing the action.
  A durability failure prevents execution. No checkpoint-only substitute is selected.
- Streaming token deltas need not be committed individually. Completed parts and interrupted
  assistant messages follow the architecture's recording rules.

The tradeoff is more disk synchronization per committed transaction. Commit related records
together rather than weakening the default guarantee. SQLite's WAL + FULL durability depends on
the operating system, filesystem and hardware honoring synchronization; a process-kill test
does not prove survival of physical power loss on every device.

### Concurrency and recovery

- One writer process per data directory, enforced by an OS file lock.
- One active run per session; writes to the same workspace require an exclusive write lease
  and are serialized across sessions. Independent workspaces may progress independently.
  An OS sandbox remains a separate concern.
- A crash after an action starts can leave its outcome unknown. Reconcile using evidence; never
  automatically replay an unknown effect. No exactly-once side-effect guarantee is made.

## Why this design

SQLite transactions give the three record kinds one commit boundary without requiring an
event-sourcing system with permanently compatible reducers. The transcript tree retains the
history needed for edits and compaction. Separate blobs avoid duplicating large unchanged
request content, at the cost of coordinating publication, backup and eventual cleanup.

## Implementation choices, not new owner decisions

Batch 3 compares `node:sqlite` (first candidate) and `better-sqlite3` with evidence for WAL,
FULL, rollback, locking and packaging. The driver and supported filesystem/lock implementation
must be recorded before that implementation is accepted; they are not selected by this ADR.
Exact table layouts, blob publication/backup mechanics and lock tests belong to the storage
implementation brief. JSONL export remains a follow-up, not a batch 3 prerequisite.

This ADR records the owner's decision; it does not authorize batch 3 or edits to
`src/contracts/persisted`. No storage guarantees are implemented by this documentation change.

## Evidence

Reviewed 2026-10-25: SQLite's [synchronous settings](https://www.sqlite.org/pragma.html#pragma_synchronous)
and [WAL documentation](https://www.sqlite.org/wal.html). No code was copied or adapted.
