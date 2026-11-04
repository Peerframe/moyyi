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
- No persisted/settings format, permission or request-budget changes.
- Focused checks, full `npm run check`, packaged external-copy desktop verification, and native
  screenshots at normal/minimum widths. Preserve pre-existing test failures as evidence.
- Back up existing application, sessions and settings, install the verified app and compatible
  CLI, then verify the actual installed entry. No public release.

## Current state

Implementation complete on `codex/chat-desktop-integration`, based on Chat UI `1538d88`.
Packaging and native installation acceptance are in progress. The M6 installation is backed up.

## Known evidence

Before this delivery, `npm run check` passed typecheck/lint and 3148 tests; one documents parser
test timed out at 5000 ms and timed out again in a focused run. Chat preview tests passed.

The completed integration passed `npm run check` with the packaged Node 26.12.1: 168 files,
3169 tests. The parser test passed without changing its timeout or assertions. Final focused
Chat, routing, projection, boundary and feature-extension checks passed 9 files / 71 tests.
