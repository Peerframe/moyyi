# ADR 0027: Opt-in bounded workspace path navigation

Status: accepted for implementation; real-model quality remains unverified.

## Problem and evidence

The fixed four-request public task read its final source files on the last tool-capable request.
The fourth request correctly disallowed tools, so its factually correct JSON never became the
required report.json. The original checker failed. The same product can legally read, write,
verify and answer within four requests if it knows the relevant paths at the start. This does
not explain the original Skills task's separate missing facts and unsupported default-policy claim.
Neither failure changes the original questions, checkers, request budgets or source snapshots.

## References and alternatives

Reviewed primary source versions on 2026-10-26:

- Aider, Apache-2.0, commit `5dc9490bb35f9729ef2c95d00a19ccd30c26339c`:
  [base_coder.py](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_coder.py),
  [repomap.py](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/repomap.py),
  [repo-map tests](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/tests/basic/test_repomap.py).
  It supplies bounded repository orientation before requesting the next model response. Adopt
  that placement; do not import symbol ranking, parsers, summaries or its editing architecture.
- OpenCode, MIT, commit `c0c7bae726798d02592f8d3305891ba2f0cd880a` (v1.19.4):
  [todowrite](https://github.com/anomalyco/opencode/blob/c0c7bae726798d02592f8d3305891ba2f0cd880a/packages/core/src/tool/todowrite.ts)
  and [tests](https://github.com/anomalyco/opencode/blob/c0c7bae726798d02592f8d3305891ba2f0cd880a/packages/core/test/tool-todowrite.test.ts).
  A task list records model-supplied status; it does not verify dependencies, evidence or files.
  Adding it alone would not close this observed gap.
- Goose, Apache-2.0, commit `f9572251aedf3e63f4ac7c3f60269acc05b897db`:
  [stop hook](https://github.com/aaif-goose/goose/blob/f9572251aedf3e63f4ac7c3f60269acc05b897db/crates/goose/src/agents/state_machine/ops_stop_hook.rs)
  and [lifecycle tests](https://github.com/aaif-goose/goose/blob/f9572251aedf3e63f4ac7c3f60269acc05b897db/crates/goose/src/agents/state_machine/tests/hooks_lifecycle.rs).
  An end-of-turn check can request continuation when permitted. It cannot restore a tool slot
  after the last allowed tool request without changing our request budget.

A larger list-tool preview still requires the model to choose discovery first. The opt-in path
context removes that initial discovery request for small workspaces without changing list's
existing output or silently expanding default host behavior. It adds bounded local I/O and
context overhead. No upstream source or prompts are copied or substantially adapted; no new
runtime dependency is introduced. moyyi retains its own core and permission boundary.

## Decision

Add `RuntimeOptions.workspaceNavigation?: boolean`, default false. Copy and validate the setting
before asynchronous startup. When enabled, register a context-source plugin that receives only
an expiring `workspaceNavigation.read()` port. It returns regular workspace-relative file paths,
not source bodies, inferred dependencies, task-specific answers or executable instructions.
Filenames are untrusted JSON data. Models must still inspect relevant source.

Runtime scans within the existing protected-path, no-alias and workspace boundaries. It loads
bounded .gitignore files to filter paths; no source bodies are read. Each directory requires
explicit automatic `list` access and normal `list` preparation access. Each necessary ignore-file
check requires equivalent `read` access. Restrictive plugin rules apply in both prepare and
execute phases. Missing grants, ask and deny do not authorize I/O. A denied root or required
ignore read makes the overview unavailable; a denied child directory is omitted and marked
partial. Unavailable does not mean empty. No action digest or approved effect is fabricated.

The breadth-first scan is limited to 200 paths, 8,192 serialized result bytes, depth four below
the root, 10,000 visited entries and 64 admitted directories including the root. Failed directory
identity checks consume their admission slot. The directory limit also bounds queued directories
and the granted path set rechecked around I/O. Protected, aliased, denied and excess paths are
omitted with explicit truncation/skipped metadata. Ordinary ignore exclusions are intentional
filtering. Absence from the overview never proves source absence. It is not an atomic filesystem
snapshot and does not strengthen the existing same-user filesystem threat model.

Reads within one collection share a frozen result. Every later collection rescans, including
after workspace edits. Cancellation, policy epoch changes and expired collection scopes revoke
the port; previously granted operations are checked again. No global navigation cache is added.

The plugin marks its section optional. The context builder first attempts the complete request
under the existing budget. On capacity failure only, it removes all explicitly optional sections
and attempts the same required request again. Required history, instructions, tools, compaction
and unresolved effects remain; if they cannot fit, the original capacity failure remains. The
report lists omitted section IDs. Compaction compares the original and proposed required context
with optional sections excluded from both sides. Dropping navigation cannot count as summary
savings; re-admitting navigation cannot make a genuinely shorter summary appear ineffective.
Ordinary requests still perform full optional admission afterwards. The exact admitted request
is recorded normally. Persisted v1,
provider profiles, model reasoning, quotas, retries and final-request toolChoice:none are unchanged.

## Acceptance and limits

Tests cover opt-in/default-off behavior, operation-specific permissions in both plugin phases,
ignore rules, aliases, limits, cancellation, refreshed results, revocation and expired ports.
An optional section cannot displace required content or increase the existing 10,000-token test
capacity. Runtime compaction tests reject longer summaries whether navigation was omitted before
or only after the proposal, and accept a truly shorter summary that can re-admit navigation.
A real runtime/filesystem/SQLite scenario supplies the original public fixture paths
before request one, then uses scripted read/create/verify/final steps and the unchanged checker.
An unrelated write is denied and final toolChoice is none. Network requests are zero.

This deterministic scenario demonstrates a feasible delivery path, not autonomous model choice
or answer correctness. The previous real-model failures remain failures. A separately authorized
live run is required before claiming improved real-model acceptance; old paid budgets stay sealed.
