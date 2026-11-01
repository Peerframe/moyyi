# Handoff: delivery three — review with installed acceptance blocked

- Brief: `docs/tasks/2026-10-30-delivery-3-settings-skills-search.md`; owner fee amendment `de28e57`.
- Branch: `codex/delivery-3-settings-skills-search`; worktree:
  `/Users/yxflc/.codex/worktrees/delivery-3-settings-skills-search/moyyi`.
- Last agent: Codex, 2026-11-01 Asia/Singapore. A–H implemented; review fixes in progress; not accepted.
- Draft PR: https://github.com/Peerframe/moyyi/pull/56 — Claude review, installed acceptance blocked.
- Durable details: `docs/tasks/2026-10-30-delivery-3-record.md` and screenshot index beside it.

## Current review fixes (2026-11-01)

- User requested three fixes: omit the library when no Skills are enabled, preserve shared legacy
  credentials when deleting a connection, and confirm deletion with accurate credential consequences.
- Code and regression tests are implemented. Skill refresh uses the existing runtime registry;
  no core, persisted format or settings-format change. Zero-Skill tools/messages match the
  no-library baseline, with a one-request revoked notice based on recorded request tools.
- Connection host deletes only unshared desktop-owned keys. Native deletion confirms the displayed
  name and deletion/retention policy, defaults to cancel, and revalidates current state afterwards.
- Focused runtime tests: 14 PASS; desktop empty/disabled-library integration: 10 PASS; settings,
  keychain, native dialog and renderer tests PASS. New offline Skill scenarios: 33/33 PASS.
- First full check exposed two new-test issues (renderer layer import and a wrong event matcher),
  now corrected with focused passing checks, plus the already-reviewed document parser 5 s timeout.
- Product checkpoint: `954dc229635c74cc307ac3fb3b428e680d092188` pushed to PR #56.
  CI check and macos-documents passed. Desktop CI found the old fixture expected the removed
  empty-library message; the fixture now asserts the one-time unavailable suffix, no tool/catalog,
  and retained failure/no-body behavior for an attempted revoked tool call.
- Desktop package and native 1120 × 800 / 780 × 560 cancellation checks complete. The native sheet
  screenshot API produced blank images; exact AX captures plus settings screenshots are retained.
  Isolated app closed and removed; no model/search requests or real vault/network calls.
- Final local check passed type/lint but had 8 timeout-only failures in existing document/eval
  tests; serial full-suite verification is running unchanged. Next: finish local checks and external
  desktop gate, then update evidence and existing PR. No paid process is active.
- No other agent is writing. The original checkout's two user documents remain untouched.
- The existing paid ledger and no-rerun decision below remain authoritative; no live retry authorized.

## Prior product and evidence (before review fixes)

- Clean product revision `07ff3e657399c02ec07fc456f7222c697fb84579`.
- Archive: `artifacts/desktop/Moyyi-local-arm64.zip`, SHA-256
  `5cff085d0882850c071a841862a51e44a288bb737f5631bd0a315e6882116bb2`.
- Subsequent changes are only records, screenshots and a runner preflight for protected output paths.
- `npm run check`: 170 files / 3231 tests PASS. Nine offline suites, offline packaged CLI,
  final desktop package and external `verify:desktop` PASS. H: 8 cases, 14 synthetic requests,
  1 synthetic search, zero real credentials/network. Existing M1–M6 assertions retained.
- Native screenshot coverage at 1120×800 and 780×560 complete. Separate native fixture: 14 synthetic
  requests / 3 synthetic searches, zero real credential/network/native calls. Exact restart checks
  passed for connections, preferences, Skill, messages and six source rows; grants reset read-only.
- Protected before/after: same 5082 files/links, zero additions/deletions/changes. Original checkout's
  dirty optimization-plan file and all daily data/app/CLI/settings remain unchanged.
- No persisted session format, SQL schema or permission/IPC/path check was relaxed.

## Paid ledger — do not repeat

- Quality: **30/71**, six tasks each once on `7392759`, all PASS. Per-task counts 4/5/7/5/5/4.
  Final renderer-only changes reuse that unchanged model/runtime evidence. No baseline rerun needed.
- Installed: **0/20 model + 0/3 product searches**, but the single attempt and all three tasks are
  **failed**, not pending. Credential reads also zero. Remaining allowance is not retry authorization.
- Cause: the runner incorrectly used an output directory under the real `.moyyi` tree for its
  workspaces. Existing file protection rejected AGENTS reads; existing report protection rejected
  the Skill task's target. Skill review/import/enable succeeded before that rejection; finally
  revoke/read-unavailable passed. Native search was never called, so real structured search is unverified.
- Owner says zero retries and failed tasks not rerun. No new paid attempt is authorized. The later
  runner preflight rejects `.moyyi` output paths before freezing; self-tests and Biome passed.
- Private evidence root: `/Users/yxflc/.moyyi/evals/delivery-3-settings-skills-search-2026-10-30`.
  `quality-freeze.json`, `quality-ledger.json`, `quality-summary.json`, `installed/frozen.json`,
  `installed/ledger.json`, failed snapshots/database, `native/`, and protected comparison are retained.
  Never overwrite the failed installed ledger. Earlier `installed-unexecuted-*` freezes all spent zero.
- Existing D1 host/callback is unchanged. Never read/print/copy a credential.

## Remaining decision / handoff

- Claude reviews the single draft PR and owner resolves whether a fresh installed acceptance may be
  authorized despite the no-rerun instruction. A future authorized attempt must use a private temporary
  work directory outside protected `.moyyi`, then archive evidence separately; refreeze current inputs.
- Do not mark installed live tasks passed, merge, update system overview/roadmap as accepted, or replace
  the daily installation. Claude owns those steps after acceptance.
- No active agents, app writers or paid processes remain. Disposable apps restored/hash-checked then
  removed; private evidence retained. Remove this handoff only in the final commit before merge once
  durable results have been moved to the delivery record.
