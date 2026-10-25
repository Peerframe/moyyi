# 0002: Local storage

Status: accepted (D1, owner decision 2026-10-25); batch 3 implementation on its review branch

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

## Batch 3 implementation decision (2026-10-25)

Use **`node:sqlite`** from the existing Node 26 runtime, with no new package dependency.
Reviewed API/source snapshots: [Node v26.0.0](https://github.com/nodejs/node/blob/v26.0.0/doc/api/sqlite.md)
and [v26.12.0](https://github.com/nodejs/node/blob/v26.12.0/doc/api/sqlite.md). The module is still
Stability 1.2 (release candidate); v26.12.0 makes `DatabaseSync` a compatibility alias. The
implementation uses the common synchronous constructor, prepared statements and transactions.
Runtime compatibility is checked locally and in the repository's existing Node 26 CI lane;
this decision does not introduce a newer Node requirement or upgrade a dependency.

The maintained alternative reviewed was
[better-sqlite3 v13.0.3](https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.3), released
2026-08-05, MIT licensed, Node >=22. Its
[build/test matrix](https://github.com/WiseLibs/better-sqlite3/blob/v13.0.3/.github/workflows/build.yml)
covers Node 26 and macOS/Linux/Windows, with native prebuilds. It supplies synchronous
transactions and backup, but adds native packaging/upgrade work without closing a batch 3
capability gap. It remains a replacement candidate if the built-in API becomes unsuitable.
The store port keeps this choice outside the core. No upstream or OpenBot code was copied.

- `data.sqlite` contains schema version 1, an application ID, persisted-format metadata,
  sessions, runs, immutable transcript entries, effects and workspace leases. Schema migration
  is transactional. Foreign/unversioned nonempty databases and unknown versions are rejected.
  Existing schema objects/DDL are checked, so missing indexes, altered constraints or added
  triggers cannot silently weaken the store. Future schema/data changes require explicit
  migrations; none is guessed or silently repaired.
- Both commit intent labels use WAL + FULL, with `fullfsync=ON` for SQLite's stronger macOS sync
  path. Foreign keys, a unique active run per session, and unique `(runId, callId)` effects are
  database constraints; the transaction also checks identities, parent/head ownership, cycles,
  compaction spans, legal effect transitions and approval digest changes.
- Run/session metadata is exposed through `StoreBatch` and `SessionSnapshot`, outside the
  frozen transcript/effect JSON contract. A run starts active, then completes or is interrupted.
  Interrupted runs retain unsettled effects and leases. Opening a store never resolves or
  executes them. Recovery orchestration remains batch 4.
- Workspaces use absolute real paths. Leases exclude other sessions using the same workspace
  or an overlapping parent/child workspace;
  started/unknown workspace-write and process effects must retain their lease. This is
  coordination, not an OS sandbox. The recorded holder may release a lease using its saved
  canonical path even after that directory has been moved/deleted.
- `writer-lock.sqlite` is a separate, non-authoritative SQLite connection held in DELETE
  journal mode with `BEGIN EXCLUSIVE` until close. SQLite's VFS holds the OS lock; contention
  fails immediately. There is no PID/timeout/heartbeat lock stealing. Never unlink, replace,
  rename, back up, or open/close its inode with native file APIs while a store is open.
  All connections use the same SQLite library, including contenders in the same process.
- Support is bounded to macOS/Linux on local filesystems that correctly implement SQLite
  locks and file/directory synchronization. Windows fails closed. Network filesystems and
  hostile same-user modification of the data directory are outside this boundary. The data
  directory is private (0700), files are 0600, and managed symbolic links are rejected.
- Blob publication writes a private temporary file, synchronizes it, creates a hash-named
  hard link without replacing existing content, then synchronizes the directory. References
  are checked for existence and SHA-256 integrity before commit and on read. Default limits
  are 64 MiB per blob (configurable at store construction), 4 MiB per canonical record, and the
  separate ADR 0003 replay limit. An orphan blob after interruption is allowed; a missing
  referenced blob is an error. Garbage collection is not implemented.
- Backup uses synchronous `VACUUM INTO` under FULL, copies only referenced verified immutable
  blobs, and publishes the complete private staging directory by rename and directory sync.
  Commits cannot interleave while this synchronous operation runs. Backup may pause the local
  writer; it is not a live raw-file copy. The destination must be new and outside the store.
  It reopens as a normal store, with its own process lock. Failures before rename do not publish
  the destination. If the final parent-directory sync fails after rename, `BackupDurabilityError`
  identifies the visible complete destination and leaves its durability explicitly unconfirmed;
  callers must not treat that rejection as success or assume no destination exists. An abruptly
  killed process may leave staging/orphan files or an unacknowledged complete publication.

See the [store API](../store.md) and [current implementation handoff](../tasks/2026-10-25-v1-and-storage.md).
JSONL export, garbage collection, encryption, recovery orchestration and schema upgrades beyond
the initial migration remain later work. The separate owner authorization is in the task brief.

## Evidence

Reviewed 2026-10-25: SQLite's [synchronous settings](https://www.sqlite.org/pragma.html#pragma_synchronous)
and [WAL documentation](https://www.sqlite.org/wal.html), [EXCLUSIVE transactions](https://www.sqlite.org/lang_transaction.html),
[locking constraints](https://www.sqlite.org/howtocorrupt.html#_file_locking_problems),
[VACUUM INTO snapshot and sync behavior](https://www.sqlite.org/lang_vacuum.html), and
[backup guidance](https://www.sqlite.org/backup.html). No code was copied or adapted.

Local macOS arm64 evidence uses Node v26.0.0 / npm 11.12.1. SQL `sqlite_version()` returns
3.53.1, while `process.versions.sqlite` reports 3.53.0; neither is inferred from the upstream
Node source tag. Same-process and cross-process contention, release after SIGKILL,
transaction/migration rollback, WAL/FULL settings, and backup/restore are executable tests.
CI's actual runtime and final results are recorded in the PR, not guessed from `.nvmrc`.
Process termination tests do not establish hardware power-loss durability.
