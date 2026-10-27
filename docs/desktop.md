# Local desktop candidate

The macOS arm64 desktop opens the existing moyyi runtime. M1's workspace selection, read-only
conversation, approval, cancellation and history loop is accepted. M2's settings, document
selection and delivered-report controls passed the external bundle checks and two fixed live
tasks through the native UI. Final rebuild/restart, CI, merge and owner installation remain
separate delivery gates; see the M2 PR receipt for final coordinates. These controls require an
M2 bundle and do not appear in an earlier app merely because the source changed. This is not a
public release.
See [ADR 0037](decisions/0037-installed-desktop-client.md),
[ADR 0038](decisions/0038-desktop-materials-and-reports.md) and the
[system overview](system-overview.md) for exact scope and separate evidence.

## Use

Open `Moyyi.app`, choose **新会话 → 选择工作目录**, and describe the file or question. Send with
the button or Command+Enter. The selected directory is the read scope, including supported
document body text. New and reopened sessions are read-only. Report creation requires the
separate explicit selection described below; shell, web, edit and undo remain unavailable.
The default is DeepSeek Flash through Responses, reasoning low, at most3 requests per turn,
120 seconds,8192 output tokens and zero automatic retries. Reopening, selecting a directory
and loading history make no model request.

**逐次批准工具读取** applies when creating or reopening a session. The card displays the actual
prepared operation and a digest-bound approval. Approve once or deny; **停止** cancels the active
run. A sent command is not evidence of success. Completed, failed, cancelled and exhausted turns
have distinct status text. Read preparation may inspect bounded file metadata/content under the
workspace read grant before a prepared approval exists; this mode is not a promise of no local
file access before approval. Approval-required automatic context reads are omitted by policy.

The left sidebar lists recorded sessions. Reopening loads their existing history without
repeating effects or approvals. The current chosen approval setting applies, not old authority.
Large histories are displayed with explicit truncation; full transcripts remain in the store.
The conversation displays at most100 recent messages and a bounded text projection. Full
transcript browsing, rich Markdown, image preview, external document import and edit/undo controls
remain outside M2. Selecting files does not upload them or read their body into the model.

## M2 candidate: settings, materials and reports

Open **模型设置** to choose Flash, Kimi China or Kimi Global. All three use low reasoning; Flash
remains the default, and the Kimi choices are not a verified complex-task recommendation.
Endpoints are fixed presets. The form accepts1–8 requests and30–300 seconds per turn;8192 output
tokens and zero retries stay fixed. An empty API Key preserves that preset's existing key.
Changing preset, saving or closing clears the input. Save stores local configuration only: it
does not probe the provider, incur model usage or prove that the remote key is valid. An absent
or inaccessible credential leaves sending disabled while history remains accessible. If applying
settings cannot be confirmed, reopen settings to inspect the current values before retrying.

Within a selected workspace, **选择材料** accepts up to8 PDF/DOCX/XLSX/PPTX/ODT/ODS/ODP files,
each at most10MiB. The panel shows relative path, size, format and selection-time SHA-256; it
does not claim document extraction. Protected paths, links, outside-workspace files and unstable
file identities are rejected. Sending rechecks the selected hashes before supplying file
identities to the normal tool loop. Remove a material to exclude it from that explicit selection;
this does not revoke the session's broader workspace read grant. No new parser or external-file
copy/import is introduced.

To produce a file, use **选择报告位置** for one missing `.json`, `.md`, `.txt` or `.csv` path
inside the workspace, with an existing parent directory. This enables only creation at that
exact relative path. Each actual create still needs the displayed effect/digest approval;
existing files cannot be overwritten, edited or undone through this view. **撤销报告授权**
returns to read-only after active work finishes or is stopped. New/reopened sessions and a
connection change also discard the report grant. Cancelling either picker preserves the current
selection; rejected input does not silently grant a different path.

**报告成果** comes from successful recorded create receipts, not assistant prose. **打开报告**
re-reads a bounded regular file, compares its SHA-256 to the receipt and displays UTF-8 plain
text inside the app. Changed, missing and unavailable files have distinct states; old text is
cleared on a failed check. Inspection accepts at most1MiB and displays at most65,536 characters,
with truncation marked. HTML, scripts and links remain text. **在访达显示** requests Finder
location of that checked report; it does not execute the file or confirm Finder's visible result.
Receipt pages follow the underlying20-effect history, so an empty report page can still have a
next page. File existence, matching bytes and a completed turn do not prove report accuracy;
check its claims, citations and coverage against the materials.

## Demonstrated M1 acceptance

The external macOS arm64 app completed one real Flash task through the visible native UI:
choose a public synthetic workspace, request four exact facts from `README.md`, approve the
actual read once, and inspect the answer/source. It used2 requests, zero retries, within the
3-request ceiling. All four facts matched and source/configuration bytes were unchanged. After
quit and reopen, the answer/tool observations remained; entries/effects were identical and no
additional request occurred. The full recorded tool result matched the next model request.

