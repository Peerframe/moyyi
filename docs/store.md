# Local store

`SqliteSessionStore` in [src/store/index.ts](../src/store/index.ts) implements `SessionStore`.
It is available to application composition code and tests. Batch 3 did not wire the runtime to it.
The batch 4 review branch adds programmatic runtime wiring and a scripted demo;
see [core.md](core.md). The decision and supported filesystem
boundary are in [ADR 0002](decisions/0002-storage.md).

## Lifetime and transactions

Construct with a dedicated private data directory, and call `close()` when finished. Only one
store may own that directory at a time, even within one process. The OS releases its lock on
process exit. Do not manually delete `writer-lock.sqlite` to resolve contention.

`commit(batch)` applies entries, effect updates, session heads, run states and lease changes
in one synchronous SQLite transaction. Await its success before performing any side effect.
Both `normal` and `before_side_effect` use FULL; the latter communicates the executor's
intent. A rejected commit changes none of these records. No await occurs inside the transaction.

Create the session and its active run in the first batch. Session workspace and run ownership
are immutable. Entries can arrive in any order within a batch; parents must exist by commit,
belong to the same session, and form a tree. Head changes preserve every original entry.
An identical entry/effect repeat is idempotent; an overwrite is rejected.

New effects must start `intended`. Each update follows the frozen transition table. Effect
identity and profile cannot change; a digest can change only when entering `awaiting_approval`
for renewed approval. `(runId, callId)` is unique. A completed run must settle its effects and
release its lease; an interrupted run may retain unsettled effects, but cannot start new ones.
`unsettledEffects()` includes `unknown`. A store does not turn any of these records into work.

Lease acquisition uses the session's canonical real workspace path and its active run. Only
the holder can release it. Persisted `started`/`unknown` workspace-write or process effects
retain the lease until evidence settles them. An atomic batch may close an old run and start
its successor; final-state run updates are applied before active-run inserts. Lease operations
and effect transitions follow their array order. Use each session/run identity once per batch.
Separate, non-overlapping workspaces can hold separate leases. Parent/child overlaps conflict.
A holder can release the saved canonical path even if the directory has been moved or deleted.
The later policy/executor must still enforce permissions and the OS sandbox.

## Blobs and backups

`putBlob(bytes)` returns a SHA-256 reference only after publication and synchronization. It
deduplicates immutable content. Store real bytes first, then include their references in entries.
Missing or corrupt referenced bytes reject the whole commit. `getBlob()` returns null for a
missing standalone reference and throws on corruption. `loadSession()` validates its records
and referenced blobs as well. Reading a very large history is currently eager; streaming and
pagination are later optimizations, not silently truncated results.

`backup(newDirectory)` creates a consistent database and referenced blobs at a new destination
outside the data directory. Existing destinations are rejected. This is synchronous inside its
Promise API and pauses the writer while it works. To restore, open the backup directory as a
store (or copy the complete closed backup to the desired new location). A backup preserves run,
lease and unknown-effect state; restoring it must not automatically resume actions. It excludes
unreferenced blobs and the writer lock. There is no automatic garbage collection or retention
policy implementation yet.

Failure before directory publication leaves no destination. Failure of the final parent-directory
sync occurs after a complete snapshot becomes visible: `BackupDurabilityError.destination`
identifies it, but durability is unconfirmed and the method rejects. Do not mistake existence
for an acknowledged backup, or delete that complete snapshot as if it were a staging directory.

`diagnostics()` reports schema/format version, the actual SQLite connection version, WAL/FULL
settings and database integrity. It does not prove physical power-loss survival. Constructor
`checkpoint` callbacks exist only for trusted fault-injection tests, not plugin configuration.

## Validation

- `npx vitest run src/store tests/store.test.ts tests/store-process.test.ts`
- `npm run check`

Tests use disposable synthetic data and real SQLite/filesystem calls. The locked v1 fixture
contains placeholder blob hashes without payload files. The store test supplies four synthetic
payloads and substitutes only their content addresses before committing; all other fields,
including opaque replay bytes, are unchanged. It compares every written record with every
read record, reopens the store, and repeats that comparison. Pure record tests separately
round-trip the exact original fixture. Missing or invalid blob checks are never bypassed, and
the frozen fixture is not edited to accommodate storage.

## Phase 2 snapshot storage

Schema 2 adds immutable version-1 workspace snapshots tied to a started write effect/run/lease.
The verified schema-1 migration is atomic and preserves existing transcript/effect v1 records.
Snapshot-only before-image blobs participate in backup reachability and integrity checks; old
schema-1 backups open through the same migration. See
[ADR 0012](decisions/0012-controlled-workspace-writes.md).
