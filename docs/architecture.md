# Architecture

moyyi is a personal, general-purpose agent with a small, self-owned core. Everything that is a
capability rather than a guarantee is a plugin. What exists today is in [roadmap.md](roadmap.md);
decisions and their status are in [decisions/](decisions/).

## Core and plugins

The **core** owns the guarantees: what is recorded, what is allowed, what happens on cancel and
crash. These cannot be replaced or bypassed by a plugin.

The **plugins** own the capabilities: which models, which tools, which context. They extend the
core through five fixed points and can be added or removed without touching anything else.

```
        cli ─┐   (future: gui, daemon transport, automation — all clients)
             ▼
          runtime ─────────── plugin registry ◄──── src/plugins/<name>/
             │                                       provider-*, fs, shell,
   ┌─────────┼──────────┬──────────┐                 web, mcp, skills, memory …
   ▼         ▼          ▼          ▼
  core     store     context     policy
   └─────────┴──────────┴──────────┘
             ▼
         contracts ──► contracts/persisted   (the on-disk format, locked by fixtures)
```

### Core inventory

| Part | Path | Owns |
|---|---|---|
| Persisted format | `src/contracts/persisted` | Content parts, transcript tree, effect journal and its transition table, IDs. Versioned, locked by `fixtures/v<N>.ts` |
| Contracts | `src/contracts` | Model client contract and its conformance check, tool contract, ports, client protocol, plugin API |
| Core | `src/core` | Run loop, tool executor, approvals, budgets, cancellation and steering, error classification and retries, recovery |
| Store | `src/store` | SQLite, blob store, migrations, durability levels |
| Context | `src/context` | Rendering a model request, section ordering for prompt caching, compaction |
| Policy | `src/policy` | Base permission policy and approval modes |
| Runtime | `src/runtime` | Plugin registry, wiring, the client protocol |
| CLI | `src/cli` | Terminal client |

### Plugin inventory

| Plugin | Extension points | Phase |
|---|---|---|
| `provider-scripted` | model provider | exists (tests and evals) |
| `provider-deepseek` (Responses subset; [ADR 0007](decisions/0007-first-model-provider.md)) | model provider | merged in batch 6; live acceptance pending |
| `default-instructions` (original working guidance) | context source | implemented; static |
| `project-instructions` (workspace root AGENTS.md only) | context source | implemented; refreshed per request |
| `fs` (read, list, search; create, edit, undo) | tools | read-only merged in batch 5; writes merged in phase 2 |
| `shell` | tools | merged in phase 3 |
| `provider-anthropic` | model provider | merged in phase 5; live acceptance pending |
| `web` (fetch, search) | tools; runtime capability and base policy | merged in phase 5 |
| `skills` (Agent Skills format) | context source | later |
| `mcp` (bridge to MCP servers) | tools, policy rule | later |
| `memory` (Hermes Agent–inspired learning) | context source, event observer | later |

Not plugins, because they are clients of the protocol: GUI, automation and scheduling. Sub-agents
need a decision when they are scheduled: most likely a tool that starts a child session through
the client protocol.

## Extension points

Defined in [plugin.ts](../src/contracts/plugin.ts):

| Point | A plugin can | A plugin cannot |
|---|---|---|
| Tool | Add a tool with its schema, effect profile, prepare, execute, reconcile | Skip validation, policy, approval or the journal; the executor runs those |
| Model provider | Add models and their profiles | Retry, loop or execute tools |
| Context source | Contribute sections, marked by stability | Remove or reorder history, or hide unsettled effects |
| Policy rule | Return `ask` or `deny` | Return `allow`; a throwing rule denies |
| Event observer | Observe runtime events | Block or change a run; a throwing observer is recorded and ignored |

Loading is atomic. A plugin's registrations become visible only after its whole `setup`
succeeds; a failure removes everything it registered and runs its cleanups. Name conflicts fail
the later plugin. Each registration has one owner and disappears when the owner is unloaded.
Load failures are reported in `Runtime.plugins`, so clients never assume readiness. Batch 7 adds
explicit development loaders and the nonpersisted `plugin.reload`/`plugin.status` protocol. Runtime
admits reload only while idle, unloads first, then rebinds the core to current registrations while
retaining store/session/policy and unaffected provider clients. A failed replacement stays unloaded.
See [CLI usage](cli.md) and [ADR 0011](decisions/0011-interactive-cli-and-development-reload.md).
Development reload is incompatible with recording/replay and refreshes only explicit ESM entries.

### Trust

