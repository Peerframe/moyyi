# 0012: Snapshot-backed, controlled workspace writes

Status: implemented on the phase 2 branch (2026-10-25); awaiting PR review

## Context and authorization

The owner authorized merging PR #11 after review and CI, then delivering phase 2 as a new,
unmerged PR. D1, D2 and D3 remain in force. No paid model calls, credentials, shell or phase 3
work are authorized. The phase 1 live-service and quality acceptance gaps remain visible.

The existing executor already owns schema validation, policy, digest-bound approvals, file-hash
preflight, write leases, a durable `started` barrier, cancellation and unknown outcomes. Reuse
those guarantees. A plugin must not implement another approval loop or a second effect journal.

## Decision

Add `create`, `edit` (one unique literal replacement) and `undo` to the existing `fs` plugin.
They declare `workspace_write / snapshot / postcheck`. Add a runtime-owned `ToolContext.writes`
capability; core only controls lifetime, policy and the phase in which it is issued. Preparation
can inspect complete files and snapshots. `apply()` takes no arguments: it can execute only the
frozen action payload approved by the executor, once, after `started` is durable. Read tools
never receive this capability. Read-only recovery receives inspection, never apply authority.

Writes require explicit host opt-in with exact workspace roots and snapshot-aware SQLite storage.
The default remains read-only. Default opted-in mode asks for every prepared write; a host can
explicitly select scoped `allow`. A separate mutable `WorkspaceWritePolicy` supports revocation
and grant epochs. Neither model arguments nor repository text can enable writes. Plugin rules
can only restrict the host's authority.

### Publication and snapshots

- Support complete, owned, ordinary, single-link UTF-8 files up to 1 MiB. New files use mode 0600;
  edits preserve ordinary POSIX mode bits. Existing parent directories are required. Reject
  traversal, all workspace-internal symlink components, special files/bits, protected credentials,
  `.git`, `.moyyi`, private runtime directories and reserved staging names.
- Recheck root/ancestor identity, target identity, complete content hash, mode and authority at
  execution and again immediately before publication. Creating a file must never overwrite a
  target that appeared since inspection.
- Publish the old bytes to the existing content-addressed blob store, then commit an immutable
  snapshot using SQLite FULL before touching the destination. The snapshot belongs to the
  current `started` effect/run/workspace lease. A failure at either storage barrier prevents
  publication. The two stores cannot form an exactly-once transaction with the filesystem.
- Write a unique same-directory O_EXCL/O_NOFOLLOW staging file, synchronize it, then publish.
  Edit uses atomic rename. Create uses hard-link publication, which rejects an existing target,
  followed by staging unlink. Undo of creation unlinks only an unchanged target. Synchronize the
  parent directory and verify the resulting hash/mode before reporting success.
- Undo is a new journaled and approved action, with its own snapshot. It restores exact old
  bytes/mode only while the current file matches the original after-state. It can therefore be
  undone again; it never blindly overwrites later user edits. This is a touched-file snapshot,
  not a whole-project checkpoint or a multi-file transaction.

### Storage compatibility

SQLite schema 2 adds one `workspace_snapshots` table and a strict version-1 snapshot payload.
The schema-1 migration verifies the full old DDL and integrity before changing anything, adds
only this table, and is atomic. Existing transcript/effect JSON and
`src/contracts/persisted` remain unchanged at v1. Old fixtures and checkers remain unchanged.
The historical schema-1 fixture is retained in store migration tests. Snapshot versions,
identities, referenced hashes/blobs and undo relationships are validated on read. Backups include
snapshot-only blob references as well as transcript references. No independent receipt directory
or competing journal is introduced.

### Failure and recovery

An execution exception becomes `unknown`; it is never automatically retried or rolled back.
At startup, the existing recovery pipeline can use the snapshot to inspect current state.
Matching post-state resolves to observed success; matching pre-state resolves to observed
failure; a third state or inaccessible/corrupt data remains unknown and retains the write lease.
Evidence explicitly says that observed state does not prove attribution, transient history or
physical power-loss durability. No durable snapshot means built-in publication was not reached.
Recovery does not call a model or execute a mutation and obeys the current grant.

Cancellation cannot retract an already issued syscall or undo a published change. A killed process
can leave a staging file, including the create link/unlink window; it is not broadly auto-deleted.
Such an ambiguous state may need manual inspection, and recovery must not invent a successful
write. Phase 4's exhaustive crash-point coverage is not claimed here.

## Alternatives and costs

Reusing an atomic-write package would cover only staging/publication and would still require our
hash, identity, approval, snapshot, undo and revocation implementation. The already pinned Node
26.0.0 primitives are sufficient for this bounded path; no new dependency or source copy is added.
A separate receipt directory needs another versioned storage, integrity and backup system. A
small additive SQLite table reuses D1's writer lock, FULL durability and backup ownership instead.
Whole-workspace copying would include unrelated/private files and increase storage cost; this
phase snapshots only a touched file. Multi-file atomicity and command rollback are not promised.

## Evidence and limits

Primary documentation reviewed for this decision:

- [Node v26.0.0 filesystem API](https://github.com/nodejs/node/blob/v26.0.0/doc/api/fs.md): exclusive
  creation, file synchronization, cancellation limits, and filesystem-dependent semantics.
- [Apple rename](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/rename.2.html)
  and [open](https://developer.apple.com/library/archive/documentation/System/Conceptual/ManPages_iPhoneOS/man2/open.2.html).
- Linux man-pages [rename](https://man7.org/linux/man-pages/man2/rename.2.html),
  [link](https://man7.org/linux/man-pages/man2/link.2.html), and
  [fsync](https://man7.org/linux/man-pages/man2/fsync.2.html).

These are design references, not copied code. Node does not expose a portable dirfd-relative
hash compare-and-swap mutation. Rename is not hash-CAS: a hostile same-account process or an
external writer in the final check/publication window remains outside T4's established guarantees.
Local macOS/Linux filesystems are the supported validation target; other OSes fail closed.
Network filesystems are unsupported and are not automatically detected. ACLs, xattrs, ownership
changes, timestamps and physical power cuts are not preserved/validated guarantees. No kernel
sandbox or shell isolation is claimed. See the [phase 2 handoff](../tasks/2026-10-25-phase-2-writes.md).
