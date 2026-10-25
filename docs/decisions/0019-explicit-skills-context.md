# ADR 0019: Explicitly activated Skills through the context port

Status: accepted for this implementation, 2026-10-26. D1–D6 and persisted v1 are unchanged.

## Decision and evidence

Add a `skills` context-source plugin and a runtime-owned `readEnabled()` port. The trusted host
selects one absolute library root and up to eight names. This activates the selected SKILL.md
texts on every ordinary request. There is no catalog scan, model-selected activation, skill
installation, automatic reference traversal or script execution. `allowed-tools` cannot authorize
anything. The current context lifecycle already provides policy, cancellation, request persistence
and replay; a separate harness or OpenBot control plane would duplicate ownership.

Primary evidence reviewed on 2026-10-26:

- [Agent Skills specification](https://github.com/agentskills/agentskills/blob/69ef37e9424c0a7ea9dd2293b559e43ec8176379/docs/specification.mdx),
  exact revision `69ef37e9424c0a7ea9dd2293b559e43ec8176379`: SKILL.md frontmatter/body,
  directory/name agreement, optional metadata and progressive disclosure. We implement explicit
  host activation with full selected text; supporting resources remain unimplemented. The
  [reference validator](https://github.com/agentskills/agentskills/tree/69ef37e9424c0a7ea9dd2293b559e43ec8176379/skills-ref)
  is Python; adding a Python subprocess/runtime would cost more than a bounded adapter here.
- [`yaml` public document/AST API](https://eemeli.org/yaml/): YAML 1.2 core schema and AST
  inspection permit rejection of alias/tag/key constructs before object conversion. Selected
  [2.9.1 release](https://github.com/eemeli/yaml/releases/tag/v2.9.1), commit
  `1440ecd3d1bff41e4ac399f8f6839e810328bd16`, ISC. npm registry publication time is
  `2026-09-11T20:30:10.905Z`, 45 days before review, satisfying the two-week release requirement.
  This patch limits recursive merge aliases and simplifies quoted-string unfolding. OpenBot used
  2.9.0; we take this maintained patch while still rejecting all aliases. Package has no runtime
  dependencies; exact version and integrity are locked. Parser exceptions are caught without source
  excerpts; header bytes, nodes and depth remain bounded. No dependency implements agent policy.
- [`js-yaml`](https://github.com/nodeca/js-yaml)'s public `load` interface parses to JS objects.
  It is a viable general parser, but `yaml`'s public AST supports the specific pre-conversion
  alias/anchor/tag/key checks directly. A hand-written YAML splitter/parser would miss scalar,
  duplicate-key and alias behavior; only the Markdown/frontmatter delimiter split is local.
- OpenBot revision `010439bb9002fabb7e1facd8450ee85edbafa309`,
  `packages/employee-publisher/src/agent-skills.ts` and Python skill parser/tests: useful bounded
  AST checks and YAML 1.2 scalar failure cases. The small AST-validation approach is adapted,
  the shape checks and port integration are rewritten. MIT attribution is retained in
  [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md) and
  [provenance](../openbot-provenance.md). No publisher identity, authority or secret-text heuristic
  is imported. The OpenBot checkout was read only.

## Boundary and tradeoffs

Runtime copies the root/name selection once. The port cannot take a model-selected path. It uses
moyyi's existing confined reader under an explicit automatic-read policy plus normal read prepare
checks and restrictive plugin rules in both phases. Skill policy requests carry absolute selected
host paths; existing AGENTS.md policy requests retain the relative filename. Denied/ask/missing
policy hooks produce unavailable notices without I/O; invalid/missing enabled files stop the
request. `.gitignore` does not revoke an explicit read. Default configuration enables no Skills
and performs zero extra reads.

The reader rejects root/skill/file aliases and hardlinks, protects private roots, checks file and
directory identity, bounds UTF-8 reads and follows policy revision/cancellation. OS aliases in
root ancestors retain the existing reader behavior. The port is shared within one collection and
expires on completion/cancel/failure. New requests recollect; no stale-cache or empty-success
fallback is introduced. This is application confinement, not same-user hostile-process isolation.

The [supported profile and limits](../skills.md) explicitly narrow identifiers to ASCII, require a
body and reject advanced YAML features. Limits are 12 KiB/file, 48 KiB accepted skill text (plus
16 KiB project guidance), 4 KiB frontmatter, 256 nodes/depth 8 and bounded string metadata. This
keeps startup/configuration small while supporting normal skills. The whole-request budget
remains authoritative: over-budget requests fail without dropping guidance. More roots, catalog
selection and reference access can be added later with evidence and explicit capability rules.

The plugin emits a source label/hash and exact decoded source text as JSON-framed guidance, never
host paths. Newline parsing does not rewrite recorded text. The existing request record and exact
record/replay comparison already bind it; no persisted field or public eval checker changes.
Permission enforcement is code, not an assumption that the model obeys the warning.

## Acceptance

`npm run eval:skills` uses actual runtime/SQLite/disposable files with scripted responses to test
selected-only scope, refresh, compaction, policy denial/revocation, lifetime/cancel/failure,
UTF-8/size/YAML/link/protected-path failures, inert tool grants, exact recording/replay and combined
context budgets. Parser and reader tests cover YAML scalar behavior and deterministic replacement
races. `npm run check` retains all existing gates. `npm run verify:package -- --offline` additionally
loads and refreshes a skill through the installed public runtime with no checkout-source fallback;
the guide and license notice are in the reviewed package inventory. These are offline wiring and
authority results, not a live-model instruction-following benchmark or official publication.
