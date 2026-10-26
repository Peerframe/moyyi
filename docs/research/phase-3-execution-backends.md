# Phase 3 execution backends: upstream comparison

## Daily CLI extension, 2026-10-26

The daily CLI reuses this native adapter and the document parser's fixed Node dependency probe.
An explicit `--shell-toolchain node` selects the current `process.execPath`, not a PATH lookup,
project script or host-addon inventory. One clean subprocess returns only bounded `sharedObjects`;
the helper grants regular files and exact compatibility aliases, never an inferred directory.
The temporary probe home is removed on success or failure. Discovery does not install packages.

The reviewed baseline remains Node **v26.0.0**. Its
[diagnostic-report documentation](https://github.com/nodejs/node/blob/v26.0.0/doc/api/report.md)
documents `sharedObjects` and explains that `--report-exclude-network` disables reverse DNS during
report generation. The probe also excludes report environment data. Its
[CLI documentation](https://github.com/nodejs/node/blob/v26.0.0/doc/api/cli.md) documents startup
configuration through `NODE_OPTIONS` and `OPENSSL_CONF`; a newly constructed environment omits
inherited loader options and fixes `OPENSSL_CONF=/dev/null`. No model-selected argument reaches
the discovery subprocess. Its time/output limits remain 5 seconds and 128 KiB.

CLI shell grants explicitly select a read-only project; controlled file-write grants do not
change that mode. The selected access mode is included in process preparation and approval.
Existing trusted hosts retain read-write compatibility when the new setting is omitted.
The existing [SRT v0.0.81 source pin](https://github.com/anthropics/sandbox-runtime/blob/c40cf14a65d025e3cd27f071f13a73c12b3b1f92/src/sandbox/macos-sandbox-utils.ts)
also separates read authority from write roots. On Linux, the
[bubblewrap v0.9.0 manual](https://github.com/containers/bubblewrap/blob/v0.9.0/bwrap.xml) defines
`--ro-bind` and the non-recursive behavior of `--remount-ro`: therefore protected-descendant pins
must also remain read-only, rather than reintroducing writable child mounts. Scratch remains
writable and existing secret masks/network denial remain in force. Tests that require project
output must use their supported no-write mode or scratch; failure does not trigger wider grants.

This is a narrow reuse of moyyi's existing adapter, not a new sandbox framework. No new dependency
or upstream source is copied. Native platform conformance, lifecycle and package checks remain
the acceptance gates; this extension does not alter paid-task budgets or claim broader tool support.

Research date: 2026-10-25. D6 was subsequently accepted: native OS sandbox default, Docker optional.
See [ADR 0013](../decisions/0013-native-process-sandbox.md) for the accepted decision and
[phase 3 handoff](../tasks/2026-10-25-phase-3-shell.md) for implementation evidence.
The comparison below preserves the reasoning and limits that informed that decision.
No source was copied into moyyi, no dependency installed, and no model was called.

## Conclusion

Prefer a platform-native default for a personal local agent, with a separate container backend
when stronger environment/lifecycle isolation is requested. This recommendation was accepted as D6 while preserving D3. The earlier recommendation to require Docker plus a filtered workspace
copy was premature: it combined three independent decisions and assumed a stronger stopping
contract than the roadmap's explicit process-group cancellation.

Separate these decisions:

1. **Access boundary:** what the running command can read, write and connect to. D3 requires actual
   OS enforcement and no unrestricted fallback. Approval alone is not this boundary.
2. **Lifecycle:** which processes cancel/timeout stops, how exit is verified, and what remains
   unknown after a crash. A process-group signal is not proof that all deliberately detached
   descendants stopped; a container also needs lifecycle handling when its client disappears.
3. **Workspace:** direct work in the selected directory versus a copy with later import. Containers
   can bind the real workspace; copies are an additional product and synchronization choice.

Do not adopt a weaker default just because another project has one. moyyi must retain its own
protected paths, clean credential boundary, explicit roots, journal and fail-closed policy.

## Codex: platform-native local execution

Reviewed public source at commit
[`970111f6cb62cc02fe36a82ea7d71b37a2889c97`](https://github.com/openai/codex/tree/970111f6cb62cc02fe36a82ea7d71b37a2889c97).
Latest release observed was `rust-v0.164.0` (2026-10-23); this is a source comparison, not a proposal
to depend on a newly published release.

- [Core support matrix](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/core/README.md)
  uses `sandbox-exec`/Seatbelt on macOS, with configured filesystem roots and protected metadata.
  Linux uses bubblewrap for policies needing read-only/denied carveouts, retaining a compatible
  Landlock path for eligible legacy policies. This is direct local execution, not mandatory
  copy-and-import.
- [Seatbelt base](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/sandboxing/src/seatbelt_base_policy.sbpl)
  starts deny-by-default, allows fork/exec with inherited policy, and narrowly supplies platform
  services needed by real developer tools. A tiny custom profile is not equivalent to this tested
  compatibility work.
- [Process-group helpers](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/utils/pty/src/process_group.rs)
  signal the group and label cleanup best-effort. Linux has a parent-death signal; the corresponding
  helper is a no-op elsewhere. macOS retries denied group signals against current group members.
  These helpers do not establish capture of arbitrary descendants that create another session.
- [Linux launcher](https://github.com/openai/codex/blob/970111f6cb62cc02fe36a82ea7d71b37a2889c97/codex-rs/linux-sandbox/src/bwrap.rs)
  includes new-session, die-with-parent and, by default, PID namespace isolation; network namespace
  policy is separately applied. This is stronger lifecycle isolation than a group signal alone.

Borrow the separation of resolved policy and host adapters, actual enforcement, output/lifecycle
tracking, and explicit platform differences. Do not copy its source or claim the same support
matrix without implementing and testing our smaller supported scope.

## Claude Code: native shell sandbox separate from permissions

[Official sandbox documentation](https://code.claude.com/docs/en/sandboxing) reviewed on the date
above describes Seatbelt on macOS and bubblewrap on Linux/WSL2, plus a proxy for domain-level
network control. Commands operate in permitted working directories; a full workspace copy is not
required for the local shell path. Permission prompts and OS sandboxing are separate controls.

The same document also identifies defaults that moyyi should not inherit: sandboxing can be off;
reads can cover most of the host and environment variables can be inherited unless configured;
other tools run outside the shell sandbox; unavailable-sandbox fallback and unsandboxed retries
need explicit strict settings to disable. D3 already requires stricter failure and credential
handling for moyyi.

The shell sandbox runtime is public, but the complete Claude Code command/cancellation path is
not established by inspecting that library alone. Do not infer an absolute process-tree or
parent-crash guarantee from the documentation's filesystem/network inheritance statement.

The public SRT source was also checked at `v0.0.81`, commit
[`c40cf14a65d025e3cd27f071f13a73c12b3b1f92`](https://github.com/anthropics/sandbox-runtime/tree/c40cf14a65d025e3cd27f071f13a73c12b3b1f92).
Its [macOS profile](https://github.com/anthropics/sandbox-runtime/blob/c40cf14a65d025e3cd27f071f13a73c12b3b1f92/src/sandbox/macos-sandbox-utils.ts)
protects read-denied paths inside writable roots against rename/unlink workarounds. Its
[Linux backend](https://github.com/anthropics/sandbox-runtime/blob/c40cf14a65d025e3cd27f071f13a73c12b3b1f92/src/sandbox/linux-sandbox-utils.ts)
uses PID/network isolation. Its [standalone CLI](https://github.com/anthropics/sandbox-runtime/blob/c40cf14a65d025e3cd27f071f13a73c12b3b1f92/src/cli.ts)
signals a child and maps some signal termination to success; that is neither a suitable moyyi
outcome mapping nor evidence of the closed-source Claude Code lifecycle. The version is a
research pin, not an added dependency.

## OpenCode: useful command lifecycle, not a substitute for D3

Reviewed `v1.19.4`, actual tag revision
[`148842ef7cb1bc34192b3fff57d0f9721ab9c801`](https://github.com/anomalyco/opencode/tree/148842ef7cb1bc34192b3fff57d0f9721ab9c801).

The [active shell tool](https://github.com/anomalyco/opencode/blob/148842ef7cb1bc34192b3fff57d0f9721ab9c801/packages/opencode/src/tool/shell.ts)
checks permission patterns and paths, starts in the real cwd, inherits host environment with
plugin additions, and requests a detached process group on Unix. The underlying
[spawner](https://github.com/anomalyco/opencode/blob/148842ef7cb1bc34192b3fff57d0f9721ab9c801/packages/core/src/cross-spawn-spawner.ts)
sends TERM to the group, waits three seconds, then escalates to KILL, with single-child fallback.
That is process-group cancellation, not a universal descendant guarantee. The newer
[core Bash implementation](https://github.com/anomalyco/opencode/blob/148842ef7cb1bc34192b3fff57d0f9721ab9c801/packages/core/src/tool/bash.ts)
explicitly treats path scanning as advisory and describes host-user authority.

Borrow clear allow/ask/deny interaction, cancellation and truncation reporting. Do not treat
command parsing as kernel confinement, inherit secrets, or assume that output spooling means
total disk usage has a hard bound. [Permission documentation](https://opencode.ai/docs/permissions/)
describes approvals, not an OS sandbox guarantee.

## OpenHands: execution environments as replaceable backends

Reviewed software-agent-sdk `v1.58.2`, revision
[`d2ee0cdea60825608c2f8906eb54e1d4d264fb42`](https://github.com/OpenHands/software-agent-sdk/tree/d2ee0cdea60825608c2f8906eb54e1d4d264fb42).
The [official overview](https://docs.openhands.dev/openhands/usage/sandboxes/overview)
distinguishes container execution from a process backend without container isolation.

[DockerWorkspace](https://github.com/OpenHands/software-agent-sdk/blob/d2ee0cdea60825608c2f8906eb54e1d4d264fb42/openhands-workspace/openhands/workspace/docker/workspace.py)
runs an agent-server in a detached container. Configured volumes can directly bind a real
workspace; it does not mandate filtered copying or approval-based import. An omitted network
setting is not network denial. Normal cleanup stops the container. This helper alone does not
prove cleanup after client SIGKILL; the wider platform may have additional lifecycle services.
The [PTY terminal](https://github.com/OpenHands/software-agent-sdk/blob/d2ee0cdea60825608c2f8906eb54e1d4d264fb42/openhands-tools/openhands/tools/terminal/terminal/subprocess_terminal.py)
uses sessions/groups and escalating signals; other terminal backends must be evaluated separately.

Borrow the backend boundary and the distinction between a soft wait timeout and termination.
Do not import its Python agent-server/HTTP/terminal platform just to run moyyi commands. A
container is an execution mechanism, not a complete network, mounts or lifecycle policy.

## Goose: convenient native execution with important limits

Reviewed `v1.56.0`, revision
[`9949cf926cd42f1d128b9991ed23a496ecace896`](https://github.com/aaif-goose/goose/tree/9949cf926cd42f1d128b9991ed23a496ecace896).

Its [developer shell](https://github.com/aaif-goose/goose/blob/9949cf926cd42f1d128b9991ed23a496ecace896/crates/goose/src/agents/platform_extensions/developer/shell.rs)
starts bash/sh in the real cwd. The reviewed cancellation path kills the child, and output
collection has an unbounded channel before display truncation. These are source observations,
not an adversarial run of Goose. Its separate [subprocess helper](https://github.com/aaif-goose/goose/blob/9949cf926cd42f1d128b9991ed23a496ecace896/crates/goose/src/subprocess.rs)
uses Linux parent-death handling, but the reviewed native shell construction does not call it.
Its [Docker example](https://github.com/aaif-goose/goose/blob/9949cf926cd42f1d128b9991ed23a496ecace896/documentation/docs/docker/docker-compose.yml)
binds the workspace directly and mounts SSH material read-only; read-only does not protect a
secret from disclosure and must not become a moyyi default.

Borrow concrete subprocess race tests and evaluation discipline; do not lower moyyi's kernel
boundary or hard output bounds to match this implementation.

## Evaluation implications

[Goose Harbor](https://github.com/aaif-goose/goose/blob/9949cf926cd42f1d128b9991ed23a496ecace896/evals/harbor/README.md)
and [OpenHands evaluation records](https://github.com/OpenHands/software-agent-sdk/blob/d2ee0cdea60825608c2f8906eb54e1d4d264fb42/.agents/skills/manage-evals/references/eval-infrastructure.md)
separate harness revision, model configuration, task environment, budget and observed results.
For moyyi, compare identical models/tasks/budgets and keep error/timeout/cost separate from pass
rate. This turn made no real model comparison. Offline conformance and filesystem probes cannot
establish model capability, cost or latency advantages.

## Local readiness evidence and its limits

The following probes used only disposable synthetic files/processes, no credentials or model:

- macOS 27.0.1, build 26A434: `sandbox-exec` exists. Its local manual marks it deprecated. This
  does not mean it has ceased to enforce restrictions; maintained local agents still use it.
- A child can create another session/process group. Denying direct `setsid`/`setpgid` syscalls
  did not prevent `posix_spawn` with the corresponding attributes in our probe. Therefore a
  group-kill guarantee must not be expanded into an arbitrary-descendant guarantee.
- Two independently written minimal deny-default Seatbelt shell profiles aborted with SIGABRT
  before their file checks. They were not Codex/Claude profiles. This is an incomplete native
  adapter readiness result, not proof that upstream sandboxing is ineffective.
- The already installed Docker Desktop was started for disposable testing. Engine 29.5.2,
  Desktop 4.76.0, Linux 6.12.76 on arm64 were observed. An already cached official image
  `node@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553`
  contains Node 24.21.0 and was created 2026-09-09; it was not pulled or selected as a product
  dependency. moyyi itself still uses Node 26.
- With network none, non-root UID, read-only root, all capabilities dropped, no-new-privileges,
  default seccomp and resource limits: synthetic staging was writable, system/outside writes
  and unmounted canary reads failed, a synthetic host environment sentinel and daemon socket
  were absent, and a TEST-NET connection failed with ENETUNREACH.
- Killing the probe container stopped a detached-session descendant, verified by its synthetic
  heartbeat ceasing. **Host/client SIGKILL, internal watchdog, stdin-lifeline and daemon crash
  were not tested.** The probe does not constitute a completed reliable-stop implementation.

All probe containers and fixture directories were removed. No command targeted an existing container, image or user data for mutation or removal. No private corpus was opened. There is no new command tool in this PR.

## D6 options for moyyi

| Option | Benefit | Cost / boundary | Recommendation |
|---|---|---|---|
| Native default: Seatbelt on macOS, bubblewrap on Linux | Direct use of local project/tools; no required VM or copy/import subsystem | Separate platform adapters and conformance; macOS group cancellation cannot promise all detached descendants or parent-crash cleanup | Preferred default for the personal agent, subject to owner acceptance of the precise stop contract |
| Docker as required execution backend, filtered copy and approved import | Clear separate filesystem/process environment; termination can target the whole container | Daemon/image lifecycle, CPU/RAM/startup, cross-OS dependencies, copy cost and change import conflicts; parent-death cleanup still needs implementation | Prefer for explicitly stronger isolation; not automatically the default |
| Linux first with bubblewrap, macOS shell unavailable | Strong PID/network namespaces without a Docker requirement on Linux | Does not provide a local shell to the owner's current Mac | Viable only if the owner prefers the platform limitation |

For the native route, retain mandatory file/network confinement, scoped/revocable grants, no
credential inheritance, bounded input/output/deadlines, durable process effects and unknown
outcome handling. Define stopping as verified handling of the owned process group; report
uncertainty instead of claiming universal cleanup. A detached/unknown process must not cause
an automatic retry or a false success claim. If the owner requires unconditional termination of
arbitrary descendants after any host crash, select the stronger backend and prove that contract;
do not quietly call the weaker mode equivalent.

For the copy route, a normal recursive copy or hardlink is insufficient. Export only bounded,
validated ordinary files, exclude protected/runtime metadata, and validate all outputs after
execution. Import must compare current real-workspace hashes and ask for the new exact changes.
Current phase 2 does not provide arbitrary delete, directory creation, binary mutation or
multi-file atomic rollback; those must be explicitly designed rather than hidden in shell output.

D6 is **accepted** through ADR 0013. Native implementation is now authorized; Docker remains
optional. No phase 4 work is authorized. Earlier probes above are historical research evidence,
not substitutes for the implementation acceptance recorded in the current handoff.
