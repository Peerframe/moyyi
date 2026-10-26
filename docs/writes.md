# Controlled workspace writes

Phase 2 adds `create`, `edit` and `undo`. The default runtime remains read-only. To enable writes,
add this to an explicitly trusted [CLI host](cli.md) or programmatic runtime configuration:

```ts
workspaceWrites: {
  roots: ["/absolute/path/to/the/selected/workspace"],
  approval: "ask", // default; the CLI displays the exact before/after and action digest
}
```

Use `dataDirectory` or an injected `SqliteSessionStore`; a custom memory store cannot enable the
built-in write capability. Roots are exact selected workspaces, not implicit grants to every
subdirectory opened as another session. Host settings and installed code are trusted; repository
instructions, tool content and models cannot change grants. `approval: "allow"` is an explicit host
choice for autonomy within those roots. A custom host policy still applies and may be stricter.

For revocable host control, retain a `WorkspaceWritePolicy` instance and pass it as `policy`:
`policy.revoke()` cancels the current grant epoch; `grant()` creates a fresh epoch. Old approvals
and retained capabilities cannot be revived by regranting. Closing the runtime also expires its
capabilities. The configuration is the visible scope; no persistent remembered-grant UI is added.

## Tools and undo

| Tool | Arguments | Behavior |
|---|---|---|
| `create` | `path`, `text` | Create a missing file; never overwrite; parent must already exist |
| `edit` | `path`, `oldText`, `newText` | Replace exactly one literal match, or refuse |
| `undo` | `snapshotId` | Restore one unchanged file from a prior effect, including removing a created file |

Results contain `snapshotId`, `path`, `beforeHash` and `afterHash`. To undo, ask the agent to call
`undo` with that snapshot ID and approve the displayed action. This uses the ordinary model/tool
loop; there is no separate `/undo` command or arbitrary filesystem rollback. Undo has its own
snapshot, so it can be reversed. If another editor changed the file or its permissions, undo
refuses to overwrite it. Cancellation stops further work; it does not undo completed changes.

The CLI's existing `/approve <effectId>` and `/deny <effectId>` commands answer the exact displayed
digest. Noninteractive input denies pending approvals. Read-only tools remain available. No shell
or subprocess capability is provided. The offline behavior can be reproduced without credentials:

```sh
npm run eval:writes
```

This creates and removes disposable workspaces, executes real file operations through the full
runtime and SQLite, and checks eight scripted scenarios. It checks actual files, tool statuses and
outside/protected canaries, including deliberately false assistant success claims. It does not
measure real-model competence, live API compatibility, latency or cost. Existing public evaluation
tasks and checkers are unchanged; no private corpus is accessed.

## What is preserved, and what can fail

Snapshots retain exact prior file bytes and ordinary POSIX mode bits in owner-protected storage.
Backups include these blobs. The SQLite schema migrates additively from 1 to 2; persisted v1
transcript/effect records stay readable and unchanged. Storage may grow by the old content of each
changed file, deduplicated by hash. Automatic retention/garbage collection is not introduced.

Files must be owned, ordinary, single-link UTF-8 text, at most 1 MiB; the existing run input budget
also bounds model tool arguments (64 KiB by default). No binary editing, parent-directory creation,
symlink traversal, special permission bits, `.git`, `.moyyi`, private store paths or protected
credential files. The host never executes a truncated preview or partial write request.

A failed publication/synchronization may already have changed the file. It is recorded as unknown,
and never retried automatically. Restart with the same explicit write grant lets recovery inspect
the durable snapshot: matching pre/post-state resolves an observed outcome; a different or unreadable
state remains unknown and retains its lease. Manual inspection is needed for unresolved outcomes.
The recorded evidence distinguishes observed state from proof of the original operation's history.

Validated scope is local macOS/Linux filesystems. Windows is rejected; network filesystems are
unsupported but not detected. Atomic rename is not hash compare-and-swap, and this does not sandbox
other processes running under your OS account. Snapshots do not preserve ACLs/xattrs/timestamps or
promise whole-workspace rollback. A hard kill can leave private staging files for manual cleanup.
See [ADR 0012](decisions/0012-controlled-workspace-writes.md) and the
[acceptance record](tasks/2026-10-25-phase-2-writes.md) for evidence and remaining limits.

A separate installed live trial repaired the public listener-leak fixture, ran its fixed checker
in the native sandbox, and undid both edits in reverse order. Original bytes and ordinary mode
were restored and the original checker failure returned; unrelated files and the checker stayed
unchanged. This is one bounded task, not a project-edit reliability rate. See the
[current evidence](tasks/2026-10-26-optimization-plan.md).
