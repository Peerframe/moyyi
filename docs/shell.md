# Sandboxed commands

The `shell` plugin runs bounded commands inside an explicitly granted workspace. The runtime
uses native Seatbelt on macOS or bubblewrap on Linux. Its core, approvals and journal are moyyi's;
no upstream Agent SDK is used. D6 is recorded in [ADR 0013](decisions/0013-native-process-sandbox.md).

## Enable deliberately

Add this to your existing explicit trusted host module passed with `--host FILE`:

```ts
workspaceProcesses: {
  roots: ["/absolute/path/to/project"],
  approval: "ask",
},
```

The rest of the host module still selects a model and its connection. This example does not
supply credentials or make a request. A file-write grant does not enable commands. The default
runtime remains read-only; `--demo` retains its finite read-only demonstration. The existing CLI
shows the exact command/cwd/timeout/backend approval and uses Ctrl-C to request cancellation.
An explicit host may choose `approval: "allow"` within its selected roots. Installed code and host
modules are trusted; model output and project files cannot create grants or change the backend.

Arguments are `command`, optional workspace-relative `cwd` (default `.`), and `timeoutMs`
(default 30,000, maximum 120,000). The runtime also enforces the enclosing run deadline.
No interactive stdin, persistent terminal or background-service API is provided.

## What the command can access

- Read/write ordinary files in the exact granted workspace, and use a private temporary home.
- Read required system binaries/libraries. Additional toolchain executables and libraries require
  explicit host `executablePaths` (exact executable files) and `readOnlyPaths` grants. A Homebrew
  or custom Node installation is not automatically exposed with the rest of the host home.
- Host/external network access is denied. Linux uses an isolated network namespace; its own
  loopback/IPC is not a connection to host services. Shell does not
  receive the model connection's keys, SSH agent socket, proxy settings or arbitrary parent env.
- Credential names, `.git`, moyyi state and explicit `protectedPaths` are protected. Outside
  symlinks do not grant outside data. Pre-existing hard-linked ordinary files and special files
  are refused because they can alias outside data or communicate through host IPC.
- The bounded workspace scan currently refuses more than 30,000 entries or 64 levels. Large
  dependency trees can require a narrower selected project. It never silently scans only a prefix.

macOS requires `/usr/bin/sandbox-exec`. Linux requires a security-maintained bubblewrap and
permitted user/PID/network namespaces. Ubuntu CI pins `0.9.0-1ubuntu0.3` plus
`apparmor-profiles=4.0.1really4.0.1-0ubuntu0.24.04.9` and loads the distribution
`bwrap-userns-restrict` profile. On Ubuntu 24.04, an administrator may need to enable that
profile; moyyi never disables AppArmor or changes host sysctls automatically. Unsupported OSes,
unavailable isolation and invalid configuration fail closed. No ordinary-host-shell fallback.
Docker is reserved as an optional backend; this delivery does not expose Docker execution or
introduce workspace copying/import. It is not required to use the native command tool.

## Results and stopping

Zero/nonzero exit describes the command's observed result, not whether it fulfilled the user's
request. A command may modify files before failure. Command edits have no automatic snapshots,
undo or transaction; the phase 2 file tools remain the snapshot-backed route.

Output from stdout/stderr shares a hard byte budget. Exhaustion terminates the group instead
of spooling unlimited output. Timeout, cancellation and permission revocation send TERM, then
KILL after a short grace period. Normal exit also cleans up the owned group. Inherited pipes have
a bounded wait. Interrupted/uncertain effects become `unknown`, stop the run and retain the lease;
restart does not rerun them. Inspect the workspace before deciding how to proceed.

On macOS, deliberately detached descendants and immediate cleanup after host SIGKILL are not
promised. Their file/network sandbox is independent of process-group membership. Linux's PID
namespace provides an additional lifecycle boundary. Native mode is not a CPU/memory/disk quota
system, a hostile same-account boundary, or a whole-command rollback mechanism.

Linux masks existing protected entries with read-only mounts. Newly created command-owned files
with protected-looking names are not existing host secrets; concurrent injection of host secrets
into an active workspace is unsupported. Do not add private material during a command. macOS
also applies name restrictions dynamically. Custom toolchain grants are trusted read authority;
select public binaries/libraries, not directories containing user secrets.

## Reproducible offline check

```sh
npm run eval:shell
```

Seven scripted scenarios run the real runtime, SQLite, shell and OS boundary on disposable files.
They check approved task effects, denial, read-only defaults, secret/outside protection, timeout
and output flood. No private evals or model calls are loaded. Unit/integration suites cover the
remaining lifecycle and recovery cases. See [comparison protocol](research/harness-comparison.md)
for same-model measurement requirements; no real-model score is claimed.
