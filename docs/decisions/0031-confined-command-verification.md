# ADR 0031: Make confined command verification usable

Date: 2026-10-27. Status: accepted for implementation under the owner's ongoing product-work
authorization. D3/D6, the native sandbox default and separate process authority remain unchanged.

## Observed problem

An installed live release-note task omitted one public input record despite complete source and
output readback. It had ten unused requests; more retrieval or a larger quota was not indicated.
A separate, unchanged-task control enabled the existing readonly command capability. Its first
draft was correct, but its two attempted checks failed: macOS `/bin/sh` could not create a heredoc
temporary file, and the unselected system Python startup chain could not access developer settings.
This control does not show that shell verification corrected the earlier omission. Both results
remain in the [delivery record](../tasks/2026-10-26-optimization-plan.md).

The command tool described a generic shell but did not tell the model that the host had selected
Node, that commands had a readonly workspace, or that no process capability was configured at all.
These are environment/contract defects, separate from the model's factual mistake.

## Evidence and choice

- Apple Bash snapshot `51bf3fc6f26e9517c3a2e4bc3d208f9b39b87178`:
  [heredoc creation](https://github.com/apple-oss-distributions/bash/blob/51bf3fc6f26e9517c3a2e4bc3d208f9b39b87178/bash-3.2/redir.c)
  calls the [temporary-file helper](https://github.com/apple-oss-distributions/bash/blob/51bf3fc6f26e9517c3a2e4bc3d208f9b39b87178/bash-3.2/lib/sh/tmpfile.c)
  without `MT_USETMPDIR`. Local system Bash 3.2.57 reproduced the failure with the exact runtime
  profile. Opening a shared system temp directory or making the workspace writable is unnecessary.
- The existing system zsh 5.9 supports explicit
  [sh emulation before other flags](https://zsh.sourceforge.io/Doc/Release/Invocation.html) and
  [`TMPPREFIX`](https://zsh.sourceforge.io/Doc/Release/Parameters.html).
  A same-profile probe used the existing private scratch directory successfully. Emulation is
  not a claim of complete POSIX or Bash compatibility. No shell package is installed or bundled.
- A native Node 26 stdin probe separately exposed failed OS identification. Node
  [v26.0.0 `GetOSInformation`](https://github.com/nodejs/node/blob/v26.0.0/src/node_os.cc) calls
  [libuv 1.52.1 `uv_os_uname`](https://github.com/libuv/libuv/blob/v1.52.1/src/unix/core.c).
  Apple Libc snapshot `71bbe350ab79eef58113991d817ccc6165061a64`
  [`uname`](https://github.com/apple-oss-distributions/Libc/blob/71bbe350ab79eef58113991d817ccc6165061a64/gen/uname.c)
  needs `hw.machine` and `kern.version` in addition to the already permitted identity queries.
  Add only these two public OS-identity keys. No `kern.proc`, argument/environment query or
  blanket sysctl access is granted. Retain the original SIGABRT as failed-probe evidence.

## Implementation

1. On macOS, launch `/bin/zsh --emulate sh -f -c` with fixed `TMPPREFIX` inside the existing
   private scratch directory. Keep the clean environment, private HOME/TMPDIR, denied system
   configuration and all existing workspace/credential/network boundaries. Linux retains `/bin/sh`.
   No model-selected interpreter or unsandboxed fallback is introduced.
2. Runtime captures process roots, mode, selected executables and library grants at construction.
   Both the process factory and the shell tool's description use that snapshot, including after
   development-plugin reload. Changing the caller's object cannot silently change actual grants.
3. The existing shell plugin describes unconfigured/read-only/read-write access, the actual
   platform launcher and at most sixteen safe executable names. Names come from resolved,
   host-selected paths; no environment scan or absolute host path enters the description.
   This information is not permission, proof of launchability or a promise of Python/packages.
   Policy, approval, revocation and filesystem checks remain authoritative on every invocation.

No core loop, persisted format, model/effort/output/request limit, task-specific hint or automatic
verification framework changes. No upstream source or prompt is copied or substantially adapted.

## Acceptance and limits

Real native checks cover heredocs including stdin Node, private scratch use, quoting/pipes/exit
status and nonloading of startup instructions. Existing readonly-workspace, credential, outside
file, network, owned-process argv/environment and cleanup tests remain required. Runtime tests
inspect actual model requests, caller mutations and explicit policy denial. A new shell eval
computes from a disposable JSON input with Node through a heredoc and verifies the exact result
in the next model request; the original seven cases retain their assertions.

Run the unchanged full check, both CI platforms and external installed-package acceptance before
integration. A further real task is evidence about that candidate only. A correct artifact or a
zero exit code alone cannot establish correct programmatic verification or general model accuracy.
