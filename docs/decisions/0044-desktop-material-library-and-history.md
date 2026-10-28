# ADR 0044: Local material library and complete desktop history

Status: accepted for M6 implementation by the owner on 2026-10-28; acceptance is recorded separately.

## Decision and evidence

Keep one SQLite writer and the existing immutable blob store. Add schema 3 metadata, material
assets, conservative session references and current selections; transcript/effect format 1 stays
unchanged. The schema 1/2 upgrades validate prior structure and migrate transactionally. Existing
backups include every live material blob, including recycled originals; restore migrates only a
private copy. Software rollback rejects a package whose declared schema differs from current data.
The pre-upgrade application and data must be retained together; new records are never silently
removed to make an old binary start.

The fixed OpenBot source `010439bb9002fabb7e1facd8450ee85edbafa309` informed the choices:
`owner_files.py`, `attachment_references.py`, `attachment_purge_files.py`, `sidebar-organization.ts`,
`RichMessage.tsx` and `report-save.ts`. Actual copied/adapted files are listed in provenance; no
OpenBot Server identity, channel state, database or agent loop is introduced.

Electron remains pinned to 45.0.0. Reviewed primary interfaces:
[clipboard](https://github.com/electron/electron/blob/v45.0.0/docs/api/clipboard.md),
[webUtils](https://www.electronjs.org/docs/latest/api/web-utils), and the pinned installed
`electron.d.ts`. Clipboard uses asynchronous `read()` / `getType()` blobs, not the obsolete
`readImage()` API. Preload resolves disk-backed `File` objects with `getPathForFile`; main confirms
source paths with the owner before import. Renderer paths never become generic filesystem grants.

A second asset directory/database would split backup and lifecycle authority. Whole OpenBot
attachment services would introduce identity/routing dependencies. A full Markdown/browser viewer
would add unnecessary executable surfaces. The chosen narrow adaptation uses existing storage,
parsers and React text nodes, with no new package dependencies.

## Import and retention

Native picker, dropped files and explicitly requested clipboard PNG enter the same bounded import
path. Protected paths, links, special files, replacement and oversized inputs are rejected. Each
file is at most 10 MiB, each current selection at most eight. Library capacity is bounded separately.
Original bytes are saved by hash before a uniquely named workspace copy is published. Pending
imports remain recoverable. Model access still uses the existing workspace/document tools, policy
and approvals; importing does not enable writes, OCR, upload or a model request.

Current selection and historical reference are different records. Removing a selection does not
remove its historical reference. Recycling is a recoverable library operation, not revocation of
workspace read authority: existing copies and originals remain. A referenced material cannot be
purged, even when its session is in the recycle bin. Purging an unreferenced recycled item checks
its current copy and never deletes shared blobs. It is not secure erasure or guaranteed disk-space
reclamation. Optional 30-day housekeeping is disabled by default and only soft-recycles eligible
unreferenced materials. No arbitrary project file is housekeeping input.

## Display, saving and history

`Runtime.sessions` and `Runtime.materials` are trusted local-host management APIs. They share idle
admission and the store writer; they are not model tools or persisted core commands. History pages
and message chunks expose display text only, never provider replay, reasoning or request blobs.
Directory cursors bind their query/generation; history continuations retain stable entry identity.
The live window remains bounded; every older visible record and long message can be read through
explicit paging. Missing workspaces and recycled sessions can be opened read-only. Continuing a
run requires an available workspace, active session and freshly established permissions.

Titles, groups, pins, mute and soft removal persist with revision checks. Search matches names and
prompt excerpts, not complete message text. Mute suppresses the application completion announcement;
result status stays visible. It does not claim an operating-system notification facility.

Markdown supports headings, lists, tables, code and emphasis using escaped React nodes; raw HTML,
links and remote images remain inert. PNG/JPEG local previews require valid bounded headers,
at most 512 KiB of encoded bytes, 4096 pixels per side and 8,388,608 pixels. Decoder failure clears
the image with an explicit message. Larger originals remain saved but cannot be previewed.
Saving a result selects an existing effect receipt, rechecks the content hash and uses an exclusive
native-chosen destination. Cancellation writes nothing; an existing file is never overwritten.

## Required acceptance

Verify the installed desktop flow outside the checkout: external document import → controlled
read → approved report → preview/save → restart/history. Cover old data migration/backup/restore,
shared blob retention, collision/replacement/cancel/deny/reference/restore, safe renderer content,
long history/chunks and narrow supported windows. Record synthetic/offline and live tasks separately;
keep Flash + Responses + low and all previous rubric/budget/failure records unchanged. No public
release is authorized by M6.

### Native type-filter compatibility

The first actual macOS package allowed PDF selection but disabled an existing supported DOCX.
[Electron45's pinned native implementation](https://github.com/electron/electron/blob/v45.0.0/shell/browser/ui/file_dialog_mac.mm)
passes extensions to macOS `setAllowedFileTypes`; the [official dialog API](https://www.electronjs.org/docs/latest/api/dialog)
permits omitting filters. M6 omits the advisory native filter so unregistered Office types remain
selectable. The host's extension allowlist, descriptor/symlink/protected-path checks and resource
limits still reject unsupported or unsafe inputs. This does not add a format or permission.
The native regression must be rechecked on the rebuilt package, not inferred from the mock.
