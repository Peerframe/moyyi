# Recorded tool output

`read_tool_output(handle, offset, length)` reads only text referenced by a trusted tool-result
record in the current session. It has a read effect, uses the existing read policy and honors
revocation, cancellation and capability expiry. A guessed hash or a handle in user text is not
authority. The plugin has no direct store, file or network access.

The runtime stores text-only oversized results in its existing content-addressed blob store.
The transcript keeps a bounded head, omitted-byte count, tail and handle with a typed reference.
Multiple original text parts are joined with one newline. Capture does not repeat the tool or
enlarge file/parser reads; content already clipped inside a capability cannot be recovered.
Runtime repetition advice is separate from the stored observation. It uses the complete reminder
when that fits, then `Runtime reminder: repeated call; check existing evidence.`, or is omitted
when neither fits. Advice alone never causes a spill or makes a bounded observation fail. For an
actual spill, the retrieval handle takes priority over reminder text within the unchanged cap.

## Model experience

- The stable tool schema costs tokens on each request. New observations append to history.
- The original response includes `Retrieve with read_tool_output(handle="tool-output:<hash>",
  offset=0, length=8192).` Ranges return JSON with `handle`, `offset`, `nextOffset`, `totalBytes`
  and `text`. Offsets count UTF-8 bytes, aligned to complete characters; use `nextOffset`.
- Each read is at most 8192 bytes and also fits the original serialized tool-output limit.
  A length too small for a character fails instead of returning an unchanged continuation.
- Earlier spilled results can be projected more compactly when the context is full. That
  changes the request prefix from the first projected result; original records and references
  remain intact. Explicit compaction may summarize the visible handle, but does not delete it.

## Limits and fixed errors

`Tool output handle is unavailable in this session` deliberately covers malformed, unknown and
foreign handles. Other fixed errors include `Recorded tool output is missing or invalid`,
`Tool output offset exceeds the recorded byte length` and
`Tool output range cannot fit the current output limit`. No raw host error or file path is needed.

Full text remains subject to the existing 64 MiB blob ceiling and a host's stricter blob limit.
Image parts are not encoded as text. A custom output limit too small to represent a handle is
reported as `Tool output limit cannot fit an output retrieval handle`; limits are never raised.
Format 2 references survive reopen, backup and restore. Old programs require their matching
pre-upgrade data backup; they cannot open a format 2 store.

The design is adapted from DSH spill/spill-policy and result pruning; see the central provenance
record for the pinned source and license. No DSH package or framework is a dependency.
