# ADR 0038: Desktop model settings, materials and report delivery

Status: accepted, 2026-10-27; local bundle/native-UI and fixed live-task checks passed;
final rebuild/restart, CI, merge and owner installation pending.

## Problem and decision

M1 proves the installed read-only loop but still requires terminal credential setup and has no
material selector or report-result view. Extend the existing Electron45.0.0/React19.3.1 client
and bundled Node26.12.1 host. Keep the self-owned core, public runtime/contracts, SQLite writer
lock, existing seven-format parser and effect/approval protocol. No new npm dependency, agent
framework, upload service or session schema is introduced.

The first M2 workflow is: configure a supported local connection, select workspace documents,
choose one new report destination, approve its actual create, and inspect the receipt-backed
file in the app. External imports, edits/undo, shell/web, richer previews and public distribution
remain outside this slice. The [roadmap](../roadmap.md) retains the original acceptance tasks.

## Configuration and credential boundary

The data-only form accepts `flash`, `kimi-cn` or `kimi-global`,1–8 requests and30–300 seconds.
Defaults remain Flash/Responses/low,3 requests,120 seconds,8192 output tokens and zero retries.
Kimi uses the existing K3.1 Pro Chat provider at low, with explicit fixed China/global endpoints;
it is not presented as a verified complex-task recommendation. Arbitrary endpoints, executable
host files, plugin injection and permission settings are not form fields. Saving is local only.

The worker closes its current runtime before changing configuration and reopens the same store.
This removes the old credential cache and report grant. `~/.moyyi/desktop/settings.json` contains
only settings and credential references, written through a mode0600 unique temporary file,
fsync and rename in owner-controlled non-symlink directories. Rename is the commit point: a
later synchronization or runtime-reopen error is an unconfirmed application outcome, not proof
that nothing was saved. Previous credentials and conversations are retained.

`native/keychain.swift` is fixed local source compiled with the macOS Foundation/Security SDK
and shipped in the app. Each new key gets a distinct `moyyi.desktop.model.<UUID>` generic-password
item, account `moyyi`, in the login keychain. The helper receives at most4096 printable ASCII
bytes on stdin, with no key-bearing argv/environment/diagnostics. It adds an immutable item and
does not update a CLI item or earlier desktop version. Failed saves attempt to remove only the
new unreferenced item; cleanup failure never authorizes deleting an earlier key.

The dedicated configure IPC is write-only for secrets. Newly typed keys remain transient local
form data, cleared on preset change, save and close; no saved key can be fetched through the
preload API. Startup and history query metadata, using `kSecReturnAttributes` for new items.
Only a real provider request lazily requests `kSecReturnData`; state/transcripts contain neither
key. Existing CLI items use their existing fixed `/usr/bin/security` metadata/read route, with
`-w` only for an actual request. Desktop saves do not synchronize with the CLI.

## Materials, grants and results

Main owns native open/save dialogs and validates the window/frame and exact IPC shape. After a
dialog returns it checks the current session/workspace/run again; the worker independently
checks the selected session. A cancelled picker leaves state unchanged. Document selection is
limited to8 workspace PDF/DOCX/XLSX/PPTX/ODT/ODS/ODP files of at most10MiB each. Guarded inspection
rejects protected paths, symlinks, hard links and unstable identities. The UI shows path/size/hash,
not extracted content. A task rechecks those identities, then the normal tool loop reads through
the existing parser and current policy. Selection does not grant access outside the workspace.

Report selection allows one missing `.json`, `.md`, `.txt` or `.csv` path with an existing parent
inside the workspace. `ReportPolicy` admits only exact-path `create` with a missing-file prepared
precondition, and still asks for approval of each action digest. Other writes are denied; core
recording, preconditions and postcheck remain in force. Clearing the target, changing connection
or creating/reopening a session returns to read-only. Operations wait for idle; cancellation
must settle before grants or configuration change.

Result cards use successful create execution receipts, including the recorded after-hash. Open
re-reads an ordinary file, checks the current hash, then supplies UTF-8 text capped at65,536
characters from a file at most1MiB. Failed/missing/changed checks clear the previous preview.
The renderer escapes all content. Finder reveal resolves the same verified session/effect
identity and calls `showItemInFolder`; neither `openPath` nor `openExternal` executes a generated
file. Its UI acknowledges a request, not confirmed Finder selection. Receipt pagination follows
20 underlying effects, even when a page contains no report. These checks establish file identity,
not factual report completeness.

