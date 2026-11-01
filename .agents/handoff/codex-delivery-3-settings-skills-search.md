# Handoff: delivery three — review with installed acceptance blocked

- Brief: `docs/tasks/2026-10-30-delivery-3-settings-skills-search.md`; owner fee amendment `de28e57`.
- Branch: `codex/delivery-3-settings-skills-search`; worktree:
  `/Users/yxflc/.codex/worktrees/delivery-3-settings-skills-search/moyyi`.
- Last agent: Codex, 2026-11-01 Asia/Singapore. A–H implemented; three review fixes complete; not accepted.
- Draft PR: https://github.com/Peerframe/moyyi/pull/56 — Claude review, installed acceptance blocked.
- Durable details: `docs/tasks/2026-10-30-delivery-3-record.md` and screenshot index beside it.

## Current review fixes (2026-11-01)

- Product fixes: `954dc229635c74cc307ac3fb3b428e680d092188`; installed probe:
  `c1dba793d16a534097dc5c4936a45e2c34d0adc1`, pushed to the existing draft PR #56.
- Zero-enabled Skills now register no library/tool/catalog. One revoked suffix uses the selected
  session's recorded request tools and survives restart. Concurrent refresh and cancellation tested.
- Legacy shared keys are never deleted; unshared desktop keys retain cleanup. Native confirmation
  names the connection and exact key consequence, defaults to cancel, and rejects stale state.
- Final local check type/lint pass; 4-worker tests had 8 existing timeout failures. Serial full suite:
  3261/3262 pass, only the already-reviewed documents.test.ts:105 5 s timeout remains. No limits changed.
- Local skills 33/33, instructions 36/36, runtime 10/10, offline package, desktop package and external
  desktop verification passed. CI run 41294909237: all three jobs passed at `c1dba79`.
- Native normal/narrow settings screenshots and both alert AX/cancel checks complete. Sheet screenshot
  API returns blank images; this limitation is recorded. Zero model/search/real credential/network
  calls. Disposable app quit, restored/hash-checked and removed. No agents or processes remain active.
- Current ZIP SHA-256: `c76e94a5c69e1e4e9256693021cf8244834aec00f44384f2e2e93c3e5920ddc0`.
  Runtime tarball: `7e611c18343c0a2f0e261cbc0dc27e6c8ee3e95dcbf3f88472cf50334aaa78d7`.
  Packaging manifest retains its pre-checkpoint dirty source stamp; final package verification rebuilt
  the identical tarball at `c1dba79`. See the delivery record for exact provenance and commands.
- The original checkout's two user documents and daily installation/data remain untouched.
- Remaining: Claude/owner review and the prior installed-live acceptance decision below. No paid
  rerun is authorized; these review fixes do not mark the overall delivery accepted.

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
