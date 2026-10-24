# Plugin rules

Each folder here is one plugin and its own layer. These rules keep a change to one plugin from
breaking anything else.

- A plugin imports only `src/contracts` and files in its own folder. Never another plugin, never
  `core`, `runtime` or `store`. `tests/boundaries.ts` enforces this.
- Files and processes are reached through `ToolContext`, never `node:fs` or
  `node:child_process`.
- Everything is registered in `setup`. Registration after setup is rejected.
- Each tool declares an honest `EffectProfile`. When unsure, choose the stricter class.
- Every folder has `index.ts` (exports the plugin), `README.md` (what it does, its config, its
  limits) and tests next to the code.
- Steps: [docs/recipes/add-a-plugin.md](../../docs/recipes/add-a-plugin.md).