[ADR 0017](decisions/0017-working-and-project-instructions.md) adds original default working
guidance and root AGENTS.md context. Runtime supplies a fixed-path, read-only capability under
an explicit `beforeContextRead` policy decision and restrictive plugin rules; missing grants or
approval-required reads do not load text. It expires after collection and follows run cancellation
and policy revocation. The plugins import no I/O. Root instructions refresh before each model
request, have a 16 KiB complete-file limit and retain source/hash in the recorded request. There
is no automatic nested/parent/home discovery. See [usage and limits](instructions.md).

| Kind | Runs | Trusted | Example |
|---|---|---|---|
| Built-in plugin | In process | Yes; reviewed in this repository | `fs`, providers |
| Local code plugin | In process | Yes, like any installed package; installed explicitly by the user | a personal tool |
| MCP server | Out of process | No; its effect profile is assigned by the `mcp` plugin, never by the server | third-party integrations |
| Skill | Data only | No authority; it is text in the context | Agent Skills folders |

## Layer rules

Enforced by [tests/boundaries.ts](../tests/boundaries.ts):

- `contracts/persisted` imports nothing else, so an interface change elsewhere cannot silently
  change the stored format.
- `contracts`, `persisted` and `core` import no Node built-ins and no packages; the world is
  reached through ports.
- Each `src/plugins/<name>` is its own layer: it imports only contracts and its own files, never
  another plugin or the internals, and never `node:fs` or `node:child_process`.
- Only `runtime` and `evals` import plugins.

## Data model

Three kinds of authoritative records, committed together in one SQLite transaction:

1. **Transcript**: immutable entries forming a tree through `parentId`. Compactions are entries;
   originals are never deleted. Each assistant message references the exact request the model
   saw, stored as one content-addressed blob per rendered message, so storage grows linearly.
2. **Effect journal**: one record per tool action, through the states in
   [effects.ts](../src/contracts/persisted/effects.ts).
3. **State tables**: session metadata, current run, heads.

Large payloads live in the blob store. Streaming deltas are not persisted; completed parts are,
and an interrupted assistant message is persisted with `stopReason: "interrupted"`.
Committed transcript, effect and state records use WAL + `synchronous=FULL` by default, under
[ADR 0002](decisions/0002-storage.md). Both store durability intent labels map to FULL in v1.

## Model client contract

One request per call. Every stream ends with exactly one terminal event (`completed` or
`error`). Provider, network and cancellation failures are `error` events, never exceptions; an
exception is a programming error. Every provider runs its recorded fixtures through
`checkModelStream`.

The DeepSeek adapter accepts a documented text/reasoning/function subset and delegates fixed-origin
HTTP and credentials to runtime. Context includes the persisted assistant stop reason in the
nonpersisted model port, so partial responses cannot masquerade as complete history. All actual
visible reasoning is preserved, but complete turns need not produce it. Validated commentary and
final-answer annotations retain their text in the plaintext profile; response terminals govern tools.
Optional model recording/replay lives in runtime; it captures canonical requests and common events,
not HTTP credentials. It requires a sequential stream and exact request/profile match, with no live
fallback. See [deepseek.md](deepseek.md) and [ADR 0010](decisions/0010-deepseek-transport-and-recording.md).

## Effect pipeline

```
parse args → schema validation → policy (prepare) → prepare (read-only)
  → journal: intended → policy (execute) → approval bound to digest when asked
  → journal: approved → recheck preconditions → journal: started (durable before effect)
  → execute → journal: succeeded | failed → tool_result
```

- Tool calls run only after the whole assistant message has completed.
- Approval binds to the `ActionDigest`. If preconditions changed after approval, the record returns
  to `awaiting_approval`.
- `prepare` reads state, so it needs read permission even for a preview.

## Recovery

- No exactly-once promise: file effects and database commits cannot share one transaction.
- At startup every non-terminal effect is reconciled. `started` becomes `unknown` unless the
  tool's `reconcile` finds evidence. Unknown effects are never replayed automatically.
- Every `tool_call` gets a `tool_result`; interrupted ones get `cancelled` or `unknown`, and the
  model is told to verify before retrying.
- Cancelling a run neither discards the session nor undoes completed effects. Undo is a separate
  user action backed by workspace snapshots.

## Concurrency

One writer process per data directory, enforced with an OS file lock. Accepted in
[ADR 0002](decisions/0002-storage.md): one active run per session and a write lease per
workspace. The merged store and core enforce these constraints. The runtime composes
`AgentCore` with the SQLite store, context, policy, validator and precondition ports; see
[core.md](core.md) for the executable core entry point and [files.md](files.md) for runtime-confined
read capabilities. The executor owns capability lifetime and permission checks; runtime performs
filesystem I/O. File tools cannot access Node filesystem APIs directly.

