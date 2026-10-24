# moyyi

A personal, general-purpose agent with a small, self-owned core. Capabilities such as model
providers and tools are plugins.

Status: phase 0. The contracts, plugin registry and eval harness exist; the agent core does not,
and the CLI rejects commands it cannot perform yet. See [docs/roadmap.md](docs/roadmap.md).

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
| `npm run build` | Compile to `dist/` |

## Layout

| Path | Contents |
|---|---|
| `src/contracts/persisted` | The on-disk format, versioned and locked by fixtures |
| `src/contracts` | Model, tool, plugin and client protocol contracts; ports |
| `src/core` | Agent core (not implemented yet) |
| `src/runtime` | Plugin registry, wiring, client protocol |
| `src/plugins/<name>` | One plugin per folder; currently `provider-scripted` |
| `src/cli` | Terminal client |
| `evals/` | Task suite and harness |
| `docs/` | Architecture, roadmap, threat model, decisions, recipes |

Start with [docs/architecture.md](docs/architecture.md). Common changes have step-by-step
recipes in [docs/recipes/](docs/recipes/).
