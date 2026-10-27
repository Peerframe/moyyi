# ADR 0035: Read-authorized observations in write results

Status: accepted, 2026-10-27

## Problem and evidence

Controlled writes already reread the published file through the guarded descriptor and verify
its hash/mode. Only the snapshot/path/before/after hashes reached the model. In the recorded web
revision, the final 8,700-byte report matched its receipt but its body never entered the last
request. This is a result-delivery gap, distinct from source retrieval or factual correctness.

The [targeted upstream review](../research/2026-10-26-agent-navigation.md#edit-result-visibility-2026-10-27)
compared pinned Cline and Aider code: Cline returns an in-memory diff; Aider rereads selected files
for subsequent requests. Neither is evidence of moyyi's authority or postcheck semantics. Reuse
moyyi's already verified observation instead of adding another file read, review model call,
dependency or execution framework. No upstream source is copied or adapted.

## Decision

Extend the nonpersisted `WorkspaceWriteReceipt` with optional `postcheck: {text, bytes}`. Runtime
uses the actual post-read bytes after the existing hash/mode verification, never the model's
proposed mutation. `text: null` means verified absence after undoing a create; `text: ""` means an
existing empty file. The surrounding path, afterHash and snapshotId bind the observation to that
effect. It describes the observed version, not a promise that another process cannot change it.

Disclosure requires a separate automatic-read grant through `beforeContextRead(path, "read")`
and `beforePrepare("read", ...)`, including restrictive plugin rules in both policy phases.
Missing, throwing, ask or deny decisions withhold text while retaining successful write receipts.
The direct runtime helper defaults to no disclosure. Recheck authority after asynchronous cleanup
before returning cached text; cancellation and revoked write capabilities retain existing failure
and uncertainty behavior. No fabricated read action/digest or borrowed write approval is used.

The fs plugin retains one JSON text part and the four original receipt keys. Its optional
`postcheck` is `file-postcheck-v1` with `available`; when true it includes `text`, `sourceBytes`,
`returnedBytes` and `truncated`. A null body is verified absence, not truncation. A missing or
unavailable observation must never be interpreted as a missing/empty file. Bound displayed text
to 16 KiB UTF-8 and complete serialized content to the smaller of 32 KiB and the existing tool
output budget, counting JSON escaping and the outer content wrapper. Prefixes preserve code
points and explicitly report truncation. If metadata cannot fit, preserve the old receipt; below
even that size, the executor's existing truncation behavior applies. Do not throw after a known
successful mutation merely because optional text does not fit.

The next model request receives the ordinary recorded tool result, without a special context
injection. Receipt extraction and `/results` remain compatible; old/custom providers may omit the
optional field. Existing transcript/effect schemas, persisted fixtures and snapshots are unchanged.

## Acceptance and limits

Focused tests cover actual create/edit/undo/absence/empty observations, denied/missing/throwing
read authority, prepare/execute plugin restrictions, cleanup revocation, bounded Unicode/escaping,
receipt extraction and unknown post-publication outcomes. The original eight write-eval scenarios
remain intact, with additional exact next-request delivery assertions. The external installed
client verifies observed disk text reaches the next request while its receipt still works.

This does not certify facts or automatically run a project checker. Independent checks remain
necessary for task correctness. It does not grant reads or writes, change the model or request
limits, promise full large-file readback, or retrospectively pass the old web/source tasks. The
implementation is evaluated offline first; any live accuracy claim needs separate evidence.
