# 0002: Local storage

Status: accepted in part (2026-10-24)

## Accepted

- Local SQLite. moyyi owns the schema and migrations.
- Related updates commit in one transaction.
- One runtime per data directory.
- The request a model saw is stored as one content-addressed blob per rendered message
  (`RenderedRequestRef`), so consecutive requests share their unchanged history.
- The persisted format is versioned (`PERSISTED_FORMAT_VERSION`) and locked by typed fixtures in
  `src/contracts/persisted/fixtures/`.

## Proposed

- **Three authoritative record kinds** (transcript tree, effect journal, state tables) instead of
  one event stream with rebuildable projections. Rebuilding projections requires deterministic,
  versioned reducers and permanent event compatibility; reconciliation at startup gives the same
  auditability at lower cost.
- **Transcript as a tree** (`parentId`) from the first schema version.
- **Blob store** for large payloads, content-addressed, outside the database file.
- **Durability levels**: WAL with `synchronous=NORMAL` for ordinary commits; commits that precede
  a side effect use `synchronous=FULL` (or an explicit checkpoint), because WAL + NORMAL may lose
  the latest commits on power loss and recovery depends on the intent record.
- **Concurrency granularity**: one writer process per data directory (OS file lock), one active
  run per session, one write lease per workspace.
- JSONL export of sessions for inspection and sharing.

## Open

- Driver: `node:sqlite` is now the first candidate. On Node 26 it is a release candidate
  (stability 1.2) with no native build; `better-sqlite3` remains the fallback. Decide in phase 1
  with tests for WAL, `synchronous=FULL`, transactions and packaging.
