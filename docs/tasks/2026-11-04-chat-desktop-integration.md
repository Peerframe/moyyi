# Chat desktop integration — 2026-11-04

## Outcome

The owner requested the latest Chat UI in the installed local application, including its real
runtime connection, packaging, backup and installation. Reuse the approved Chat design and the
existing desktop bridge; do not replace daily functionality with mock data.

## Acceptance

- Real session catalog, reopen, new workspace, recorded messages, streaming and cancellation.
- Existing exact approvals, materials, permissions, model settings, complete history, results,
  effects and maintenance remain reachable.
- Unsupported mock-only actions cannot claim successful effects; send failures retain drafts.
- No new persisted/settings format, permission or request-budget changes. The paired installation
  includes the previously accepted format 2 migration from delivery one; keep the format 1
  programs and their data backup together.
- Focused checks, full `npm run check`, packaged external-copy desktop verification, and native
  screenshots at normal/minimum widths. Preserve pre-existing test failures as evidence.
- Back up existing application, sessions and settings, install the verified app and compatible
  CLI, then verify the actual installed entry. No public release.

## Current state

Implementation complete on `codex/chat-desktop-integration`, based on Chat UI `1538d88`.
The final code candidate is `bffb6fc`. Packaging and external-copy acceptance passed, and the
verified app and paired CLI are installed. Final native display acceptance is pending Mac unlock.
The M6 installation and paired CLI/data/settings are backed up together.

## Known evidence

Before this delivery, `npm run check` passed typecheck/lint and 3148 tests; one documents parser
test timed out at 5000 ms and timed out again in a focused run. Chat preview tests passed.

The completed integration passed `npm run check` with the packaged Node 26.12.1: 168 files,
3169 tests. The parser test passed without changing its timeout or assertions. Final focused
Chat, routing, projection, boundary and feature-extension checks passed 9 files / 71 tests.

The first package (`5b0a6d3`) passed `npm run desktop:package`, `npm run verify:desktop` and
`npm run verify:package -- --offline` (7 CLI cases). Installed native launch, real history
(including a missing workspace in read-only mode), and the real model settings form worked.
The installed paired CLI reopened an existing session in a PTY and exited without a model call.
Native inspection found raw Markdown tables; `bffb6fc` reuses the existing inert RichMessage
renderer and folds raw tool output into expandable details. Its `npm run check` passed
168 files / 3170 tests, including typecheck and lint. The final CSS token overrides also passed
`npx biome check apps/desktop/renderer/chat.css`.

## Package coordinates

- Source: `bffb6fcaa67815283c7a5774c03a0ec7343b860f`, clean package tree.
- Desktop ZIP SHA-256: `71dc6a80fb33eec19f6ae8cb0e76f00f915deb0cd5a1783d61b6feebdcb0b95d`.
- Runtime SHA-256: `4091c00536ee44732d869a39d7e38febeb05ecf695a276958e26090977cfff6e`.
  The runtime bytes are unchanged from the package acceptance above.
- Backup: `~/.moyyi/backups/pre-chat-ui-2026-11-04T11-38-41.641Z`.
- Local-only candidate; no published release or new paid model request.

## Installation evidence and remaining acceptance

- Installed app: `~/Applications/Moyyi.app`; all 2594 files and symbolic links match the packaged app.
- Installed CLI: `~/.local/share/moyyi`; all 428 runtime package files match the qualified tarball.
- Both local installation manifests identify the same source and runtime.
- 392 of 393 protected files match the pre-upgrade backup byte for byte. Only `data.sqlite`
  changed: every table is unchanged except metadata `persisted_format`, migrated from 1 to 2.
  Sessions, entries, effects, snapshots, materials, settings and host configuration are preserved.
- Removed only this delivery's duplicate temporary app copies. The complete paired M6 backup
  and package archives remain available.
- Mac locked before final visible acceptance. The final app is left stopped. Still required:
  launch `bffb6fc`, check actual Markdown/table and collapsed tool rendering, current-workspace
  composer and native controls, and save normal / 780 × 560 screenshots. The first candidate's
  native checks do not substitute for this final display verification.