The independent bundle gate uses synthetic models for denial, stale approval, cancellation,
read/reopen, writer-lock and containment cases. This is separate from that one live task and
from the original six-item source-analysis task, whose failure is unchanged. The live trial
preceded a display-only translation of recorded budget notices; no model prompt, runtime,
provider or persisted record changed for that polish. Final package/CI/installation identities
are recorded in the M1 PR delivery receipt. The first measured bundle was approximately524MiB
unpacked and199MiB compressed; this is not a memory or performance benchmark.

## Demonstrated M2 acceptance

The packaged macOS candidate passed the two unchanged tasks
`document-comparison-seven-formats` and `document-report-seven-formats` through the native UI.
Each used4 Flash/Responses/low requests, zero retries, within120 seconds and8192 output tokens;
the shared8-request ceiling was retained. Recorded elapsed times were34.809 and30.865 seconds.
Each run parsed all seven real documents, created the exact approved report and read it back.
The original fact/hash/quotation/total checks passed and source files were unchanged. All nine
tool results per task matched the next model request. The original prompt's first part retained
its bytes; the added visible user parts contained only material identities and the chosen report
target, with no expected answers.

The actual report preview and Finder selection of the comparison file were observed. Settings
were then restored to the default3 requests with Flash unchanged, and the app exited. These are
two bounded task results, not a general reliability claim or a rescore of the source-analysis
failure. The external-copy gate separately passed M1's seven cases, M2's seven cases using seven
synthetic requests, four production-worker settings cases, and parser containment. The worker
saved/reopened a4-request setting with zero credential reads/writes or network attempts. A
separate native helper probe passed synthetic UUID add/status/read/delete/missing checks without
changing existing credentials. A later preview-scroll polish passed six renderer tests and
desktop typecheck; final rebuilt-app restart and integration are still pending in the PR receipt.

## Connection and storage

M1's existing login-Keychain service `moyyi.deepseek.api-key` / account `moyyi` remains usable.
M2 also recognizes the existing regional Kimi items. Saving a new desktop key creates a unique
`moyyi.desktop.model.<UUID>` item through the bundled native helper; it does not overwrite a CLI
item or a previous desktop credential version. Desktop and CLI key changes are not synchronized.
macOS authorization can be required, including after an app/helper signature changes.

Startup checks metadata only. A real provider request lazily reads the selected credential in
the trusted worker. Stored secrets are never returned to the renderer. A newly typed key exists
temporarily in its password field and travels through the dedicated write-only configure IPC
and helper stdin; it is excluded from state snapshots, transcripts, argv, environment and logs.
Non-executable settings and credential references live in `~/.moyyi/desktop/settings.json`
(mode0600). Configuration closes the old runtime and reopens the same store, clearing its old
credential cache and report grant. A post-commit reopen failure can leave settings saved but
not yet usable; the UI reports that applying them could not be confirmed.

The desktop host uses `~/.moyyi/deepseek-data`; it does not execute `host.mjs` or inherit
other grants from it. The unchanged Flash/Responses/low defaults match the accepted daily host.
It excludes `~/.moyyi` and `~/Library/Keychains` from model file access. Existing executable
CLI hosts remain explicit CLI configuration, not desktop forms or imported settings.

Only one runtime may own this store. Close the CLI before opening the desktop, and quit the
desktop before using the CLI against that store. A conflict is refused visibly. Quit waits for
runtime cleanup and child-process exit; it does not silently hand off a live writer. No database
schema changed, and model credentials/configuration are not overwritten by installing the app.

## Build and verify

From a macOS arm64 checkout with Node26/npm11 and Xcode Command Line Tools (`xcrun swiftc`):

```sh
npm ci --ignore-scripts
node node_modules/electron/install.js
npm run check
npm run desktop:package
npm run verify:desktop
```

`desktop:package` verifies the pinned official Node archive, builds the existing runtime tarball
with its generated shrinkwrap, installs production dependencies into the bundle and includes
licenses. M2 also compiles the fixed Keychain helper against macOS Foundation/Security;
the installed app does not require a Swift compiler. It creates `artifacts/desktop/Moyyi.app`,
a local ZIP and a checksum manifest. An ad-hoc
local signature permits this candidate's local verification; it is not a public developer
signature/notarization. No registry upload or release is performed. `desktop:build` only builds
the desktop JavaScript/static UI and does not assemble a standalone app.

`verify:desktop` copies the actual app outside the repository, runs its own Node/runtime and
compiled host, checks real files/SQLite/approval/recovery, the packaged worker and a document
parser containment canary with synthetic model responses. It never uses an API key. This gate
does not replace visible GUI testing, paid task-quality checks or the original fixed tasks.

M2's external-copy, native-control and two original live-task checks passed as recorded above.
Complete the final frozen rebuild/restart, CI, merge and owner installation before treating the
candidate as the installed daily version. The PR delivery receipt records those final identities
and outcomes; earlier acceptance is not evidence that a later package was installed.

Before installing, close both clients, back up the session/configuration directories, preserve
the prior CLI tarball and any previous app, then copy the verified app to `~/Applications`.
Check its signature/manifest, launch it from outside the checkout, and reopen an existing session.
To roll back, quit, restore the previous app; the existing CLI package remains usable. Restore
database backups only deliberately because doing so discards conversations created since backup.
No automatic updater or additional desktop platform is claimed.
