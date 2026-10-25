# Client protocol acceptance

The local candidate exposes `moyyi/runtime` (`createRuntime` and host/runtime types) and
`moyyi/contracts` (commands, events and plugin contracts). The CLI and programmatic clients use
the same `send`/`subscribe` protocol. This is an in-process API for trusted host code; it does not
add an HTTP endpoint, JSON-RPC server, authenticated remote boundary or a GUI.

## Lifecycle

Create a runtime with an explicit model, private data directory and trusted startup plugins or
provider connection. Subscribe before sending a command so initial acknowledgements are observed.
Call `session.create` with the selected workspace, or `session.load` with a recorded session ID.
Both report `session.ready`; loading also emits recorded entries and does not itself call a model.

`send(command)` confirms command handling, not completion of an accepted run. Track `run.started`
and `run.finished`, or await `idle()` when the host needs all admitted work to settle. A run can
wait for approval until the client responds or cancels. Waiting for `idle()` alone cannot answer
that approval. `run.finished.outcome` distinguishes completed, cancelled, failed and budget-exhausted
runs; streamed text alone is not success evidence.

`close()` is idempotent, stops admission, cancels active work, waits for cleanup, releases owned
storage and unloads plugins. The client must await it before replacing a runtime using the same
data directory. An injected store remains its caller's responsibility. The function returned by
`subscribe` removes that listener. Events are frozen copies; listener exceptions are isolated and
recorded in diagnostics, not a reason to grant an action or stop the durable execution pipeline.

## Commands and observations

| Command | Client obligation / relevant result |
|---|---|
| `session.create` | Select the workspace explicitly; wait for `session.ready` |
| `session.load` | Use the matching private store; history is delivered through `entry.appended` |
| `run.start` | Supply content to the ready session; overlapping work is rejected |
| `run.steer` | Address the active run ID; steering is recorded, not a silent replacement run |
| `run.cancel` | Address the active run; cancellation preserves completed effects and partial output |
| `approval.respond` | Echo both the displayed effect ID and exact digest, with approve or deny |
| `session.compact` | Explicit idle request; one selected-model summary call, with normal cancellation/budget rules |
| `plugin.reload` | Only a host-configured development loader, while idle; no project auto-discovery |

`command.rejected` is a normal protocol observation and does not mean the command executed.
Approval must bind the actual displayed action; a stale digest is rejected. Changing model text
or an event payload does not approve an action: approval requires a trusted client command.
A trusted subscriber holding the runtime may send that command, as an interactive client does.
An external client that forwards commands
across a process or network boundary must supply its own authenticated transport and validation;
the TypeScript union is not an untrusted-wire validator.

Tool results and effect states describe observed execution. A denied edit leaves the file intact;
a completed conversation can still contain denied or failed tools. Unknown external/process effects
remain unresolved rather than being silently replayed on restart. See the
[architecture](architecture.md), [write](writes.md), [shell](shell.md) and [web](web.md) boundaries.

## Installed-candidate evidence

The package gate copies `scripts/package-fixtures/client.mjs` to a temporary consumer outside the
repository and runs it using only the installed package's bare exports. Its eight scenarios cover:

- Session creation, streaming, frozen event snapshots and an observer that throws while trying to
  alter history. Other observers still receive the original events and the run completes.
- A real file creation that cannot occur with a stale digest, then succeeds after exact approval.
- A denied edit with unchanged workspace and sibling canaries.
- Busy admission, persistent steering, cancellation and rejection of an active development reload.
- Idle reload through an explicit loader, with the replacement context visible on the next request.
- Explicit compaction, a tool-free summary request and continuation with the recorded summary.
- Closing an active run, reopening actual SQLite, loading without a new model request and continuing
  from recorded context without re-executing the approved write.
- Listener unsubscribe and rejection of new work by a closed runtime.

The separate `consumer-types.txt` fixture is copied to `.mts` and checked as an independent
NodeNext consumer against the installed declarations, without `skipLibCheck`. It checks plugin,
model, runtime and event types, plus rejected commands and policy widening. The filename prevents
the repository's normal source typecheck from accidentally satisfying package-resolution checks.

The runtime/store/files are real; provider output is a deterministic local fixture. No model API,
web request, real credential or private task is involved. Passing establishes package and local
protocol compatibility for the exercised paths, not model task quality, provider service acceptance,
remote protocol security or a formally released stable API. Source-level crash, sandbox, cancellation
race and provider tests remain separate gates; this acceptance does not replace them.
