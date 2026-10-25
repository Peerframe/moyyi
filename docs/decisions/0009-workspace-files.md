# 0009: Runtime-confined workspace reads and bounded literal search

Status: accepted for batch 5 (2026-10-25)

## Context

After the batch 4 core passed review, the owner authorized a read-only file plugin under the
existing [D3 boundary](0006-security-boundaries.md). The agent needs useful workspace inspection
without exposing the host filesystem, a command runner, permission overrides or provider calls.
This is an implementation of the accepted boundary, not a new D-class architecture decision.
Batch 6 and paid model calls remain outside this work.

## Decision

`ToolContext.files` exposes only `read`, `list` and `search`. `WorkspaceFilesFactory` lives in
contracts, while a runtime adapter performs Node filesystem I/O. The executor creates a scoped
capability for each preparation or execution invocation and supplies its live authorization
guard. The plugin imports only contracts and its own code; it receives no file descriptors,
raw filesystem object, policy mutator or process capability.

The `fs` plugin registers `read`, `list` and `search` as read effects. Its preparation only
validates and snapshots arguments; the host performs actual path and authorization checks
during execution. These reads depend on no prepared-world assumption, so preparation emits no
preconditions. In particular, protected or escaping paths must fail at the capability boundary,
not trigger an approval request for a stale path precondition. Public schemas reject additional
properties. Paths are workspace-relative, and callers cannot select another root, bypass
protected paths or request regex, shell or network behavior. Search always applies its scoped
ignore rules; explicit read and list do not treat ignore rules as an access policy. Missing host
support fails explicitly rather than falling back.

### Operation-time boundaries

The host checks the selected workspace, both lexical and resolved paths, protected resource
names and runtime-private exclusions. Explicit read/list can follow a symlink only when its
resolved target remains authorized. Recursive search does not follow symlinks. Root and target
identity are checked before and after access; regular file reads use `O_NOFOLLOW` on the final
open, `fstat` verification, bounded descriptor reads and post-read checks before returning data.
Nonregular and multiply-linked file reads are rejected. Files that change during a read fail
instead of returning a possibly inconsistent snapshot.

These checks reduce ordinary replacement races, including changes between preparation and
execution. They do not constitute an OS sandbox against a hostile process running as the same
user. `O_NOFOLLOW` addresses the final component; Node's public filesystem API does not expose
`openat`/`openat2` for kernel-anchored traversal. Repeated path checks do not make that race atomic.
The existing threat-model limit remains explicit; adding a native helper or a general sandbox
is not necessary to deliver this accepted phase. No Windows or network-filesystem guarantee is
introduced without corresponding evidence.

Authorization is checked around asynchronous I/O and before returning content, using the
executor's cancellation signal and grant revision. Revocation followed by regrant cannot revive
an older capability. The capability expires when its invocation ends. Cancellation stops further
work and discards unreturned content; handles are closed after pending operations settle. Node
cancellation cannot retract an individual OS read that was already issued.

Protected filenames remain a conservative deny list, not a universal secret detector. Repository
metadata, runtime-owned data and configured private roots are excluded independently of ignore
patterns. No filename, search query, plugin configuration or `.gitignore` negation grants access.

### Search and ignore dependency

Use bounded literal substring search in the runtime rather than launching ripgrep in this batch.
Limit traversal depth, visited entries, scanned bytes, per-file bytes, line snippets, matches and
ignore-file bytes. Return explicit incompleteness when a scan or result bound is reached. UTF-8
decoding and binary checks apply before text is returned. Tool output remains bounded JSON with
`truncated` metadata; the core retains its independent serialized-output cap.

Use exactly `ignore@7.0.12` (MIT, released **2026-10-02**, source commit
`75533efaf15781d80427941af5accfe987008fbb`). It has no runtime dependencies and is older than the
required two-week stabilization window as of review. `7.0.13` (2026-10-19) and `7.0.14`
(2026-10-23) are too new for this selection. The library only matches supplied patterns; the
host owns safe loading, per-directory scope, ancestor inheritance and pruning. Matching is
explicitly case-sensitive and does not load Git global configuration or external ignore files.
A symlinked `.gitignore` is not followed, matching Git's documented behavior.

