# Handoff: delivery three — settings, Skills and search

- Brief: `docs/tasks/2026-10-30-delivery-3-settings-skills-search.md` at owner amendment `de28e57`.
- Branch: `codex/delivery-3-settings-skills-search`; base main `26ecc5a3`.
- Worktree: `/Users/yxflc/.codex/worktrees/delivery-3-settings-skills-search/moyyi`.
- Last agent: Codex, 2026-10-30 21:33 Asia/Singapore.
- Checkpoint: A–G implemented; H ready for integration checks. A `6a9c9f2`, B `f8971a3`, C/D `961b8b4`. No PR/installation.

## Done

- Pulled Claude's `de28e57`. Billing stop resolved: 3 acceptance searches count product
  `web_search` calls, each max_uses 5; extra native-search charges authorized (at most 15).
- A: format 1 migrates in memory; first save writes format 2 after exclusive byte-for-byte
  `settings.format1.json` backup. Safe directories/private single-link/no-follow files retained.
  Named same-provider connections have distinct credentials; add/rename/delete/select/search
  selection available, active deletion rejected. UI shows configured status only. Switching
  reopens runtime/reloads same session and revokes grants. Limits remain unchanged.
- B backend: quota classification, nonpersisted origin/error kind propagation, foreign reasoning
  and replay filtering with paired tool calls. Store format 2/schema 3 unchanged. ADR 0048 added.
  Runtime trusted `appendConnectionSwitched` records a bounded credential-free notice while idle.
- B desktop: recorded failed outcomes project safe quota/rate-limit/auth cards without provider
  bodies; synthetic 402/429/401 plus same-session switch tests pass (7 connection tests).

- C: bounded personal-instruction file and settings digest, request-by-request plugin refresh,
  safety precedence and no absolute path in source blocks. File-save failure restores prior bytes
  unless metadata committed. Storage and model-experience tests passed.
- D: reviewed native SKILL.md-only immutable imports, omitted-file listing, one enabled digest
  per name, read_skill with revocation/version/cancel checks. CLI eager Skills remain unchanged.
  Catalog is a bounded recorded request suffix, not a new persisted event or authority.

- E: DeepSeek structured-only native search, explicit grant + each-call approval, fixed auxiliary
  prompt, recorded usage and source-panel/report integration. CLI SearXNG retained. Focused
  98 tests and offline web 9/9 passed. No real search has run.

- F: recorded todo_write cards show all recorded items/statuses; latest expanded, earlier folded.
  Fixed model-reported-progress label, no separate state. Renderer tests passed.

- G: backups hash format 2 settings, personal instructions and every indexed Skill version;
  rescue includes current files, restore still only replaces session store. Rollback rejects
  incompatible settings/store targets. Four maintenance suites: 39 tests passed.

- D fix checkpoint: no-follow readers now reject FIFOs without blocking; UTF-8 BOM bytes are
  retained consistently in review/copy/digest/runtime/backup. Parser ignores only encoding BOM
  for frontmatter while preserving original text and byte limit.

## In progress

- Root owns integration, key-deletion committed-state correction, checks, native/live acceptance and checkpoints.
- `provider_preflight` finished C/D and now owns H external desktop fixture plus verify-desktop
  integration (ready), now owns desktop/skills/design/architecture/provenance documentation. No paid work.
- `search_preflight` owns fixes for review findings: FIFO bounded reads and BOM-preserving Skill/personal text. G is finished (39 focused tests).
- Next: checkpoint E/F, finish G/H, run full required checks and native/live acceptance.
  Native screenshots, external packages and frozen live runs have not started.

## Collected problems (fix pass)

- Independent review: bounded open must reject FIFO without blocking; BOM text/hash must agree
  across storage and runtime; committed deletion must keep UI synchronized after key cleanup failure.
  Fixed: 89 storage/parser/runtime/backup tests and skills 31/31; key cleanup failure host test passed.

- Old module inventory tests may need additive exact sets for new commands/state. Preserve all
  M1–M6 behavioral assertions; do not loosen security checks or limits.
- Shell defaults to Node 22 in this turn. Prefix task commands with
  `export PATH=/opt/homebrew/bin:$PATH` (Node 26.0.0). No global shell changes.

## Commands run

- `git pull --ff-only origin codex/delivery-3-settings-skills-search`: fast-forward to `de28e57`.
- `npm ci --ignore-scripts`: 103 packages installed under Node 26; no dependency changes.
  Earlier Node 22 attempt refused with EBADENGINE, before installation.
- A: original settings/main/wire tests: 3 files, 64 passed.
- A: original settings plus new connections: 14 passed, one new test setup failed because its
  object spread replaced the runtimeOptions callback; fixed setup, new connections 4/4 passed.
- `npm run typecheck`: passed after runtime and desktop integration.
- B focused: 4 files, 156 passed. Earlier broader 615-test run had two new test setup/assertion
  mistakes; corrected and the affected suites passed. See final delivery record for full gate.
- C/D backend: 124 focused behaviors covered; final group 123/124 then corrected new cancellation
  expectation (cancelled run / failed executing read), affected suite 10/10 passed. Typecheck/lint passed.
- C/D storage + F renderer + prior renderer tests: 24/24 passed. Broader 90-test desktop run:
  87 passed; three old slot-inventory fixtures need additive new module entries and an unclaimed
  fixture tool name now that todo_write has its own renderer. No security assertion removed.
- E backend + desktop: 7 files 98 tests and eval:web 9/9 passed, no paid/network calls.
- `npm run check`, other offline suites, packages, native screenshots and live acceptance: pending.

## Paid usage ledger

- Quality gate ceiling 71 model requests: spent 0, remaining 71.
- Installed acceptance 20 model requests + 3 product searches: spent 0 + 0, remaining 20 + 3.
  Each search may trigger at most 5 native searches; fees authorized. Zero retries, failed tasks
  not rerun; one baseline comparison only when required by the brief and within the 71 cap.
- Private host (filename located, credentials not read):
  `/Users/yxflc/.moyyi/evals/delivery-1-model-experience-2026-10-29/host.mjs`.
- Freeze three acceptance checkers and record commit/config/limits before the first paid call.

## Constraints and evidence to retain

- Original `/Users/yxflc/Project/moyyi` has an existing modification to
  `docs/tasks/2026-10-26-optimization-plan.md`; no task edits there.
- Daily app/CLI/settings/store untouched. No key reads, no actual model/search requests yet.
- DSH `/tmp/moyyi-delivery3-dsh` at `f3803c96974ad4a94195fb97e5c637e9c2a3afe3`, source only.
- Billing evidence and decisions D3-1a/D3-3a now live in the amended brief. Structured sources
  are supported; the stop concerned announced billing, not source availability.
- Do not change system overview/roadmap; Claude owns acceptance updates. Keep owner roadmap
  amendment from `de28e57`. One final PR, no merge or replacement of daily installation.
