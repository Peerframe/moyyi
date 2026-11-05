# ADR 0055: Regular-expression search

- Date: 2026-11-05
- Status: accepted by the owner as part of the Claude Code–level roadmap. Amends the "no regex"
  tradeoff in [ADR 0009](0009-workspace-files.md); every other part of ADR 0009 stands.

## Context

ADR 0009 chose bounded in-process literal search over launching ripgrep, and gave up regex as an
explicit first-version tradeoff. Coding agents routinely search with patterns: definitions
(`^export (function|class) `), several names at once (`foo|bar`), or word boundaries. With
literal search alone the model spends one search per spelling, and moyyi's request budget makes
each extra call costly. DeepSeek Harness (`packages/fs/tool-fs-search`, commit
`fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`) exposes a ripgrep-regex `grep` backed by a packaged
`rg` binary.

JavaScript regular expressions backtrack. A pattern such as `^(a+)+$` on a long line can run for
minutes, and on the runtime thread it would block cancellation and every other run.

## Decision

- `search` gains an optional `regex: boolean` (default `false`). With it, the query (still one line
  of 1 to 256 characters) is compiled as a JavaScript regular expression: Unicode mode when the
  pattern is valid there, otherwise the legacy syntax, so ripgrep-style escapes such as `\"` work.
  `caseSensitive: false` adds the `i` flag. Lines are tested one at a time, so `^`/`$` anchor
  lines and no match spans lines. An invalid pattern is refused before any file is read.
- Traversal, ignore rules, protected paths, filters, scan and result bounds, context windows and
  presentation are unchanged: regex only replaces the per-line test.
- Matching runs in an eval `worker_threads` worker (no extra packaged file) with a 64 MiB heap
  limit. The worker receives text the runtime already read under its checks and returns line
  indexes; it has no file or process access. Each search has a cumulative 5-second matching budget.
  When it is spent, the worker is terminated and the result sets `regexTimeLimit: true` and
  `truncated: true`; later files are not searched. Cancellation terminates the worker at once.
- Literal search is unchanged, including its error text, and `regex` is recorded in the action
  payload only when the model sets it, so earlier recorded actions keep their digests.

## Consequences

- One search can cover alternatives, anchors and word boundaries; a pathological pattern costs at
  most the budget and is reported as incomplete evidence, never as "no matches".
- The model-visible `search` description and schema change (see the fs plugin README's model
  experience); the tool prefix changes once.
- Syntax follows JavaScript, not Rust regex: lookaround and backreferences are accepted, and the
  budget, not the engine, bounds their cost.

## Rejected

- **Packaging ripgrep** (DSH's approach): ADR 0009's reasons still hold (binary selection, checksum
  verification, subprocess cancellation, and keeping traversal under the runtime's own checks).
- **A hand-written linear-time engine**: avoids the worker but adds a second regex dialect to
  maintain and test.
- **Rejecting "dangerous" patterns statically**: nested quantifiers are only one source of
  super-linear time; adjacent quantifiers (`\s*\s*\s*x`) also blow up, so a static check cannot
  bound the cost.
