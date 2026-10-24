# Add a plugin

A new tool, model provider or context source is a plugin. Done right, the change touches only
the new folder plus one registration line in the runtime.

1. Create `src/plugins/<name>/` with:
   - `index.ts`: exports the `Plugin` (or a function returning one, if it takes options)
   - `README.md`: what it does, its configuration, its limits
   - tests next to the code
2. Import only from `../../contracts/index.ts` and your own folder.
3. In `setup(host)`, register everything you provide. Validate `host.config` yourself and throw
   on invalid configuration; the registry then discards the whole plugin.
4. For a **tool**: pick the `EffectProfile` honestly; when unsure, choose the stricter class.
   Make `prepare` read-only and return preconditions that `execute` checks again. Add
   `reconcile` if an interrupted run can be checked afterwards.
5. For a **model provider**: record real request/response fixtures and assert
   `checkModelStream(events)` returns `[]` for each. Turn off any SDK retries.
6. For a **context source**: mark each section's `stability` correctly; a section marked
   `static` that changes every turn defeats prompt caching.
7. Register the plugin in the runtime's built-in list (once that list exists, phase 1).
8. Run `npm run check`. A boundary violation names the import to remove.

Example: [provider-scripted](../../src/plugins/provider-scripted/).
