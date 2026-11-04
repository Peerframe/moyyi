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
The final code candidate is `b2ef510`. Full checks, packaging, external-copy desktop acceptance
and offline package acceptance passed again; the verified app and paired CLI are installed.
Native functional checks passed on `bffb6fc`. Its 780 × 560 test-copy check found a read-only
notice overlapping scrolling text; `b2ef510` adds only background, border and inline padding
to that notice. The final narrow notice check passed, the temporary copy was removed, and the
official installed app reopened its real history and was left running. Local delivery is complete.
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
168 files / 3170 tests, including typecheck and lint. Its CSS token overrides also passed
`npx biome check apps/desktop/renderer/chat.css`.

After the narrow-window notice correction, final source `b2ef510` passed `npm run check`
again with 168 files / 3170 tests, then `npm run desktop:package`, `npm run verify:desktop`
and `npm run verify:package -- --offline`. These are final-build checks; the native functional
functional checks retain their `bffb6fc` attribution. Final `b2ef510` notice and relaunch
observations are recorded separately below.

## Package coordinates

- Source: `b2ef51026857c6ac5778c0e36ff331cc7e0e8190`, clean package tree.
- Desktop ZIP SHA-256: `3534f0c02419db0f4a8b0b3d1f59b34201d4003a479a2205f1c6ff751431858c`.
- Runtime tarball: `moyyi-0.0.0-d2929f40aa14.tgz`.
- Runtime SHA-256: `d2929f40aa14a4021bbea7e181dc33372a69332125a99c6a044cb66f31985809`.
  Compared with the earlier qualified tarball, only bundled `docs/desktop.md` changed;
  runtime executable files are unchanged. Offline package acceptance was nevertheless rerun
  against this final artifact.
- Backup: `~/.moyyi/backups/pre-chat-ui-2026-11-04T11-38-41.641Z`.
- Local-only candidate; no published release or new paid model request.

## Installation evidence

- Installed app: `~/Applications/Moyyi.app`; installed CLI: `~/.local/share/moyyi`.
  Both local installation manifests identify final source `b2ef510` and its qualified runtime.
- The final installation was checked against all 2594 app files/symbolic links and all 428
  runtime package files, with no differences from the qualified artifacts. The preceding
  `bffb6fc` app bundle digest, retained ZIP and runtime tarball also matched their receipts;
  strict signatures passed for that app and the retained M6 app.
- 392 of 393 protected files match the pre-upgrade backup byte for byte. Only `data.sqlite`
  changed: every table is unchanged except metadata `persisted_format`, migrated from 1 to 2.
  Sessions, entries, effects, snapshots, materials, settings and host configuration are preserved.
- Removed only this delivery's duplicate temporary app copies. The complete paired M6 backup
  and package archives remain available.
- After unlock, `bffb6fc` launched from the installed path and reopened real history.
  Markdown tables, inert code spans and expandable/scrollable tool details were visibly checked.
  An existing available workspace reopened read-only. Ordinary Return inserted a newline without
  submitting; the unsent draft was cleared. Settings, materials, results, complete history,
  management, new-session cancellation and read-only permissions were checked in that app.
- The first post-unlock window had stale painting despite updated accessibility state. A normal
  quit/relaunch restored drawing; subsequent navigation and all checks above remained responsive.
  This was not reproduced or attributed to a code change.
- The [normal settings screenshot](assets/2026-11-04-chat-desktop/normal.jpg) shows the final
  installed `b2ef510` app at 1120 × 800 logical pixels. The
  [narrow settings screenshot](assets/2026-11-04-chat-desktop/narrow.jpg) retains `bffb6fc` evidence
  for that unchanged layout. Neither contains credentials or private transcripts; the
  [evidence and method note](assets/2026-11-04-chat-desktop/README.md) records their exact limits.
  For minimum width, the documented delivery-two method was reused: copy the verified app and
  change only initial BrowserWindow
  dimensions from 1120 × 800 to 780 × 560 in temporary `main.mjs`, preserving minimums and all
  other app resources. The native screenshot is 1560 × 1120 Retina pixels. This is a native
  test-copy check, not a manual resize or a screenshot of the unmodified installed app.
- That narrow copy confirmed responsive settings and table layout, and exposed the transparent
  read-only notice. After correction, a fresh `b2ef510` native copy at 780 × 560 visibly kept
  the notice readable over scrolling table content. Its final screenshot is retained locally
  because it includes real history. The temporary main file was restored and every app asset
  matched the installed app before the test copy was removed.
- Final `~/Applications/Moyyi.app` launched, reopened existing history including a rendered table,
  and was left running on its settings page. Final native flags and dimensions are recorded in
  the local installation manifest. Temporary duplicate apps and the keep-awake process were
  removed/stopped. The unsent composer test draft was cleared.
- Final read-only data comparison after native checks: all 14 sessions, 14 runs, 279 entries,
  158 effects and 10 snapshots match the backup; 229 blobs and all settings/host files are
  unchanged. No new model run or message was recorded.
