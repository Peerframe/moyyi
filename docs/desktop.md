# Local desktop candidate (M1)

The macOS arm64 desktop opens the existing moyyi runtime. It supports choosing a workspace,
read-only conversations, actual tool observations, per-read approval, cancellation and history.
This is a local candidate, not a public release. See [ADR 0037](decisions/0037-installed-desktop-client.md)
for dependency pins, transport and trust boundaries, and the [system overview](system-overview.md)
for the delivered version and separate offline/live evidence.

## Use

Open `Moyyi.app`, choose **新会话 → 选择工作目录**, and describe the file or question. Send with
the button or Command+Enter. The selected directory is the read scope, including supported
document body text; write, shell and web tools are unavailable. The default connection is
DeepSeek Flash through Responses, reasoning low, at most3 requests per turn,120 seconds and zero
automatic retries. Reopening, selecting a directory and loading history make no model request.

**逐次批准工具读取** applies when creating or reopening a session. The card displays the actual
prepared operation and a digest-bound approval. Approve once or deny; **停止** cancels the active
run. A sent command is not evidence of success. Completed, failed, cancelled and exhausted turns
have distinct status text. Read preparation may inspect bounded file metadata/content under the
workspace read grant before a prepared approval exists; this mode is not a promise of no local
file access before approval. Approval-required automatic context reads are omitted by policy.

The left sidebar lists recorded sessions. Reopening loads their existing history without
repeating effects or approvals. The current chosen approval setting applies, not old authority.
Large histories are displayed with explicit truncation; full transcripts remain in the store.
M1 displays at most100 recent messages and a bounded text projection. It does not yet provide
full transcript browsing, rich Markdown, image preview, document import, settings editing,
generated-file cards or write/undo controls. These belong to subsequent milestones.

## Connection and storage

M1 uses the existing macOS Keychain generic password service `moyyi.deepseek.api-key`, account
`moyyi`, in the login keychain. Only the trusted Node process retrieves the secret, on the first
actual request. It is never sent to the renderer, argv, environment, application logs or session
records. Startup only checks metadata. If missing, the desktop shows the existing setup command:
`moyyi-deepseek setup-key`. The complete visual setup flow is M2.

The fixed desktop host uses `~/.moyyi/deepseek-data`; it does not execute `host.mjs` or inherit
other grants from it. Flash/Responses/low and the normal daily limits match the accepted host.
It excludes `~/.moyyi` and `~/Library/Keychains` from model file access. Existing executable
CLI hosts remain explicit CLI configuration, not desktop forms or imported settings.

Only one runtime may own this store. Close the CLI before opening the desktop, and quit the
desktop before using the CLI against that store. A conflict is refused visibly. Quit waits for
runtime cleanup and child-process exit; it does not silently hand off a live writer. No database
schema changed, and model credentials/configuration are not overwritten by installing the app.

## Build and verify

From a macOS arm64 checkout with Node26/npm11:

```sh
npm ci --ignore-scripts
node node_modules/electron/install.js
npm run check
npm run desktop:package
npm run verify:desktop
```

`desktop:package` verifies the pinned official Node archive, builds the existing runtime tarball
with its generated shrinkwrap, installs production dependencies into the bundle and includes
licenses. It creates `artifacts/desktop/Moyyi.app`, a local ZIP and a checksum manifest. An ad-hoc
local signature permits this candidate's local verification; it is not a public developer
signature/notarization. No registry upload or release is performed. `desktop:build` only builds
the desktop JavaScript/static UI and does not assemble a standalone app.

`verify:desktop` copies the actual app outside the repository, runs its own Node/runtime and
compiled host, checks real files/SQLite/approval/recovery, the packaged worker and a document
parser containment canary with synthetic model responses. It never uses an API key. This gate
does not replace visible GUI testing, paid task-quality checks or the original fixed tasks.

Before installing, close both clients, back up the session/configuration directories, preserve
the prior CLI tarball and any previous app, then copy the verified app to `~/Applications`.
Check its signature/manifest, launch it from outside the checkout, and reopen an existing session.
To roll back, quit, restore the previous app; the existing CLI package remains usable. Restore
database backups only deliberately because doing so discards conversations created since backup.
No automatic updater or additional desktop platform is claimed.
