# ADR 0037: Installed, read-only desktop client

Status: accepted for M1, 2026-10-27.

## Decision

Use Electron45.0.0 with a React19.3.1 renderer, built with esbuild0.28.2. Ship an independent
Node26.12.1 process with the existing packaged runtime. Electron embeds Node24.22.0; it cannot
substitute for the Node26/SQLite runtime. The first target is a locally installed macOS arm64
application, without public signing, notarization, update service or version publication.

The renderer is a client, never an authority. It receives bounded, plain-data state and calls a
small context-isolated preload API. The main process verifies the sending window, frame, origin,
message shape and size; only its native directory picker may supply a new workspace path.
The controlled worker revalidates commands, session/run identities and exact pending approval
digests before sending existing runtime commands. No arbitrary IPC, host module import, file API,
shell, external navigation or remote HTML is exposed. Model/document text remains escaped text.

The worker imports only public `moyyi/runtime` and `moyyi/contracts`. It uses the existing
exclusive SQLite writer lock and awaits `runtime.close()` before replacing ownership. Opening
or loading history makes no credential/model request and never repeats an effect or approval.
The UI projects existing events, not a second task engine or approval store. Its bounded display
may omit old entries explicitly; the authoritative transcript remains in the existing store.

M1 reuses the existing macOS Keychain service `moyyi.deepseek.api-key` / account `moyyi`, reads
the secret only when a real request starts, and uses the existing DeepSeek data directory. It
does not execute a workspace-selected host file. The fixed connection is Flash/Responses/low,
three requests, zero retries, read-only. Full connection editing is M2. CLI and desktop refuse
concurrent ownership of the same store; users close one before opening the other. Native picker
selection grants the chosen workspace's read scope only; write, shell and web tools stay absent.

## Targeted evidence and alternatives

- [Electron45.0.0 release](https://github.com/electron/electron/releases/tag/v45.0.0) (commit
  `54f961b`) includes current Chromium and sandbox/preload changes. Reviewed its MIT license,
  [IPC specs](https://github.com/electron/electron/blob/v45.0.0/spec/api-ipc.spec.ts),
  [context bridge](https://github.com/electron/electron/blob/v45.0.0/lib/renderer/api/context-bridge.ts)
  and [security guidance](https://www.electronjs.org/docs/latest/tutorial/security).
  An open-issue search for `45.0.0 macOS sandbox` returned no result; this is not proof that no
  defects exist. Disable Node integration, remote resources, navigation, new windows and browser
  permissions; retain sandbox and context isolation. Do not use removed sandbox preload globals.
- [React19.3.1](https://github.com/react/react/releases/tag/v19.3.1), MIT; use client rendering
  only, not its server-component transport. Type declarations are pinned at19.3.0.
- [esbuild0.28.2](https://github.com/evanw/esbuild/releases/tag/v0.28.2), MIT; reviewed release fixes
  for CSS/code generation and input overwrite. A static bundled UI avoids a production dev server
  and another routing/service dependency. React and its license are bundled; no runtime npm fetch.
- [Node26.12.1](https://nodejs.org/en/blog/release/v26.12.1) is the current security patch within
  the existing Node26 requirement. The official darwin-arm64 tar SHA256 is
  `1901d539912c02afa10d1cc126943a8855a7eedebe830119463470db5e6c59e8`, verified before extraction.
  Retain its license and exact package manifest; do not copy Homebrew's dynamically linked binary.
- Tauri would still require this sidecar plus a new Rust integration. Browser-only does not meet
  installed launch/native keychain and picker requirements. Reconsider only if actual packaging
  or resource measurements invalidate Electron; do not maintain two clients now.

OpenBot approval presentation is narrowly adapted from commit
`010439bb9002fabb7e1facd8450ee85edbafa309`, retaining MIT notice. Bot/channel/Server DTOs and login
recovery are excluded. A sent approval is not a successful approval: actual host state determines
pending/denied/stale/completed presentation. See [provenance](../openbot-provenance.md).

## Acceptance and limits

Prove the installed Node bridge, actual SQLite/read tool, approved/denied/stale operations,
cancellation, exclusive ownership, reopen without key/model calls and one parser containment
canary outside the checkout. Exercise the visible installed app and a separately bounded live
Flash file-read task. Keep scripted transport evidence separate from live quality. Preserve all
existing checks and original task standards; M1 does not resolve the original source-task FAIL.
Package size and startup are measured on the actual candidate. macOS arm64 is the only desktop
target claimed by this slice. Updates remain manual, backed up and reversible.
