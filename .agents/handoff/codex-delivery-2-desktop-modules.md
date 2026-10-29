# Handoff: delivery two desktop modules
- Brief: docs/tasks/2026-10-29-delivery-2-desktop-modules.md
- Branch / previous checkpoint: codex/delivery-2-desktop-modules / eeff4ec70d89596d7cdcafc23a50d82f8fc8d40b (base; this file is committed with part A)
- Last agent: Codex, 2026-10-29 17:17 Asia/Singapore
- Worktree: /Users/yxflc/.codex/worktrees/delivery-2-desktop-modules/moyyi

## Done
- A: Nine feature modules, browser-safe contracts, unique command/IPC ownership, environment-specific generated registries and feature state ownership checks. Main and App are composition shells.
- Renderer slots/state extraction preserves byte-identical HTML in 13 baseline states. Existing component compatibility exports retain tests and licenses.
- Architecture boundary and contributor mechanical checks, ADR 0045, feature READMEs and recipe added.
- Independent host review found a refactor-only intermediate snapshot issue; fixed by batching each runtime event's projection writes. Two added public-host integration tests pass.

## In progress
- B: Resolve local verification environment. Full check passed typecheck/lint and 2943 tests, but 36 parser tests failed in 2 files with parser_failed. Suspect the managed worktree under protected ~/.codex; confirm the identical source in a normal external validation checkout. Do not weaken confinement or change product behavior.
- Then run full check, desktop package/external gates, renderer parity, and native baseline/candidate import/read/approve/preview/save/restart acceptance with screenshots. Review final diff and create one PR only at completion.
- No active writers at this checkpoint. Subagents' implementation and review turns finished. No paid run exists.

## Collected problems (fix pass)
- Native minimum is 780 px; M6 evidence is 1120×800 / 780×560. Delivery-zero design/skill said 560. Keep native behavior; document 560 CSS-layer validation separately.
- No confirmed M6 behavioral defect or format/security change identified. Stop for brief section 8 if one is confirmed.

## Commands run
- Baseline vitest service/m6/main: 66 passed.
- Extracted host service/m6/web-service: 31 passed.
- Main/security/wire/preload: 59 passed.
- Renderer suite: 45 passed; parity script: 13/13 identical baseline HTML.
- Host ownership/boundary/service/m6/web-service: 48 passed before event publication regression addition.
- service.test.ts after publication regression addition: 24 passed.
- npm run check: typecheck and lint passed; 152 test files passed, 2 failed; 2943 passed / 36 parser failures. Log: /tmp/moyyi-delivery2-check-a.log. No assertions removed or widened.
- Native fixture sanity against installed M6 host: real IPC/parser flow and restart passed, 4 synthetic requests / 0 network / 0 credential reads; native UI not yet verified. Fixture data cleaned.

## Paid usage ledger
- Frozen budget: 0 real model requests.
- Spent: 0; remaining: 0. Synthetic fixtures are offline and separate.

## Decisions taken / waiting for the owner
- Single feature-list.json with generated static entry graphs; no new dependencies or dynamic loading.
- Shared lifecycle invalidation coordinates cross-feature resets; feature patches are checked against declared keys.
- Preserve the original checkout's uncommitted docs/tasks/2026-10-26-optimization-plan.md; never stage it here.
- One PR; Claude reviews and accepts. No merge/daily replacement or public release has been performed.
