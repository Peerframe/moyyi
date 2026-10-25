# moyyi

A personal, general-purpose agent with a small, self-owned core. Capabilities such as model
providers and tools are plugins.

Status: the self-owned core, SQLite, read-only file tools and DeepSeek provider/record-replay are
merged, including the interactive CLI and idle-only development reload. Start an
offline terminal with `npm run moyyi -- --demo`, or explicitly connect a trusted host using
`--host FILE`. The demo is a finite script, not an LLM; live DeepSeek acceptance remains pending.
See [docs/cli.md](docs/cli.md), [docs/deepseek.md](docs/deepseek.md) and
[docs/roadmap.md](docs/roadmap.md). Controlled writes and opt-in native sandboxed commands are merged;
see [docs/shell.md](docs/shell.md). The phase 4 branch adds explicit conversation compaction and
expanded crash recovery checks; see [docs/long-sessions.md](docs/long-sessions.md). Its PR awaits review.

## Setup

Requires Node 26 and npm ≥ 11 (bundled with Node 26).

```bash
npm install
npm run check
```

## Commands

| Command | What it does |
|---|---|
| `npm run moyyi -- --help` | Show CLI modes, session controls and development options |
| `npm run moyyi -- --demo` | Open the offline scripted terminal using real read-only file tools |
| `npm run check` | Typecheck, lint, tests (including layer boundaries and the format lock) |
| `npm run eval` | Run the eval suite |
| `npm run eval:core` | Run eight deterministic core conformance/fault scenarios (no paid model) |
| `npm run eval:files` | Run eight deterministic real-file capability scenarios |
| `npm run demo:files` | Demonstrate real list/search/read with scripted responses and disposable files |
| `npm run eval:deepseek` | Run six deterministic provider/file/record-replay scenarios |
| `npm run demo:deepseek-replay` | Demonstrate synthetic DeepSeek SSE, real file tools and exact model replay |
| `npm run eval:shell` | Run seven offline scenarios through real sandboxed processes |
| `npm run eval:long-sessions` | Run four offline long-history and summary-rejection scenarios |
| `npm run demo:scripted` | Demonstrate a complete scripted agent loop using disposable storage |
| `npm run build` | Compile to `dist/` |

## Layout

| Path | Contents |
|---|---|
| `src/contracts/persisted` | The on-disk format, versioned and locked by fixtures |
| `src/contracts` | Model, tool, plugin and client protocol contracts; ports |
| `src/core` | Run loop, tool executor, approvals, cancellation, budgets and recovery |
| `src/store`, `src/context`, `src/policy` | Persistence, context assembly and base permissions |
| `src/runtime` | Plugin registry, wiring, client protocol |
| `src/plugins/<name>` | One plugin per folder; currently `provider-scripted`, `provider-deepseek`, `fs` and `shell` |
| `src/cli` | Terminal client |
| `evals/` | Task suite and harness |
| `docs/` | Architecture, roadmap, threat model, decisions, recipes |

Start with [docs/architecture.md](docs/architecture.md). Common changes have step-by-step
recipes in [docs/recipes/](docs/recipes/).

## License

Licensed under the [Apache License, Version 2.0](LICENSE).

Controlled file creation, editing, snapshots and undo are merged in phase 2,
with explicit workspace grants. See [write usage](docs/writes.md) and
[acceptance status](docs/tasks/2026-10-25-phase-2-writes.md). Run `npm run eval:writes` for
eight offline scenarios with real filesystem and SQLite effects in disposable workspaces.
Phase 3 follows accepted D6: native sandbox default, Docker optional. Phase 5 is not started.
