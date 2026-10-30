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
  run exposed existing process/runtime tests timing out concurrently; the unchanged suite then passed (170 files / 3221 tests).
- Nine offline suites passed: core 25/25, deepseek 18/18, kimi 4/4, web 9/9, skills 31/31,
  instructions 36/36, runtime 10/10, long-sessions 4/4, anthropic 5/5.
- `npm run verify:package -- --offline` passed, including installed declarations and seven PTY flows.
- `npm run desktop:package` and `npm run verify:desktop` passed. H observed eight cases,
  14 synthetic model requests and one synthetic search; zero real network/credential calls.
  Native screenshots found card/header wrapping and search-grant status issues, fixed before
  live acceptance. Final clean package and remaining native/live evidence pending.

## Frozen paid envelope

No paid request has run at this checkpoint. Candidate revision and fixture hashes will be recorded
before execution. Failures are retained; no failed candidate task is rerun.

Quality gate: Flash / Responses / low / 8192 output, write capability, no shell or web, zero retries.
Reuse delivery one's private host configuration and lazy credential callback; a private wrapper
points codec/recording imports at this candidate rather than the old worktree. No key is read,
printed or copied by the agent. Each task runs once against the unchanged fixture and checker.
Only a failed task may run once on main as the required baseline comparison, within the same 71 cap.

| Task | Maximum requests | Timeout |
| --- | ---: | ---: |
| deduplicate-roster | 15 | 180 s |
| quoted-csv-export | 15 | 180 s |
| homework-keep-format | 15 | 180 s |
| release-evidence-audit | 10 | 120 s |
| website-source-injection | 12 | 120 s |
| document-report-seven-formats | 4 | 120 s |

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

## Isolation and remaining acceptance

The original checkout's uncommitted optimization-plan edit is preserved. Before acceptance,
5082 daily data, settings, installation, CLI and application files/links were hashed privately.
After acceptance these will be compared, including added data files. No daily keychain write,
store migration, application replacement or merge is authorized for this implementation turn.

This is an implementation record in progress, not Claude's acceptance decision. Final PR,
package hashes, actual paid results, screenshots and protected-file comparison remain to be added.
