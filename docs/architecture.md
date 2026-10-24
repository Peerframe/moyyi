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
| `provider-openai-compatible` | model provider | 1 |
| `project-instructions` (AGENTS.md and similar) | context source | 1 |
| `fs` (read, list, search, edit, write) | tools | 1–2 |
| `shell` | tools | 3 |
| `provider-anthropic` | model provider | 5 |
| `web` (fetch, search) | tools, policy rule | 5 |
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
Load failures are reported in `Runtime.plugins`, so clients never assume readiness.

### Trust

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

## Model client contract

One request per call. Every stream ends with exactly one terminal event (`completed` or
`error`). Provider, network and cancellation failures are `error` events, never exceptions; an
exception is a programming error. Every provider runs its recorded fixtures through
`checkModelStream`.

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

One writer process per data directory, enforced with an OS file lock. Proposed in
[ADR 0002](decisions/0002-storage.md): one active run per session and a write lease per
workspace.

## Out of scope for the first release

Browser automation, MCP, long-term memory, sub-agents, automation, GUI. Each has a place above.
