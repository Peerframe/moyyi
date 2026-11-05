# ADR 0048: Local daemon over a private Unix socket

- Date: 2026-11-05
- Status: accepted by the owner (option 2 in the
  [repository structure record](../tasks/2026-11-05-repository-structure.md#4-前后端现状与选项));
  first scope is the CLI. The desktop app keeps its in-process worker until a later delivery.

## Context

Every client embedded its own runtime. The store allows one writer, so two clients could not
use the same private data directory at once, and work could not be watched or approved from a
second terminal. The client protocol (`ClientCommand`/`RuntimeEvent`) was written so the runtime
could later move behind a process boundary by changing only the transport. Codex
(`app-server`), opencode (`server`), goose and DeepSeek Harness all run one backend that owns the
agent and storage and let several clients connect.

## Decision

- **One daemon per data directory.** `moyyi --daemon (--demo | --host FILE) [grants]` creates the
  runtime exactly as the local CLI does (same host loading, `configureCliHost` grants and store),
  then serves it until SIGINT/SIGTERM. The store's writer lock is the single-daemon guarantee.
- **Transport.** Newline-delimited JSON over a Unix socket at `<data>/daemon.sock`. Wire
  protocol version 1 lives in `src/contracts/wire.ts`; the server and client are the new `daemon`
  layer (`src/daemon`), which may import contracts and runtime; the CLI may import it.
- **Authentication.** The data directory is the store's owner-only directory (0700, checked as
  owned by the current uid and not a symlink). The socket is created there with mode 0600. On each
  start the daemon writes a fresh 256-bit token to `<data>/daemon-token` (0600, `O_EXCL|O_NOFOLLOW`);
  a client must present it in its first frame, compared in constant time. Clients check the same
  directory, socket and token ownership before connecting. Socket and token are removed on stop.
- **Authority does not move to clients.** Grants are fixed when the daemon starts; the wire has no
  command that changes them. `--connect` rejects host, workspace, grant, budget and development
  options. The daemon accepts `session.create` only for its own workspace, the one its grants are
  bound to. Remote input is text only. Approvals still bind to the displayed effect ID and digest;
  any authenticated client of the same user viewing the run may answer.
- **Untrusted input.** Every client frame is validated and rebuilt field by field before the
  runtime sees it (exact keys, string byte bounds, integer ranges, absolute workspace paths,
  printable IDs). Frames are bounded: 4 KiB before authentication, 1 MiB per client frame, 16 MiB
  per server frame; a 5 s authentication deadline, at most 8 clients, 16 unanswered frames per
  client and 64 MiB of unsent output per client, beyond which the client is disconnected.
- **Event routing.** Commands are serialized across clients, so events emitted while a command is
  handled are replies to its sender (`session.ready`, history pages, rejections, `session.load`
  history). Run, entry, effect and approval events go to the clients viewing that session.
  An approval whose run cannot be attributed is shown to every client rather than left unseen.
- **Lifecycle.** A client that disconnects cancels the runs it started, matching the local CLI,
  where exiting closes the runtime. Stopping the daemon disconnects clients, cancels their runs,
  waits for queued commands and closes the runtime. There is no auto-start, launchd/systemd unit
  or remote (TCP) listener.

## Consequences

- Several terminals can share one store and session; one can watch or approve another's run.
- The local CLI without `--connect` is unchanged and still exclusive with a running daemon.
- Same-user processes could already read the store; the daemon does not change T4/T6 in the
  [threat model](../threat-model.md). It adds a local entry point protected by owner-only file
  permissions and the token, and it must never listen on a network interface.
- Moving the desktop host onto the daemon needs its host-only APIs (materials, maintenance,
  settings, history management) on the wire first; that is a separate delivery and ADR.

## Rejected

- TCP on localhost with a token: reachable by every local user and by browser-originated requests;
  owner-only file permissions are not available.
- Peer credential checks (`SO_PEERCRED`/`getpeereid`): not exposed by Node; the private directory
  plus token gives the same-user guarantee without native code.
- Letting clients pass grant flags per session: would let any same-user client widen authority
  for a run another client is watching, and would need a new policy model.
