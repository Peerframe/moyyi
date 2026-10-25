# moyyi

A personal, general-purpose agent with a small, self-owned core. Capabilities such as model
providers and tools are plugins.

Status: the self-owned core and SQLite runtime are merged. The batch 5 review branch adds
real read-only workspace file tools. Run `npm run demo:files` for a complete scripted-model
list/search/read workflow with real files and persisted results. Real model providers and the
interactive CLI remain later batches. See [docs/files.md](docs/files.md),
[docs/core.md](docs/core.md) and [docs/roadmap.md](docs/roadmap.md).

## Setup

Requires Node 26 and npm ≥ 11 (bundled with Node 26).

```bash
npm install
npm run check
```

## Commands

| Command | What it does |
|---|---|
| `npm run moyyi -- --help` | Run the CLI from source |
| `npm run check` | Typecheck, lint, tests (including layer boundaries and the format lock) |
| `npm run eval` | Run the eval suite |
| `npm run eval:core` | Run eight deterministic core conformance/fault scenarios (no paid model) |
| `npm run eval:files` | Run eight deterministic real-file capability scenarios |
| `npm run demo:files` | Demonstrate real list/search/read with scripted responses and disposable files |
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
| `src/plugins/<name>` | One plugin per folder; currently `provider-scripted` and `fs` |
| `src/cli` | Terminal client |
| `evals/` | Task suite and harness |
| `docs/` | Architecture, roadmap, threat model, decisions, recipes |

Start with [docs/architecture.md](docs/architecture.md). Common changes have step-by-step
recipes in [docs/recipes/](docs/recipes/).

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
