# moyyi

A personal, general-purpose agent with a small, self-owned core. Capabilities such as model
providers and tools are plugins.

Status: the self-owned core, SQLite runtime and real read-only file tools are merged. Batch 6
adds the DeepSeek Responses provider and model recording/replay for review. Run
`npm run demo:deepseek-replay` for synthetic DeepSeek SSE driving real files and SQLite, followed
by equivalent offline replay. Live service acceptance and the interactive CLI remain pending.
See [docs/deepseek.md](docs/deepseek.md), [docs/files.md](docs/files.md) and
[docs/roadmap.md](docs/roadmap.md).

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
| `npm run eval:deepseek` | Run six deterministic provider/file/record-replay scenarios |
| `npm run demo:deepseek-replay` | Demonstrate synthetic DeepSeek SSE, real file tools and exact model replay |
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
| `src/plugins/<name>` | One plugin per folder; currently `provider-scripted`, `provider-deepseek` and `fs` |
| `src/cli` | Terminal client |
| `evals/` | Task suite and harness |
| `docs/` | Architecture, roadmap, threat model, decisions, recipes |

Start with [docs/architecture.md](docs/architecture.md). Common changes have step-by-step
recipes in [docs/recipes/](docs/recipes/).

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
