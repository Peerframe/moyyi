# ADR 0040: Explicit desktop maintenance and optional Kimi effort

Status: accepted design, implemented2026-10-28. Isolated bundle/native maintenance passed; M4
task-quality acceptance and daily installation remain pending in the [delivery receipt](../tasks/2026-10-28-desktop-m4.md).

## Decision

Complete daily operation of the installed M3 client with local help and explicit backup,
session restore and software rollback. These are trusted owner actions, not model tools,
generic shell commands or a second task engine. Keep the existing SQLite schema2/persisted
format1, credential store, runtime policy and model budgets. Add no dependency or public release.

Reuse the store's existing consistent `VACUUM INTO` backup and referenced blobs. Add narrow
public `backupLocalStore` / `restoreLocalStore` entry points through `moyyi/runtime`, so the
desktop host never imports private store code or copies an open database independently. Their
caller must close the active runtime; the store takes the same cross-process writer lock used
by CLI and desktop. Keep the live directory and writer-lock inode in place during restoration.

The renderer exposes only named, zero-argument maintenance methods. The main process validates
the sender, requires an idle host with no pending command, owns native selection/confirmation,
blocks competing actions and waits for worker exit. A bundled Node helper executes one bounded
request. Its results contain paths/counts/format/revision and preservation flags, never credentials.
An IPC result acknowledges only its stated phase: prepared rollback is not completed replacement.

## Backup and session restore

A new backup folder contains the consistent session database, referenced transcript/undo blobs,
optional data-only settings and a manifest of complete file hashes. No existing destination is
overwritten. Keychain secrets and workspace files are excluded. Settings can contain credential
references; these are not keys and do not make the backup portable to another Keychain.

Restore validates the selected backup and a private staged copy, including every session's
integrity, before touching the live database. It then owns the existing writer lock, rejects
active/unsettled work and protective workspace leases, and publishes a complete rescue backup
of current records/settings before replacing the database. Restore changes only the session
store in its original location. It preserves current settings, Keychain and workspaces; the
chosen backup's settings are not imported. Old transcript/snapshot blobs remain available, and
old actions/approvals/grants are never replayed. This is history restoration, not file undo.

Bounded descriptor reads, regular-file/link/ownership checks, file hashes, exclusive destination
creation and durability acknowledgement apply to maintenance inputs. Errors after publication
remain unconfirmed; do not delete a complete rescue copy or report that no state changed.
The helper returns safe failure text. Startup/history recovery retains the existing fail-closed
runtime behavior, including unknown effects and their leases.

## Software rollback

Use only the previous accepted installation retained by the local installation receipt. Check
the managed archive hash, recorded revisions, static bundle digest, deep strict code signature,
copy tree and current settings/store compatibility. Prepare a separate app copy while holding
the store writer lock; native confirmation arms it. IPC disconnect alone does not authorize
replacement: the helper must observe the parent process exit before committing.

Retain the current app in a rescue directory, replace only the app and attempt native relaunch.
Keep current sessions, settings, Keychain and workspaces unchanged. The receipt records prepared,
completed or unconfirmed state; it does not claim that native launch/history reopen succeeded.
The helper cannot accept an arbitrary app path or download. There is no automatic update service.

## Optional effort and compatibility

The desktop's Kimi presets gain an explicit `kimiReasoningEffort: "low" | "high"` setting.
Absent means low. Flash remains low and rejects high; switching to Flash clears the optional
field. Saving low or Flash writes the old three-field settings representation, avoiding a forced
migration. Only explicit Kimi high persists the new field. Unsupported effort/extra fields fail
validation. Credential caching and reset of report/write/check grants retain the existing
configure lifecycle.

Older M2/M3 apps reject the high field. Software rollback therefore refuses incompatible
settings and tells the owner to select Flash and save first; it does not silently rewrite them.
High is labelled unverified. Historical Flash/Kimi low source failures and the high429 remain
sealed. A settings connection or synthetic wire test cannot satisfy the six-item source rubric;
the original task and conditional public tasks retain the [roadmap gates](../tasks/2026-10-29-roadmap-archive.md#quality-lane-independent-progress-explicit-final-gate).

## Evidence and limits

Reuse M2's two accepted document tasks and M3's accepted functional/undo workflow where unchanged,
including their recorded failures and explanation defect. Check new maintenance against real
temporary stores/files, malformed inputs, concurrent ownership, interrupted publication and
preservation of settings/workspaces. Exercise the actual bundled helper and native confirmations,
exit and reopen separately. The delivery receipt records executed evidence and pending gates;
this design decision alone establishes neither installed maintenance nor M4 completion.

This is local composition of existing moyyi storage/runtime APIs. No OpenBot source, external
backup framework, model prompt, persisted schema or core execution loop is copied or changed.
