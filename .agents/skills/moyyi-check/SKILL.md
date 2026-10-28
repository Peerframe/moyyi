---
name: moyyi-check
description: Choose and run the moyyi checks that cover a change, from focused tests to package, desktop and live gates, and report only what actually ran. Use before handoff, review or when a check fails; not to claim skipped checks passed.
---

# moyyi-check

## Inputs

The changed files (including untracked ones), the acceptance list in the brief, and which
environments are available (macOS desktop, network, owner's live host module).

## Order

1. **Focused tests** for the changed files: `npx vitest run <paths>`.
2. **`npm run check`**: typecheck, lint and all unit tests. Required before every handoff.
3. **Offline conformance** for affected areas, matching CI:

   | Changed area | Suite |
   |---|---|
   | `src/core`, `src/context`, budgets | `eval:core`, `eval:long-sessions` |
   | fs plugin, file capability | `eval:files`, `eval:writes` |
   | documents | `eval:documents` |
   | shell, processes, sandbox | `eval:shell` |
   | providers | `eval:deepseek`, `eval:anthropic`, `eval:kimi` |
   | web | `eval:web` |
   | instructions, skills | `eval:instructions`, `eval:skills` |
   | runtime wiring, eval harness | `eval:runtime` |

4. **Packages**: `npm run verify:package -- --offline` when the CLI package or runtime exports
   change.
5. **Desktop**: `npm run desktop:package` then `npm run verify:desktop` for any `apps/desktop`
   change, plus a native run with screenshots for visible changes.
6. **Live quality gate**: only at the end of a delivery that changes prompts, tools, providers or
   the loop, following [moyyi-live-eval](../moyyi-live-eval/SKILL.md).

## Rules

- Report the exact commands and their results. A check you did not run is reported as not run.
- When a check fails, find the first broken layer (input, evidence, context delivery, model
  interpretation, effect execution, verification, presentation) before changing code.
- Do not weaken assertions, skip tests or raise limits to get a pass.
- If a sandbox blocks a needed command, say so; do not substitute a different check silently.
