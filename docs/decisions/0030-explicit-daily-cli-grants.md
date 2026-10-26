# ADR 0030: Explicit daily CLI grants

Status: accepted for the local candidate, 2026-10-26.

## Problem and decision

Installed live edit/check/undo and web tasks required a hand-written trusted host. The ordinary
CLI exposed neither per-workspace capabilities nor the request ceiling, and hid structured file
and command receipts. This made implemented capabilities difficult to use as a personal agent.

Add explicit startup flags to the existing CLI: `--allow-write`, `--allow-shell`,
`--shell-toolchain node`, repeatable `--web-origin`, `--web-dns`, and `--max-requests`.
Default host authority, retry policy and request ceiling remain unchanged. These are owner input
at process startup, never project discovery or model tool arguments. The offline demo stays fixed.
Conflicting capability configuration or a custom host policy is rejected rather than replaced.

File writes use the existing snapshot/approval capability for the one canonical selected workspace.
CLI commands independently select a new `workspaceAccess: "read-only"` native mode; `--allow-write`
does not enable command writes. Commands can write private scratch, but not project caches or
build outputs. Existing explicit host process grants default to their prior read-write behavior.
That behavior has no file snapshots or automatic rollback. The selected mode enters preparation,
approval preview and the action digest and is checked again before execution. Persisted v1 does
not change; prior uncertain effects still reconcile without replay.

The optional Node toolchain reuses the document parser's fixed clean Node probe and exact library
alias logic in a small runtime helper. Only this running Node executable and individual libraries
are selected; no PATH lookup, broad installation directory, package manager, external dependency
store or arbitrary addon is granted. Probe timeout/output bounds and cleanup remain mandatory.
The child gets a fresh environment, OpenSSL configuration is `/dev/null`, and Node report flags
exclude network/environment collection. Preparation failure does not enable an unrestricted fallback.

Receipt display takes only bounded whitelisted fields from real, matching effect/tool results;
assistant prose, read content and free-form evidence are not promoted to verified snapshots.
The CLI does not introduce a new executor or `/undo` protocol: users can request the existing undo
tool using the displayed snapshot identity, subject to normal approval and conflict checks.

## Evidence and alternatives

The installed PR #28 task evidence is in the [current plan](../tasks/2026-10-26-optimization-plan.md).
The narrow new boundary reuses [D6](0013-native-process-sandbox.md), existing native containment and
[toolchain alias evidence](../research/phase-3-execution-backends.md). No third-party source is copied.
Targeted primary-source checks use:

- Node **v26.0.0** [report documentation](https://github.com/nodejs/node/blob/v26.0.0/doc/api/report.md):
  excluding network information also excludes reverse DNS; environment collection is independently
  disabled. [CLI documentation](https://github.com/nodejs/node/blob/v26.0.0/doc/api/cli.md) identifies
  loader options and OpenSSL configuration that must not come from the caller's environment.
- bubblewrap **v0.9.0** [manual](https://github.com/containers/bubblewrap/blob/v0.9.0/bwrap.xml): readonly
  bind mounts differ from a nonrecursive remount. The Linux readonly mode must also avoid later
  writable child binds; credential masks remain in place.
- Anthropic sandbox-runtime **v0.0.81**, commit
  `c40cf14a65d025e3cd27f071f13a73c12b3b1f92`,
  [macOS policy](https://github.com/anthropics/sandbox-runtime/blob/c40cf14a65d025e3cd27f071f13a73c12b3b1f92/src/sandbox/macos-sandbox-utils.ts):
  independent read and write roots support keeping check commands readonly. This is a boundary
  reference, not a dependency or copied implementation.

Keeping host-only configuration leaves the demonstrated usability gap. Automatically discovering
project grants or inheriting the user's toolchain environment makes authority implicit. A new
profile framework or command executor adds no required behavior here. The CLI flags are a thin
adapter to current contracts with a removable Node helper, not another agent architecture.

## Validation and limits

Require argument/conflict/approval tests, actual filesystem effects and readonly native-process
negative cases, current CLI/session tests, shell evals and a PTY create/check/undo scenario from
the installed package. Existing budgets, failure thresholds and rubrics remain unchanged.
A finite synthetic model establishes wiring and containment; live task competence is separate.
Default readonly operation, protected paths, TLS/origin checks and no automatic retries remain.
Known native sandbox host-kill/detached-process limits and same-account threats are unchanged.

This adds no search service, browser, GUI, credential backend, model training or public release.
