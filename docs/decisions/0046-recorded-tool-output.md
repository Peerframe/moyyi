# ADR 0046: Recorded tool output and pressure-driven projection

- Date: 2026-10-29
- Status: accepted for implementation; the owner explicitly approved the minimum persisted-format
  change required by delivery one's part D. Acceptance evidence remains separate.

## Problem

The executor previously truncated oversized tool results. Plain-text blob handles alone would
not survive backup: blob traversal recognizes typed references, not arbitrary text. Reusing
image parts would misrepresent text, and managed materials would change the user's material
library and selection. A new hidden notice convention would also be a persisted contract.

## Decision

Reuse the existing content-addressed blob store and add optional `ToolResultsBody.outputBlobs`:
`{callId, blob, bytes}[]`. Each reference belongs to one text-only result in that record; `bytes`
is the UTF-8 length of full text (multiple text parts are joined with one newline). The result
itself retains a bounded head, omitted-byte count, tail and retrieval handle. Model/provider
`ToolResultPart` remains unchanged. Runtime reminders are separate from the captured observation.

Persisted format becomes 2; SQL schema remains 3 because no tables change. The migration validates
old schemas and records, updates format metadata transactionally, and preserves old payload bytes.
The v1 fixture remains unchanged; v2 covers the additive reference. Unknown version combinations
are refused. Typed reference traversal covers commit, reopen, backup, restore and rescue backups.
Missing, incorrectly sized or invalid UTF-8 blobs are rejected.

Core owns the ordering: the runtime processing port durably stores full text before core commits
its result/reference/effect in one transaction. Failure to publish the result leaves an unreferenced
blob, never a usable model handle. Storage failure is not converted into a successful tool result.
The original result is never rewritten after commit. The original serialized output limit and
existing 64 MiB blob ceiling remain in force; stricter host blob limits remain effective.

The `tool-output` plugin exposes `read_tool_output(handle, offset, length)` under the existing read
policy. Core supplies a guarded capability only during that tool's execution. Runtime resolves the
handle exclusively against typed references in the trusted current session, including original
entries retained through compaction. A hash in user text, another session or an orphan blob grants
no access. Reads recheck authorization around store I/O, verify hash/length, align UTF-8 boundaries,
and fit at most 8192 bytes within the existing serialized output cap. Retained capabilities expire.

## Context and recording

When a request exceeds capacity, context first shortens older referenced tool-result previews,
in chronological order, retaining head/tail and a retrieval handle. It leaves the newest result
and unsettled calls intact. It then applies the existing optional-section omission or capacity
failure. No store I/O or mutation occurs in context. Exact projected requests are recorded by the
existing request-blob path; originals and full outputs remain available. Pruning invalidates prefix
reuse from the first changed result, while ordinary new output and reminders only append history.

Explicit compaction asks the summary to retain the latest todo list and needed output handles;
it does not create a second todo context source or delete output references.

## Rollback and limits

Old programs reject format 2 on open. Packaging and rollback compare both schema and format, even
when schema remains 3. Returning to an old program requires its matching pre-upgrade data backup;
first save a rescue backup of the current format 2 data. There is no implicit downgrade that drops
output references. Existing backup files are never migrated in place during restoration.

Capture cannot recover bytes a file/parser capability already withheld or clipped. It does not
enlarge reads, change grants, retry tools or spill image parts as text. An output cap too small to
fit a handle fails explicitly; no unbounded fallback is sent to the model. Retrieving saved output
is not independent verification of the tool's claims.

## Reference and validation

Borrow DSH `spill`, `spill-policy` and `compaction-tool-result-pruner` at
`f3803c96974ad4a94195fb97e5c637e9c2a3afe3` (MIT), rewritten for moyyi's ports. Reject its Cordis
waterfalls, file-path authority and best-effort unbounded fallback. Provenance lists each file.
Validation covers unchanged v1 data, migration rollback, output-reference integrity, session
isolation, cancellation/revocation, real runtime recording, reopen and backup/restore. Passing
offline cases establishes these guarantees, not live task quality.