Newer upstream releases fix edge-case matching differences. Until a qualifying upgrade is
reviewed, reject affected/unsupported pattern forms rather than silently searching files that
should have been ignored. This includes whole path segments of three or more unescaped stars,
root-only anchored globstars (`/**`, `/**/`, and corresponding negations), unsupported POSIX
character-class names (including inherited object names such as `__proto__` or `constructor`),
literal-prefix/globstar forms such as `foo**/bar`, and escaped path separators. The supported
POSIX class names are `alnum`, `alpha`, `blank`, `cntrl`, `digit`, `graph`, `lower`, `print`,
`punct`, `space`, `upper`, and `xdigit`. The runtime may conservatively reject related ambiguous
spellings; it must not rewrite a pattern into a broader grant. Oversized, unreadable or unsupported
ignore rules terminate search explicitly; rules are never truncated and then partially applied.
Ordinary `*`, `**`, anchored patterns, negation, nested rules and excluded-parent behavior remain
part of the required deterministic validation. This is a documented supported subset, not a
claim of complete equivalence with every Git configuration and edge case.

### Alternatives and tradeoffs

`ripgrep@15.2.0` was released on **2026-07-15**, is MIT/Unlicense, and has official macOS arm64/x64
and Linux release archives with SHA-256 checksums. It is a viable future search backend. Using it
now would add binary selection, checksum verification, packaging and subprocess cancellation;
its traversal/configuration surface would also need to preserve the same host authority checks.
It does not eliminate path races or supply the application's permission policy. The bounded
Node implementation fits the current read-only capability and avoids introducing a child-process
surface. It offers less throughput and no regex, which is an explicit first-version tradeoff.

A handwritten gitignore matcher would add avoidable compatibility maintenance. A native
directory-handle backend could provide stronger race resistance, but would introduce platform
build/distribution work for a threat boundary not currently claimed. Either backend can replace
the host adapter without giving plugins authority over the core. No upstream implementation
source or OpenBot implementation was copied or adapted.

## Evidence and validation scope

Primary evidence reviewed on 2026-10-25:

- [Node 26.0 filesystem documentation](https://github.com/nodejs/node/blob/v26.0.0/doc/api/fs.md):
  filesystem check/use races, descriptor access, `O_NOFOLLOW` and cancellation limitations.
- [Linux `openat2`](https://man7.org/linux/man-pages/man2/openat2.2.html): kernel path-resolution
  controls are stronger than a final-component `O_NOFOLLOW`; they are not claimed by this adapter.
- [ignore package metadata](https://registry.npmjs.org/ignore/7.0.12),
  [publication times](https://registry.npmjs.org/ignore), and
  [versioned source](https://github.com/kaelzhang/node-ignore/tree/7.0.12): exact version, license,
  dependency surface and tested matching implementation.
- [Changes after 7.0.12](https://github.com/kaelzhang/node-ignore/compare/7.0.12...7.0.14) and
  [known matching differences](https://github.com/kaelzhang/node-ignore/issues/155): reasons for
  the temporary fail-closed syntax boundary rather than an unqualified Git-compatibility claim.
- [Git ignore rules](https://git-scm.com/docs/gitignore): directory-relative precedence,
  negation/parent-directory behavior and refusing to follow symlinked ignore files.
- [ripgrep 15.2.0](https://github.com/BurntSushi/ripgrep/releases/tag/15.2.0),
  [versioned guide](https://github.com/BurntSushi/ripgrep/blob/15.2.0/GUIDE.md), and
  [licensing](https://github.com/BurntSushi/ripgrep/blob/15.2.0/COPYING): distribution candidates
  and search/filtering behavior considered but not installed.

Plugin tests use mock capabilities for schema/delegation, denial, unavailable hosts, cancellation
and bounded JSON. Host tests use disposable real files for containment, replacement, protected
resources, binary/large-file handling and ignore rules. Runtime integration must verify revoked
and expired capabilities and the model/tool/store loop. Final command results belong in the
delivery handoff; these distinct test scopes do not establish OS isolation or real-model quality.
