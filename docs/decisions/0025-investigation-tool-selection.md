# ADR 0025: Consistent source selection and safe argument feedback

Status: accepted for this implementation, 2026-10-26. Existing authority, persistence, model,
prompt and request-budget decisions remain unchanged.

## Evidence and scope

The [whole-agent plan](https://github.com/Peerframe/moyyi/blob/21f51ee/docs/tasks/2026-10-26-optimization-plan.md)
separates usable investigation tools, measured factual task quality and later editing/session/web
outcomes. Its documentation PR is independent of this product PR. Four deterministic probes on
`650a00b06bcabc308d9cebeffc0e037658eb6457` exposed concrete tool gaps: exact-file search failed,
30 test hits crowded one implementation hit without file filtering, no file-discovery output
existed, and `contextLines:25` returned only a generic schema error. No model was needed to
reproduce these gaps. A previous real answer also misinterpreted delivered source; these interface
changes alone cannot prove that reasoning problem solved.

The [pinned upstream review](https://github.com/Peerframe/moyyi/blob/21f51ee/docs/research/2026-10-26-agent-navigation.md)
covers Codex `970111f6`, OpenCode `v1.19.4`/`c0c7bae7`, Aider `5dc9490b`, SWE-agent `3ea751c0`
and mini-SWE-agent `04d809ce`, including licenses, source/test references and limits. Codex's
command primitives and OpenCode's core grep support precise file selection; SWE-agent distinguishes
file discovery from windowed reads. OpenCode's legacy grep can widen an exact file to its parent,
which motivates a matching-sibling counterexample here. We adopt interface ideas, not their runtime
or prompt code. No upstream source was copied or substantially adapted.

## Decision

Extend the existing read capability and fs search tool, with no new dependency or shell access:

- Accept an exact regular file or a directory. Exact files retain root-to-parent ignore rules,
  protected-path checks, safe descriptor reads, cancellation and live revocation checks. They do
  not inspect sibling contents. A leaf symlink is rejected; the existing explicit-directory
  internal-symlink behavior is unchanged.
- Add bounded `include`/`exclude` patterns. Each supplied list has 1–8 patterns, each 1–128
  characters; reject empty lists and unsupported syntax. Match workspace-relative paths, OR
  includes, then exclude. Filters run before candidate body reads, do not revive ignored paths
  and do not silently remove tests.
- Use the existing Node 26 [`path.posix.matchesGlob`](https://nodejs.org/api/path.html#pathmatchesglobpath-pattern)
  for literals, `*`, `**` and `?`. Node documentation marks the API stable since 24.8/22.20;
  the project's Node 26 runtime already provides it. Local Node 26.0.0 probes verify that `*.ts`
  does not match `src/a.ts`, `**/*.ts` does, and ordinary wildcards exclude leading-dot names.
  Reject absolute/traversal/control/backslash patterns, negation, braces, classes and extglobs.
  This narrow grammar avoids silently promising full ripgrep/glob syntax.
- Add `mode: "files"`, returning distinct paths, `matches: []`, no context and a file-count
  `maxMatches` limit. Default content results retain their shape. Preserve all scan, file,
  entry, depth, match and output limits. A matching file still uses the same bounded body read;
  file discovery is not an index. Output clipping removes whole path entries.
- Replace generic argument mismatch feedback with bounded, safe declared fields and constraints.
  A numeric error can say `/contextLines must be <= 20`. Only short declared schema names,
  whitelisted error categories and numeric limits enter diagnostics. Dynamic keys, rejected
  values, raw Ajv/parser diagnostics and entire schemas do not. Nested undeclared paths fall
  back to a declared parent or the argument root. Parsing/compilation failures use fixed text.
  Keep coercion, defaults and removal disabled. Schema-invalid input still fails before prepare/workspace I/O;
  no automatic repair, clamping or extra request is introduced.

## Alternatives and exit condition

Adding shell authority merely to gain ripgrep would widen a read-only task. A custom glob engine
or new dependency duplicates Node's existing matcher. A whole-repository graph, more context,
another model or another agent does not resolve these four interface gaps and would add cost
before the remaining failure is isolated. More prompt advice is also unsupported by the evidence.

Actual disposable-file and runtime evals must verify exact scope, filtering, deduplication,
field-error transport/recovery, source text/line fidelity and unchanged denial/limit behavior.
Unit tests additionally cover malformed inputs, protected/ignored/link paths, revocation and
output clipping. Existing task checkers and original acceptance criteria stay unchanged.
These are offline mechanism checks with scripted model output, not autonomous correctness scores.
After this finite gate passes, deliver and measure task quality separately under a new bounded
authorization; do not reuse the exhausted eight-request grant or widen the gate indefinitely.