## Security decision

[ADR 0006](decisions/0006-security-boundaries.md) defines workspace permissions, separate
process containment and network authority, credential handling and local session privacy.
Application-level session encryption is not a first-release prerequisite. The
[threat model](threat-model.md) records assumptions and remaining validation.

## Out of scope for the first release

Browser automation, MCP, long-term memory, sub-agents, automation, GUI. Each has a place above.

## Controlled writes (merged phase 2)

The runtime supplies `ToolContext.writes` only to authorized workspace-write tools. Preparation
can inspect; apply is single-use and bound to the executor-approved payload after durable start.
SQLite schema 2 adds immutable touched-file snapshots, with blobs included in backups; persisted
transcript/effect v1 is unchanged. Undo is a new approved effect and refuses later file changes.
Recovery only inspects recorded pre/post-state and never replays a mutation. See
[ADR 0012](decisions/0012-controlled-workspace-writes.md) and [usage](writes.md).

## Sandboxed commands (merged phase 3)

[ADR 0013](decisions/0013-native-process-sandbox.md) records accepted D6: native OS sandbox by
default, Docker optional. `ToolContext.processes` adds a per-invocation process capability only
for process-effect tools. `shell` prepares an exact command/cwd/timeout; runtime executes only
that approved payload after the existing core's lease and durable-start barrier. A separate
host grant selects exact roots, with clean environment and mandatory native confinement.

Runtime owns Seatbelt/bubblewrap adaptation, bounded output, deadline and process-group cleanup.
Non-exited/uncertain results become unknown and stop the run; recovery never reruns commands.
macOS detached descendants and host-SIGKILL cleanup limits are explicit. Docker is a future
optional adapter, not an implicit dependency or fallback. See [usage and limits](shell.md).

## Long sessions and recovery

Phase 4 adds optional `ContextBuilder.planCompaction` and `session.compact` to the existing
ports/protocol. The context layer chooses a safe settled prefix and renders an ordinary bounded
model request; core runs it without tools under normal lifecycle limits. An immutable compaction
entry and its selected head are committed together with a sibling request/usage audit entry.
Only the selected path enters subsequent model context. The replaced span's replay is omitted;
untouched messages retain provenance, and unsettled effects stay independently visible.

Stable section/tool order preserves prefix reuse opportunities. Context reports expose the
conservative budget and represented entry IDs. No live cache-hit rate is inferred. Recovery's
run status, notice/result pairing and lease decision commit together, so a crash during recovery
can be retried. See [ADR 0014](decisions/0014-recovery-and-compaction.md) and
[usage](long-sessions.md); persisted v1 and layer import boundaries are unchanged.

## Anthropic and tool network authority (merged phase 5)

[ADR 0015](decisions/0015-anthropic-and-web.md) adds a second provider through the existing model
port. Anthropic-specific prefix/account replay bindings stay opaque to the core, in the existing
D2 envelope. Direct HTTP and credentials remain runtime responsibilities. No shared persisted
format or dependency changes are required.

`ToolContext.web` is a separate port for external tools. The executor supplies it only to external
invocations and withholds their local file capabilities. Runtime enforces exact-origin grants,
no-I/O preparation, frozen action/digest/run binding, durable-start ordering and single execution.
The default `WebPolicy` asks before network execution; installed policy rules can only restrict it.
Production HTTPS validates all A records then pins the connection, verifies TLS, refuses redirects
and bounds output/time. Search uses an explicitly configured SearXNG endpoint. Page content and
search links are untrusted data without authority. Unknown external effects are never replayed.
See [web usage and limits](web.md) and [Anthropic usage](anthropic.md).

## Local candidate packaging (phase 6 branch)

[ADR 0016](decisions/0016-local-installable-candidate.md) keeps the existing layers and compiles
production ESM/declarations into a private npm tarball. `moyyi/runtime` exports the composition
root and existing trusted-host configuration helpers; `moyyi/contracts` exports commands, events
and plugin contracts. No internal wildcard entry or new network protocol is introduced. Installed
clients use the same send/subscribe/idle/close lifecycle as the CLI.

A complete package inventory, isolated tarball installation and actual CLI/PTY/client/type checks
are required in CI. The installed process has no source checkout or compiler dependency. This is
an unpublished development candidate with explicit platform and live-service gaps; see
[installation](installation.md) and [client protocol](client-protocol.md).
