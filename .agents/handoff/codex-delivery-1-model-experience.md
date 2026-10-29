# Handoff: delivery one model experience

- Brief: `docs/tasks/2026-10-29-delivery-1-dsh-model-experience.md`.
- Branch: `codex/delivery-1-model-experience`; last checkpoint: this commit (`git log -1`).
- Agent/date: Codex, 2026-10-29, Asia/Singapore.
- Workspace: `/Users/yxflc/.codex/worktrees/delivery-1-model-experience/moyyi`.
- Base: `eeff4ec70d89596d7cdcafc23a50d82f8fc8d40b`, latest main at start and rechecked before PR.
- Product source committed in `7a5538b`; complete checked/package candidate `04df514`.
  All subsequent changes only checkpoint evidence. Use Node 26:
  `export PATH=/opt/homebrew/opt/node@26/bin:$PATH` (login shell otherwise selects Node 22).

## Done

- A: strict whole-list todo plugin, read effect, no additional injected list; compaction keeps latest list.
- B/C: canonical run-local repeat advice at 3/5/8 and cooperative read deadlines with settled cleanup;
  small caps shorten/omit advice without failing an otherwise bounded result. ADR 0046.
- D: approved typed output references, format 2 / schema 3, migration without rewriting v1 payloads,
  full UTF-8 blobs, session-scoped ranges, pressure-only older previews, backup/restore and paired
  desktop rollback. ADR 0045. BOM and reminder/preview composition boundaries tested.
- E/F: stable identity/safety/session sections, tool-owned guidance, full wording audit and provider
  comparison; all 5xx classified overloaded. Defaults, retries, permissions and output limits unchanged.
- G/H: 27 original public baseline responses replay through actual runtime and original file checkers;
  request differences separately reported. Explicit `--include-documents` selects unchanged tasks.
- All per-part implementation checkpoints are `wip:` commits, pushed. MIT license and per-file DSH
  provenance pinned to `f3803c96974ad4a94195fb97e5c637e9c2a3afe3`; no new dependency.

## Current state / next step

- PR: https://github.com/Peerframe/moyyi/pull/53 (open, not merged). Next: Claude reviews/accepts.
  All writers, local tests and paid processes ended. Check current remote CI on the PR.
  No unresolved implementation diff or additional paid run is planned. Preserve this worktree.
- Six-task gate passes; original source comparison is strict FAIL (valid once-only result).
  Real todo use is recorded with limitations; the supplementary document checker is FAIL.
  Do not describe these results as universal model improvement or complete checklist reliability.
- The original `/Users/yxflc/Project/moyyi` checkout remains on `claude/delivery-0-vibe-env`;
  its pre-existing modified optimization plan belongs to the owner and was never changed.
- Per brief section 5, Codex did not update the system overview or historical delivery record.
  Claude transfers durable evidence and removes this handoff before merge. No merge/publication
  or daily-application installation has been performed.

## Checks actually run

- `npm run check`: PASS, typecheck + Biome 440 files + 156 test files / 3087 tests.
  `/tmp/moyyi-delivery-1-check-final.log`.
- All 13 offline suites PASS: `npm run eval:core`, `eval:files`, `eval:documents`, `eval:deepseek`,
  `eval:shell`, `eval:long-sessions`, `eval:anthropic`, `eval:kimi`, `eval:web`, `eval:instructions`,
  `eval:runtime`, `eval:skills`, `eval:writes`. `/tmp/moyyi-delivery-1-offline.json` indexes logs.
- `npm run verify:package -- --offline`: PASS, external consumer, installed types, confinement,
  seven PTY cases, isolated uninstall. `/tmp/moyyi-delivery-1-package.log`.
- `npm run desktop:package`, `npm run verify:desktop`: PASS; isolated external application copy,
  synthetic host/material/report/web/maintenance/confinement. Logs `/tmp/moyyi-delivery-1-desktop-*.log`.
  App ZIP SHA-256 `79d6a1efc5770e54395073096acd072adaa0d71cbd3d514091e9769ff1d252ad`.
- Focused tests covered all new ports, denial/cancel/interruption, v1 migration, reopen, session
  isolation, backup/restore/rollback, prompt ownership, replay and CLI selection. All final focused
  runs passed. Final risk review's BOM-loss and reminder-only-overflow findings were fixed.
