# Delivery three implementation and verification record

- Brief: [settings, Skills and search](2026-10-30-delivery-3-settings-skills-search.md), including
  owner amendment `de28e57` accepting native search fees and counting product search calls.
- Implementation: Codex. Review and acceptance: Claude. One branch/PR; no merge or daily installation.
- Branch: `codex/delivery-3-settings-skills-search`, based on main `26ecc5a3`.
- DSH reference: `f3803c96974ad4a94195fb97e5c637e9c2a3afe3` (MIT), design borrowing documented in
  [provenance](../openbot-provenance.md#deepseek-harness); no new dependency or upstream code copy.

## Implemented scope

| Part | Result |
| --- | --- |
| A | Named same-provider connections with distinct credential references, explicit active/search selection, first-save format 1 backup and settings format 2 |
| B | Structured quota classification, safe failure cards, same-session explicit switching notice, foreign reasoning/replay filtering with paired tools |
| C | Bounded private personal-instruction file, SHA-256, per-request refresh after default instructions and before project guidance |
| D | Native directory review, immutable SKILL.md-only copies, version selection/revocation, bounded catalog suffix and read_skill |
| E | DeepSeek structured-only native search, explicit grant and per-call approval, recorded token/search usage and source/report integration |
| F | Recorded todo_write cards with full available lists, latest expanded, older folded, model-reported-progress label |
| G | Hash-checked settings/guidance/library backups, current-data rescue, session-only restore and compatible-version rollback |
| H | External installed production host/config/provider-codec synthetic acceptance, additive exact assertions alongside existing M1–M6 checks |

Session format 2 and SQL schema 3 are unchanged. Settings alone move from 1 to 2. CLI configuration,
zero retries, explicit permission grants and the daily installation remain unchanged. ADRs
[0048](../decisions/0048-connection-continuation.md),
[0049](../decisions/0049-personal-instructions-and-skill-library.md) and
[0050](../decisions/0050-deepseek-native-search.md) explain the contracts and limits.

## Checks performed

- Focused provider, storage, runtime, UI and maintenance checks passed. Independent review found
  blocking FIFO reads, BOM text/digest divergence and committed deletion state drift after key
  cleanup failure; all three were fixed with regressions before paid acceptance.
- First full unit run: 3218/3220 passed. Corrected test-only layer imports and the exact preload
  entry inventory, preserving the layer rule and every old behavioral assertion. A subsequent
  run exposed existing process/runtime tests timing out concurrently; the unchanged suite then passed (170 files / 3231 tests).
- Nine offline suites passed: core 25/25, deepseek 18/18, kimi 4/4, web 9/9, skills 31/31,
  instructions 36/36, runtime 10/10, long-sessions 4/4, anthropic 5/5.
- `npm run verify:package -- --offline` passed, including installed declarations and seven PTY flows.
- `npm run desktop:package` and `npm run verify:desktop` passed. H observed eight cases,
  14 synthetic model requests and one synthetic search; zero real network/credential calls.
  Native screenshots found card/header wrapping and search-grant status issues, fixed before
  live acceptance. Final clean package `07ff3e6` passed the full check (3231 tests) and external desktop verification.
  Archive SHA-256: `5cff085d0882850c071a841862a51e44a288bb737f5631bd0a315e6882116bb2`.
  Normal/narrow native screenshots and restart checks are complete. Installed live task acceptance
  failed before any model, search or credential callback; details below.

## Frozen paid envelope

Quality gate ran once against `739275951098b0feb6cbd3892a5001375973a9d0`: all six passed,
30 of 71 requests, zero retries, no baseline rerun required. The installed attempt finished with three failed tasks and zero paid requests; it was not repeated.
The final approval presentation refinement changes only renderer output; model/runtime evidence is reused.
The 30 recorded exchanges match the durable request ledger exactly. Reported totals: 120,031 input
tokens (including 88,832 cache-read), 9,179 output tokens (including 4,492 reasoning). Cache-write
usage is unknown in all 30 responses; it is not counted as zero.
Exact runner, Skill and installed host hashes are frozen privately before execution. Failures are retained; no failed candidate task is rerun.

Quality gate: Flash / Responses / low / 8192 output, write capability, no shell or web, zero retries.
Reuse delivery one's private host configuration and lazy credential callback; a private wrapper
points codec/recording imports at this candidate rather than the old worktree. No key is read,
printed or copied by the agent. Each task runs once against the unchanged fixture and checker.
Only a failed task may run once on main as the required baseline comparison, within the same 71 cap.

| Task | Maximum requests | Timeout | Actual requests / result |
| --- | ---: | ---: | --- |
| deduplicate-roster | 15 | 180 s | 4 / PASS |
| quoted-csv-export | 15 | 180 s | 5 / PASS |
| homework-keep-format | 15 | 180 s | 7 / PASS |
| release-evidence-audit | 10 | 120 s | 5 / PASS |
| website-source-injection | 12 | 120 s | 5 / PASS |
| document-report-seven-formats | 4 | 120 s | 4 / PASS |

Installed acceptance: at most 20 model requests plus 3 product `web_search` calls, each native
`max_uses: 5` (at most 15 successful billable native searches). Three task checkers are frozen
before execution: explicit connection continuation, imported Skill compliance, and search →
granted fetch → report whose every URL must occur in recorded sources. Revocation and restart
checks need no extra model request. The two DeepSeek connection IDs use the same existing private
credential callback in an isolated configuration; this checks actual same-provider switching,
not two independent accounts. Cross-provider continuation and quota paths are synthetic only.

Planning estimate at published peak Flash rates: approximately USD 2.10 for 71 requests at the
64 KiB input / 8192 output envelope, and USD 0.65 for installed model/search auxiliary calls,
plus at most USD 0.01125 in separately authorized native-search fees. This is a conservative
planning estimate, not an invoice or a tokenization guarantee. Actual reported usage will be
recorded. [Official pricing](https://api-docs.deepseek.com/quick_start/pricing/) checked 2026-10-30.

## Installed attempt and acceptance blocker

The single frozen attempt used the clean `07ff3e6` installed app outside the checkout, bundled
Node 26.12.1 and the production host/provider codecs. It failed before transport or credential
access. All three tasks remain **FAIL**, not unavailable, passed, or silently reset.

| Task | Observed result | Model requests | Product searches |
| --- | --- | ---: | ---: |
| Connection continuation | Initial project-instruction read rejected the protected workspace; no model request or switch occurred | 0 | 0 |
| Imported Skill task | Review/import/enable and SHA check succeeded; report-target selection was rejected; finally revocation and unavailable read passed | 0 | 0 |
| Search → fetch → report | Initial project-instruction read rejected the protected workspace; no search, fetch or report occurred | 0 | 0 |

The acceptance runner placed its workspaces below the private evidence directory inside the real
`.moyyi` tree. Existing runtime file protection rejects that path component before reading even a
missing AGENTS.md; desktop report-target protection rejects it too. These guards were present
before this delivery and behaved correctly. This is an acceptance-directory error, not evidence
of a model or native-search failure. It is also not evidence that real native search works.

The owner requires failed tasks not to be rerun, so the attempt and all failed task states are
retained. No retry or new freeze/run followed. A later runner-only fix rejects `.moyyi` output
paths before freezing; its positive/negative self-tests passed. A future authorized attempt must
use a separate private temporary work directory and archive its evidence afterward. The failed
freeze remains immutable; the fixed runner cannot reuse it. No product path check was relaxed.

The installed restart checker passed for the three recorded failed sessions without extra
requests. That checks persistence of those sessions, not successful live task continuation.
The remaining installed allowance is 20 model requests and 3 product searches, but it does **not**
permit repeating the failed tasks under the current instruction. Claude and the owner must
resolve this acceptance blocker before acceptance or merge.

## Native UI and isolation evidence

[Native screenshots](assets/2026-10-30-delivery-3/README.md) cover settings, personal instructions,
Skill review, quota, todo and search approval at 1120 × 800 and 780 × 560 logical pixels.
They use the production renderer/main/host and synthetic provider transport in a disposable app;
geometry and Chromium userData are isolated. No daily credentials or network are used. The
normal approval screenshot shows the full card; the narrow pair shows the query/cost and reachable
action buttons through scrolling.

Native totals: 14 synthetic model requests, 3 synthetic product searches, zero real credential
reads, network attempts or native credential subprocesses. A final restart preserved connections,
active connection, personal instructions, enabled Skill version, complete messages and all six
source rows exactly. Writes/checks/search/page grants reset to read-only and the app remained idle.
The imported Skill was read through the real runtime and the quota card explicitly switched the
same history from synthetic DeepSeek to Kimi. This is synthetic cross-provider evidence only.

After quitting, the disposable bundle's modified files were restored and hash-matched to the final
product, its QA config was removed, and both disposable app copies were deleted. Private native
state/database evidence and the failed installed evidence were retained outside git. The production
archive remains at `artifacts/desktop/Moyyi-local-arm64.zip` with the hash above.

The original checkout's uncommitted optimization-plan edit is preserved. Before/after comparison
of the same seven protected roots matched all **5082** entries (5062 regular files, 20 symlinks):
zero additions, deletions or changes. Regular-file SHA-256 and modes and literal symlink targets
were compared; directory permissions and timestamps are not claimed. The daily app, CLI, session
store, settings and installation pointers were not replaced or changed.

## Review status

A–H are implemented and offline/native evidence is complete. This record is not Claude's acceptance.
The PR is a draft because installed live task acceptance is incomplete. Quality spent 30/71 requests;
installed spent 0/20 model requests and 0/3 product searches; no paid retry occurred. Session format 2,
SQL schema 3, permission bounds and the daily installation remain unchanged. No merge is requested.
