# 0013: Native process sandbox and explicit command authority

Status: accepted (2026-10-25), owner decision D6; implemented on phase 3 branch, awaiting PR review

## Decision and authorization

The owner accepted native operating-system sandboxing as the default and Docker as an optional
backend after reviewing the [fixed-source comparison](../research/phase-3-execution-backends.md).
Phase 3 may proceed on its branch and PR. No automatic merge, paid model call or phase 4 work.
D1-D5 and persisted v1 remain unchanged.

The personal agent directly uses the explicitly granted workspace. macOS uses Seatbelt; Linux
uses bubblewrap. No unrestricted-shell fallback is permitted. Docker is an optional future
execution backend, not a prerequisite, automatic fallback or copy/import subsystem in this phase.
It must meet a separately verified mount, credential, network and lifecycle policy before exposure.

## Ownership and authority

- Add a process capability through `ToolContext`, supplied only to process-effect tools. The
  `shell` plugin never imports filesystem/process APIs and cannot choose environment or backend.
- Reuse the core's exact digest approval, workspace lease, durable started barrier and unknown
  effect handling. The core change is an extension of this existing guarantee, not another loop.
- A host-selected process grant is separate from file writes and defaults to asking approval.
  Roots are exact; permission changes revoke active capabilities. Prepared command, cwd, timeout,
  sandbox and directory identity bind to approval. Execute is single-use with no replacement args.
- Start with a clean environment, a private temporary directory and no command network access.
  Protect credentials, repository control metadata, runtime state and host-selected private paths.
  Required toolchain access is explicit trusted host configuration, never a model-selected path.
- Bound command size, execution time and captured output. Overflow stops execution instead of
  accumulating unbounded memory or spool files. No persistent terminal/background job service.

## Cancellation, failure and recovery

Each execution owns a process group. Cancellation, timeout, revocation and output exhaustion
initiate TERM followed by bounded KILL escalation. Normal shell exit also cleans up remaining
members of the owned group. Tool return waits for bounded cleanup and does not wait indefinitely
for inherited output pipes. Partial effects are possible even after termination.

The accepted macOS contract is process-group cancellation, not unconditional termination of
arbitrary descendants that deliberately create new sessions, nor guaranteed cleanup after host
SIGKILL. Filesystem and network restrictions must remain inherited independently of group
membership. Linux adds a PID namespace. An uncertain outcome is journaled as unknown, stops the
run and is never automatically replayed. Restart recovery inspects the journal; it does not run
an interrupted command or infer success from its intended command line. No command rollback.

## Alternatives and evidence

The fixed-source comparison covers Codex, Claude sandbox-runtime, OpenCode, OpenHands and Goose.
Requiring Docker and copied-workspace import adds daemon/image management, synchronization,
conflict detection and cross-OS toolchain costs without being required by the original process-
group contract. Native execution preserves local project behavior while keeping actual OS limits.
Plain host subprocesses and command-string filters cannot satisfy D3.

No upstream Agent SDK or source is copied. Node's built-in child-process API supplies lifecycle
primitives; native OS backends remain narrow host adapters. The reviewed Node baseline remains
v26.0.0 ([process API](https://github.com/nodejs/node/blob/v26.0.0/doc/api/child_process.md)).
Platform availability, actual isolation and cleanup require real disposable-process tests;
mocked plans and policy assertions alone are not acceptance. Offline evals measure conformance,
not real-model competence. Same-model harness comparisons remain unrun without authorized model
access; their protocol must be explicit rather than reporting invented results.

Linux CI uses Ubuntu 24.04's security-maintained `bubblewrap=0.9.0-1ubuntu0.3`, published
2026-09-17 UTC (2026-09-18 Asia/Singapore), older than the brief's two-week minimum. This OS prerequisite is installed only in
CI; no npm dependency or user-machine installation is added. Compared with new upstream
releases and a bundled binary, the distribution package reuses Ubuntu's security integration
and avoids a binary build/update pipeline. See the [package](https://packages.ubuntu.com/noble/bubblewrap),
[dated publication](https://lists.ubuntu.com/archives/noble-changes/2026-September/059045.html),
and [upstream v0.9.0 source](https://github.com/containers/bubblewrap/tree/v0.9.0).
An unavailable or policy-blocked executable must fail closed, including in CI; tests do not
silently skip actual Linux isolation. No host sysctl or remote repository protection is changed.

The Linux launcher explicitly combines `--unshare-user` with `--disable-userns`, supported by
[upstream v0.9.0](https://github.com/containers/bubblewrap/blob/v0.9.0/bwrap.xml). It disables
further user namespaces inside the sandbox; this writes a namespaced limit, not the host's
sysctl. A setuid backend or unavailable namespace capability is rejected, not downgraded.

The first Linux CI (`40176393792`) failed before launching commands: Ubuntu AppArmor denied
bubblewrap's isolated loopback setup (`RTM_NEWADDR`). Installing bubblewrap alone is insufficient.
CI additionally pins `apparmor-profiles=4.0.1really4.0.1-0ubuntu0.24.04.9` (Ubuntu archive publication
2026-09-24) and loads its supplied `bwrap-userns-restrict` profile, as described by the
[official sandbox setup](https://github.com/openai/codex-security/blob/af973f94224aea3035b96987e878301a3769da8c/github-action/README.md#ubuntu-sandbox-setup).
The [Ubuntu package](https://archive.ubuntu.com/ubuntu/pool/main/a/apparmor/) was inspected: it
allows namespace setup by bwrap and denies capabilities to executed children. This is scoped
runner setup, not disabling AppArmor or global user-namespace restrictions. No runtime silently
changes host security settings. Denial probes now require a real shell launch marker first, so
an unavailable backend cannot masquerade as successful confinement.
