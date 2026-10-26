# moyyi

A personal, general-purpose agent with a small, self-owned core. Capabilities such as model
providers and tools are plugins.

Start with the **[system overview](docs/system-overview.md)** for the whole task flow, current
versions, user capabilities, evidence and next engineering checkpoint.

The self-owned core, SQLite, CLI, controlled file tools, native sandboxed commands, recovery,
instructions, Skills and provider/web adapters are implemented. A
[local installable candidate](docs/installation.md) and bounded DeepSeek read/tool continuation
have passed acceptance. Broader project-answer quality remains unresolved; real Anthropic and
SearXNG acceptance is still pending. Candidate branches and installed versions are distinguished
in the overview. This is not an official release.

Start an offline terminal with `npm run moyyi -- --demo`, or explicitly connect a trusted host
using `--host FILE`. The demo is a finite script, not an LLM. See [CLI usage](docs/cli.md),
[DeepSeek configuration](docs/deepseek.md) and [future scope](docs/roadmap.md).

## Development setup

For a source checkout, use Node 26 and npm ≥ 11 (bundled with Node 26). For a tarball installation,
follow [installation.md](docs/installation.md); contributor commands below require the repository.

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
| `npm run eval` | Run the public task suite with the null baseline; [explicit runtime/model opt-in](docs/runtime-evaluation.md) |
| `npm run eval:runtime` | Run offline real-runtime/task-harness conformance |
| `npm run eval:core` | Run deterministic core conformance/fault scenarios (no paid model) |
| `npm run eval:files` | Run deterministic real-file capability scenarios |
| `npm run demo:files` | Demonstrate real list/search/read with scripted responses and disposable files |
| `npm run eval:deepseek` | Run deterministic provider/file/record-replay scenarios |
| `npm run demo:deepseek-replay` | Demonstrate synthetic DeepSeek SSE, real file tools and exact model replay |
| `npm run eval:shell` | Run offline scenarios through real sandboxed processes |
| `npm run eval:long-sessions` | Run offline long-history and summary-rejection scenarios |
| `npm run eval:anthropic` | Run offline Anthropic tools/replay/compaction/failure scenarios |
| `npm run eval:web` | Run offline web authority and injection-attempt scenarios |
| `npm run eval:instructions` | Verify default/project guidance loading and authority with scripted models |
| `npm run eval:skills` | Verify selected Skills loading, refresh and authority with scripted models |
| `npm run demo:scripted` | Demonstrate a complete scripted agent loop using disposable storage |
| `npm run build` | Clean and compile production code to `dist/` |
| `npm run package:candidate` | Create a local private tarball, checksum and inventory |
| `npm run verify:package` | Package, install outside the repo and verify CLI, PTY, client and declarations |

## Layout

| Path | Contents |
|---|---|
| `src/contracts/persisted` | The on-disk format, versioned and locked by fixtures |
| `src/contracts` | Model, tool, plugin and client protocol contracts; ports |
| `src/core` | Run loop, tool executor, approvals, cancellation, budgets and recovery |
| `src/store`, `src/context`, `src/policy` | Persistence, context assembly and base permissions |
| `src/runtime` | Plugin registry, wiring, client protocol |
| `src/plugins/<name>` | Model providers, tools, default/project instructions and Skills; see the [plugin inventory](docs/architecture.md#plugin-inventory) |
| `src/cli` | Terminal client |
| `evals/` | Task suite and harness |
| `docs/` | Architecture, roadmap, threat model, decisions, recipes |

Use [the system overview](docs/system-overview.md) to choose the work, then
[architecture](docs/architecture.md) and the relevant [recipe](docs/recipes/) to implement it.

## License

Licensed under the [Apache License, Version 2.0](LICENSE).

Controlled file creation, editing, snapshots and undo are merged in phase 2,
with explicit workspace grants. See [write usage](docs/writes.md) and
[acceptance status](docs/tasks/2026-10-25-phase-2-writes.md). Run `npm run eval:writes` for
eight offline scenarios with real filesystem and SQLite effects in disposable workspaces.
Phase 3 follows accepted D6: native sandbox default, Docker optional. Phase 6 is limited to a local candidate; registry publication, release tags and official installers are not started.