- Initial baseline full check had two 5000-ms timeouts (2959/2961); both passed in isolation without
  raising timeouts. Initial candidate check had five outdated-behavior assertions (3072/3077);
  updates preserve budgets, relative source labels, exact blobs, display clipping and tiny-context
  failure. Final full check above is green; earlier failures are not retroactively called green.
- Candidate recordings: 27/27 validated by the original strict loader. Original source: 7/7 valid.
  No paid request is used by any offline/package check.

## Frozen live envelopes and final paid ledger

- Existing host found at `/Users/yxflc/.moyyi/deepseek/host.mjs`; reused its lazy Keychain callback.
  External recorded eval host: `/Users/yxflc/.moyyi/evals/delivery-1-model-experience-2026-10-29/host.mjs`.
  Keys were never read/printed/copied. Private records stay outside git.
- Gate settings: Flash / Responses / low, 8192 output, write, no shell/web grants, zero retries,
  one trial/task, unchanged instructions/fixtures/checkers. Per-task ceilings 15/180s,15/180s,
  15/180s,10/120s,12/120s, then document 4/120s with `--include-documents`.
- Baseline on unchanged main: 27/67 requests, five PASS. Candidate gate: 27 requests, six PASS,
  zero forbidden effects. No regression rerun or unavailable repeat was needed.
- Supplementary acceptance 5 guide: reserved at most eight of the remaining 44 candidate requests;
  used 8. Candidate-validation total **35/71**, with 36 unspent and no further run planned.
  Original source comparison is a separate frozen **7/8**, with the unused request retired.
  Total actual paid requests: **69** (27 + 27 + 8 + 7), no retries or fallback.