## Primary evidence and alternatives

- Reviewed Electron **v45.0.0** [dialog documentation](https://github.com/electron/electron/blob/v45.0.0/docs/api/dialog.md):
  native modal pickers return explicit cancellation and selected paths; filters and initial
  directories are presentation, not workspace confinement. Worker-side validation is retained.
  [Security guidance](https://github.com/electron/electron/blob/v45.0.0/docs/tutorial/security.md)
  supports named IPC, sender validation, sandbox/context isolation and restricted navigation.
  [Shell semantics](https://github.com/electron/electron/blob/v45.0.0/docs/api/shell.md) distinguish
  file-manager reveal from opening the default application. M2 chooses in-app plain text plus
  reveal, rather than exposing generic shell/file URLs. The M1 version/license decision stands.
- Apple [SecItemAdd](https://developer.apple.com/documentation/security/secitemadd(_:_:)) and
  [SecItemCopyMatching](https://developer.apple.com/documentation/security/secitemcopymatching(_:_:))
  provide the fixed add and lookup operations. [Return keys](https://developer.apple.com/documentation/security/item-return-result-keys)
  distinguish attributes from secret data. [SecKeychainOpen](https://developer.apple.com/documentation/security/seckeychainopen(_:_:))
  opens the named login keychain and is deprecated; this compatibility use is limited to the
  macOS candidate, not a cross-platform storage design. A future replacement requires an explicit
  migration and installed access test. No Apple implementation source is vendored.
- Reusing the CLI's `security -w` interactive prompt would still require a terminal; putting a
  key in command arguments is rejected. Electron [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)
  would add a separate ciphertext
  store/migration and different identity semantics. The small bundled helper retains Keychain
  storage while avoiding new native npm dependencies and preserving old entries. System ACL and
  app/helper identity can still require authorization; unsigned/ad-hoc builds do not prove
  unattended access across upgrades.
- OpenBot **010439bb9002fabb7e1facd8450ee85edbafa309**, MIT: adapt
  [ArtifactCard](https://github.com/Peerframe/openbot/blob/010439bb9002fabb7e1facd8450ee85edbafa309/apps/web/src/components/ArtifactCard.tsx)
  and [artifact-shell-save](https://github.com/Peerframe/openbot/blob/010439bb9002fabb7e1facd8450ee85edbafa309/apps/web/src/artifact-shell-save.ts)
  presentation/pending/error and identity-only interaction. Replace Server downloads and DTOs
  with the local receipt contract. Settings/material views are independently rewritten, informed
  by the fixed source and its tests. Preserve [provenance](../openbot-provenance.md) and MIT notice;
  no dirty OpenBot worktree content, Server/channel model or upstream runtime is imported.

## Evidence checkpoint and remaining gates

The final source `npm run check` passed128 files/2610 tests in91.02 seconds. The packaged app
passed external-copy verification: M1's seven cases, M2's seven cases with seven synthetic model
requests, four production-worker settings cases and parser containment. The unchanged production
worker saved a4-request setting and recovered it after restart, with zero credential reads/writes
and network attempts. A separate native helper probe passed add/status/read/delete/missing with
a synthetic UUID, leaving existing credentials unchanged. An earlier attempt to read a helper item
through `security` hit the30-second ACL timeout; its synthetic items were cleaned up. This does
not establish CLI compatibility or authorize changing existing credential access control.

Both unchanged tasks, `document-comparison-seven-formats` and `document-report-seven-formats`,
passed through the actual native UI: each4 Flash/Responses/low requests,120 seconds/8192 ceiling,
shared8 and zero retries. Each parsed seven documents, created the approved exact report and read
it back. Original fact/hash/quotation/total checks passed with source bytes unchanged; all nine
tool results per task matched the next request. The original prompt's first part retained its
bytes, and added visible user parts contained only material identities and the chosen target.
Actual plain-text preview and comparison-file Finder selection were observed. The default was
restored to Flash3 requests and the app exited.

A subsequent display-only preview-scroll fix passed six renderer tests and desktop typecheck.
Final rebuilt-app restart, CI, merge and owner installation remain pending; their exact coordinates
belong in the existing delivery record and M2 PR receipt. These two bounded task results do not
establish general reliability. M1 acceptance remains valid; the original six-item source-analysis
FAIL and unavailable Kimi high semantic result are unchanged.
