# Local desktop candidate

The macOS arm64 desktop opens the existing moyyi runtime. M1's workspace selection, read-only
conversation, approval, cancellation and history loop is accepted. M2's settings, document
selection and delivered-report controls passed the external bundle checks and two fixed live
tasks through the native UI. M2 was merged and installed; the [PR #45 delivery receipt](https://github.com/Peerframe/moyyi/pull/45)
records its final coordinates. M3 adds controlled changes/checks and operation history. It is
installed at source `6eb2993`, merged main `85873c7`: external-copy/native gates and an independently
authorized live repair/check/reopen/undo passed. The first live failure and an incorrect extra
explanation remain recorded below. [PR #46](https://github.com/Peerframe/moyyi/pull/46) and the local
installation receipt record native launch and history reopen verification. M4's optional high
setting, local help and maintenance controls passed isolated bundle/native maintenance acceptance;
they do not yet update this M3 installation. The complex source-analysis task still fails its
original standard. This is not a public release or M4 completion claim.
See [ADR 0037](decisions/0037-installed-desktop-client.md),
[ADR 0038](decisions/0038-desktop-materials-and-reports.md),
[ADR 0039](decisions/0039-desktop-controlled-workflows.md),
[ADR 0040](decisions/0040-desktop-local-maintenance.md) and the
[system overview](system-overview.md) for exact scope and separate evidence.

## Use

Open `Moyyi.app`, choose **新会话 → 选择工作目录**, and describe the file or question. Send with
the button or Command+Enter. The selected directory is the read scope, including supported
document body text. New and reopened sessions are read-only. Report creation requires the
separate explicit selection described below. M3 file changes and Node checks require their own
explicit grants; web access remains unavailable.
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
transcript browsing, rich Markdown, image preview and external document import remain outside
this client. Selecting files does not upload them or read their body into the model.

## Settings, materials and reports

Open **模型设置** to choose Flash, Kimi China or Kimi Global. Installed M3 uses low reasoning for
all three. M4's settings candidate adds an explicit low/high choice for Kimi only. High is labelled
**实验**; it did not pass the fixed complex-source task and is not a reliability recommendation.
Flash always uses low. Switching back to Flash removes high from the configuration. Legacy
three-field settings retain low behavior; saving low or Flash retains that older representation.

The current M4 candidate also offers **独立证据成文（实验）**, default off. For a new session
containing a self-contained question, it uses one request within the selected budget to answer
directly from the question and all actual tool observations. Earlier assistant interpretations
remain in history but are not sent into that final request. Investigation is limited to one
third of the total time: the current investigation request stops at that boundary, then started
tools and records must settle before final inference. The original deadline remains fixed;
evidence may be insufficient and completion or correctness is not guaranteed.
It requires at least two requests, disallows steering and requires disabling the option before
continuing an old conversation. Cancellation still works. Switching to Flash clears the option;
old applications cannot read the enabled setting, so disable it before a compatible rollback.
See [ADR0042](decisions/0042-direct-evidence-answer.md) for the experimental acceptance boundary.
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

## Changes, checks and recovery

These installed controls have bounded functional/recovery acceptance evidence in the
[PR #46 receipt](https://github.com/Peerframe/moyyi/pull/46).
Open **会话权限** in an idle session. **允许提议文件修改** and **允许提议 Node 命令检查** are independent
and initially off. Confirm the selected workspace in the native dialog; cancelling keeps the
current permissions. File changes use snapshot-backed create/edit/undo and each operation still
requires its own displayed preview and digest-bound approval. Node checks run with a read-only
workspace and no network; they cannot install dependencies or modify project files.

Changing these grants clears the single report target. Selecting a report target closes both
broader grants. New/reopened sessions and model-configuration changes reset them to off. If work
is running, stop and wait for cleanup before changing permissions. Stopping keeps the recorded
results and does not undo completed changes.

The **操作记录** panel shows every effect on a20-record page, including failed, denied, cancelled
and unknown outcomes. Lists longer than12 initially show the first three and last six, with an
explicit expansion. Unknown never means success; losing a response does not justify resubmitting
an action. A command receipt reports termination/exit code/truncation, not task correctness.
**核对当前文件** compares actual bytes with the selected file receipt. A match is only a statement
about bytes at that check, not mode or guaranteed undo readiness. Expected absence after undo is
shown separately from a missing file that should exist.

**准备检查** and **准备撤销** only append editable text to the composer. Existing draft text is kept;
neither button starts a model call or executes a command. Review the request, enable the needed
grant and send it using the ordinary model budget. Undo uses the selected successful receipt's
actual snapshot ID; approve its newly prepared action separately. For several changes, prepare
the relevant snapshots in reverse order and inspect the request before sending. Changed bytes or
mode can prevent undo. A missing/unknown receipt cannot prepare a snapshot undo.

Reopening restores history and explains that old permissions/approvals are not restored. It does
not replay interrupted actions. An interrupted started command may remain `unknown` and retain
the workspace lease: read-only inspection can continue, but later changes may be protectively
blocked even after re-enabling writes. Inspection does not release that lease. There is no force
retry or automatic unlock control. Cancelling a pending approval is different: settled earlier
edits can still be requested for undo after reopening and explicitly re-enabling writes.
History alone does not prove a file is unchanged or a check passed. Original task standards and
budgets remain unchanged; component tests are separate from installed workflow acceptance.

M3 passed external-copy and instrumented native interaction gates with synthetic providers.
A separately authorized live pair then repaired the unchanged listener-leak task, ran its fixed
Node check, reopened with grants reset and undid both actual snapshots in reverse order, restoring
original bytes/mode. It used5 repair and3 undo requests within its own shared12-request ceiling,
with zero retries. Final source check passed131 files/2644 tests.

This establishes the bounded functional/recovery workflow, not an error-free explanation: the
repair answer incorrectly claimed that a null `removeEventListener` callback throws in real DOM.
The first live repair failure also remains sealed. The [delivery record](tasks/2026-10-26-optimization-plan.md)
preserves both groups and the correction. None of these results rescores the complex source task.

## Daily use and limits

For project reading, select the workspace, describe the question and inspect the cited files.
No write/check grant is needed. For a document report, select the materials and one new report
path, review its create approval, then open the recorded output and check it against the sources.
For an edit, enable only the needed grants, inspect each preview, check the result and use the
actual snapshots in reverse order if undo is needed. **停止** keeps completed changes; reopening
restores records with grants off. A new send is a new model run, including after a budget stop.

M4 adds an in-app **使用帮助** containing these local instructions; it is not model context.
The displayed limits and effect receipts describe execution, not factual reliability. Flash
remains the daily default. Original source-analysis omissions remain unresolved; larger budgets,
Kimi high or a normal completion message do not establish correctness.

## Backup, restore and software rollback (M4 candidate)

These controls passed actual isolated bundle/native acceptance, recorded in the
[M4 receipt](tasks/2026-10-28-desktop-m4.md). Full M4 quality acceptance remains blocked by the
original source task. The current daily M3 app does not
gain them from source edits. Open **备份与回退** only after work finishes. The app closes its session
worker before maintenance and reopens it afterwards, with grants reset. Close any CLI using the
same store first. Maintenance makes no model call and does not read or export Keychain secrets.

| Action | What to do and what changes |
|---|---|
| **创建备份** | Choose a new folder in the native save dialog. The backup includes a consistent session database, referenced transcript/undo blobs, data-only settings and a hash manifest. It never overwrites an existing backup. Project files and Keychain secrets are excluded; credential references in settings are not portable keys. Keep this private backup protected. |
| **选择备份并恢复** | Select a moyyi backup and confirm the native warning. The app verifies its files and formats, saves the current records/settings under `~/.moyyi/backups/before-restore-<id>`, then replaces only the session database in its original location. Current settings, Keychain and workspace files are unchanged. The selected backup's settings are not applied. |
| **检查可回退版本** | The app checks the previously retained installation, archive hash, app identity/signature and compatibility with current data/settings. If available, it shows the target revision and rescue location. **退出并回退** arms replacement only after the current app exits; the helper retains the current app and attempts to reopen the old one. This confirmation is not proof that the old app launched successfully. |

Restoring history makes conversations created after that backup absent from the active catalog;
the rescue backup retains the replaced state. It does not undo project edits, replay operations,
restore approvals or restore write/check permissions. Existing unknown effects, active runs or
protective workspace leases prevent session restoration from bypassing their safety records.
Corrupt/modified, unsupported or unsafe backup files are refused. Cancellation before confirmation
leaves the selection's data unapplied. On an unconfirmed result, inspect the existing backup/rescue
and current state; do not assume that repeating the action is necessary.

Software rollback preserves current conversations/settings/workspaces; it does not restore a
database backup. It requires a verified previous installation retained in managed local storage,
not an arbitrary downloaded app. Explicit Kimi high adds a settings field older M2/M3 apps cannot
read: rollback refuses it and asks you to switch to Flash and save first. It never silently edits
settings or Keychain to make the older app start. A later software launch/history verification
must be recorded separately. There is no automatic updater or public installer in this candidate.

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
desktop typecheck; final rebuild/restart, integration and installation are recorded in the
[PR #45 receipt](https://github.com/Peerframe/moyyi/pull/45).

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
credential cache, report grant and write/check permissions. A post-commit reopen failure can
leave settings saved but not yet usable; the UI reports that applying them could not be confirmed.

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

M2's external-copy, native-control, live-task and final installation evidence is recorded above
and in its PR receipt. M3 is the verified installed baseline recorded in [PR #46](https://github.com/Peerframe/moyyi/pull/46).
M4's new maintenance paths additionally require real temporary-store failure/recovery checks and
actual bundle/native confirmation/exit/reopen evidence. Its high selector requires separate task
quality evidence. Source evidence alone does not establish installation of a later package.

Before installing, close both clients, back up the session/configuration directories, preserve
the prior CLI tarball and any previous app, then copy the verified app to `~/Applications`.
Check its signature/manifest, launch it from outside the checkout, and reopen an existing session.
For a manual software rollback from an older app without the M4 controls, quit and restore the
verified previous app only after checking current settings/store compatibility. Keep current data;
the existing CLI package remains separate. Restore database backups only deliberately because
doing so replaces the active history; first preserve the current store as a rescue backup.
No automatic updater or additional desktop platform is claimed.