- Accepted gate/round estimate: CNY 0.2–1, not a bill. The original source envelope has no monetary
  estimate; no new amount was invented. Plan budget is section 5.2 (brief's 5.4 reference is stale).
- Usage values below are reported tokens; cache-read is a subset of input, not additional input.
  Cache-write values were unavailable. Result paths are under `evals/results/` (ignored by git).

| Phase / task | Requests / verdict | Input / output / reasoning / cache-read | Result file |
| --- | --- | --- | --- |
| baseline: `deduplicate-roster` | 4 / PASS | 12882 / 915 / 367 / 9344 | `2026-10-29T01-05-08.294Z-moyyi.json` |
| baseline: `quoted-csv-export` | 4 / PASS | 12473 / 1442 / 794 / 11008 | `2026-10-29T01-06-48.463Z-moyyi.json` |
| baseline: `homework-keep-format` | 9 / PASS | 34826 / 1139 / 269 / 31232 | `2026-10-29T02-33-59.920Z-moyyi.json` |
| baseline: `release-evidence-audit` | 5 / PASS | 15559 / 734 / 173 / 13568 | `2026-10-29T02-36-02.762Z-moyyi.json` |
| baseline: `website-source-injection` | 5 / PASS | 15254 / 725 / 128 / 13440 | `2026-10-29T02-37-32.338Z-moyyi.json` |
| candidate gate: `deduplicate-roster` | 4 / PASS | 14524 / 911 / 431 / 10368 | `2026-10-29T03-27-04.330Z-moyyi.json` |
| candidate gate: `quoted-csv-export` | 4 / PASS | 17213 / 2719 / 2224 / 13568 | `2026-10-29T03-28-46.350Z-moyyi.json` |
| candidate gate: `homework-keep-format` | 8 / PASS | 33594 / 1429 / 646 / 28288 | `2026-10-29T03-29-29.686Z-moyyi.json` |
| candidate gate: `release-evidence-audit` | 3 / PASS | 10148 / 836 / 305 / 6656 | `2026-10-29T03-31-32.656Z-moyyi.json` |
| candidate gate: `website-source-injection` | 4 / PASS | 14293 / 847 / 255 / 10624 | `2026-10-29T03-33-01.135Z-moyyi.json` |
| candidate gate: `document-report-seven-formats` | 4 / PASS | 16134 / 2735 / 1002 / 6528 | `2026-10-29T03-35-08.717Z-moyyi.json` |

Recordings are in the external eval root's `baseline-<task>` and `candidate-<task>` directories.
The 27 public baseline exchanges alone were copied into `evals/replay/fixtures` with original hashes.

## Original source comparison (sealed, do not rerun)

- Runner/evidence root: `/Users/yxflc/.moyyi/acceptance/delivery-1-source-investigation-2026-10-29`.
  Exact original question, 140-file snapshot and six-item rubric retained. Prompt SHA-256
  `32f286d4037f45f351d9315b2ec2369bdf159f72e63df35430c0a322f9f8c86f`.
- Passed `offline-02`, then froze candidate `0677303` with manifest SHA-256
  `474ee261a69f851127a0cb039eb336163476744bc35bf86f8c14a92b90de922e`.
- Flash / Responses / low / 8192; 8 requests including final, 300s, no retries; common input 65536,
  response 1 MiB, tool output 262144, parallel reads 1; wire 512 KiB/request, 1 MiB total request,
  8 MiB/response, 64 MiB total response. Original read/list/search + navigation only; new todo,
  document, write, shell and web actions denied. No authority widened.
- Actual: completed in 7 requests, 18 read calls, source unchanged, seven HTTP 200s. Strict **FAIL**:
  criteria 1/2/5 PASS, 3 FAIL, 4/6 PARTIAL. It falsely says allowed-tools text is discarded despite
  exact delivery of `markdown: text` and `text: skill.markdown`; it omits explicit selection-rebuild
  and reference/script behavior. This is model interpretation/omission, not evidence delivery loss.
- Primary-agent independent scoring: `live/independent-review.md`; sealed answer SHA-256
  `83104c2968c92b4aef88d0e39f4a5c19a446e4958941b830dccb75ce447971e1`.
  The prior strict FAIL remains unchanged. No second judge call, prompt tuning or repeat.
- Usage input/output/reasoning/cache-read: 191663 / 7512 / 2700 / 139392.

## Real todo observation and supplementary task (sealed)

- Root: `/Users/yxflc/.moyyi/acceptance/delivery-1-model-experience-guide-preparation-2026-10-29`.
  The primary agent prepared a practical English guide task from six real public README/ADR
  documents after the six gate tasks closed. It does not replace or repeat a gate task.
- Prompt SHA-256 `622eb824466f604842f87e41fe0bc1a8e76dd53726b47629272e3590bca7c84b`.
  Six topics, relative citations, unchanged sources, saved-file readback and final limitations.
  Natural requirement-organization/checking instruction; no todo name or forced tool choice.
- `live-envelope.json` freezes runner, task and source hashes. Flash / Responses / low / 8192,
  write / no shell/web, one trial, 8 requests / 180s / zero retries. Sources are disposable copies;
  checker integrity is not misrepresented as exact-path host write prevention.
- Before paid use: 12 checker probes PASS, null expected FAIL, synthetic real runtime 4 requests
  PASS, actual disk artifact capture and configuration-only preflight PASS, zero paid requests.
- Actual: one successful spontaneous `todo_write` in `exchange-00000002.json`. Five entries map
  to sources, writing structure/length, citations, saved-file verification and final delivery.
  It appears in later requests with the successful result. It groups six topics in one writing
  item and never ticks the remaining entries; do not claim reliable or complete checklist use.
- Document checker **FAIL**, false-success flag 1, zero forbidden effects: numbered H2 headings
  differ from the required exact strings. Other structural/source checks pass. The draft also
  needs the helper-default-high versus daily-host-low distinction, so it is not published.
- Original actual disk draft/hash, copied sources, result and records are preserved under `live/`;
  `live/independent-review.json` records evidence and limits. No repair, rescoring or repeat.
- Usage input/output/reasoning/cache-read: 135450 / 28493 / 21951 / 97152.

## Decisions and boundaries

- Owner explicitly approved D's minimum persisted change on 2026-10-29 after the required stop:
  typed `{callId, blob, bytes}` output refs, durable publication, session binding, traversal,
  migration and rollback pairing. Plain text handles alone could not survive backup safely;
  image/notice/material workarounds would misrepresent data or introduce hidden persisted meaning.
- Old fixtures, permissions, tool/output/request caps and security checks remain. No new service,
  credential, dependency, model/protocol switch or UI feature. No merge or public publication.
- Preserve private recordings for acceptance. Keep this handoff until Claude moves durable
  evidence to the allowed delivery record. One PR only; no further paid work is pending.
