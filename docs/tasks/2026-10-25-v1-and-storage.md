# D2 v1 amendment and batch 3 storage

Owner authorization: 2026-10-25. Implement D2 first, then batch 3. Changes to
`src/contracts/persisted` are explicitly authorized for this one-time amendment. Deliver two
branches/PRs without merging them. The owner explicitly permits the storage PR to depend on the
D2 branch this time; retarget it to main after the owner merges D2. No paid model calls, real
credentials, private eval data, or batch 4 implementation.

## D2 scope and acceptance

The starting main is `1470a69`. There is no store implementation or local `.moyyi` directory in
this checkout. No private data was inspected. The ADR 0003 pre-storage exception is used once:
keep persisted version 1, replace its typed fixture, and lock this amended shape for the store.
Any subsequent incompatible change follows the ordinary version/migration recipe.

- Add typed refusal and visible/summary/opaque reasoning. DeepSeek full reasoning remains
  visible text in common content; summaries cannot replace it. Opaque provider bytes live only
  in the message-level replay envelope.
- Preserve verbatim versus synthesized tool arguments and distinguish provider call/item IDs.
- Preserve normalized termination plus raw provider termination detail. Unknown usage counters
  are null; final and partial observations are distinct, and token subcounts are not added twice.
- Bind replay to RFC 8785 serialization of `{role, content}` and SHA-256, plus exact provider,
  model, non-secret API profile and known model revision. Unknown revision is not equality.
  Use a versioned envelope with a 1 MiB UTF-8 limit for the entire serialized envelope. Reject
  oversized or malformed envelopes; never truncate or parse their payload outside the adapter.
- Editing/compaction/truncation explicitly removes replay even if content later returns to
  identical bytes. Failed replay validation never authorizes a common-only request: the later
  adapter must separately validate that request or reject it under ADR 0003.
- Streaming refusal/reasoning kinds and error usage survive the model contract. Partial output
  includes deltas before any part completes; cancellation cannot make prior output disappear.

Acceptance: JSON round-trip and exhaustive typed fixture coverage; canonicalization vectors and
invalid JSON rejection; content/role/order/origin/version/size mismatch rejection; explicit
invalidation; unknown/partial/final usage; refusal and interrupted-delta conformance; scripted
cancellation. Run focused tests and `npm run check`, then PR CI. No provider implementation or
live API acceptance is claimed.

## Batch 3 scope and acceptance

Start only after D2 code and its acceptance are complete. Implement `SessionStore` under
`src/store` against the amended v1. Choose the SQLite driver and OS lock using targeted evidence
inside this batch, and record exact versions/platform limits in ADR 0002.

- Versioned SQLite schema/migration runner; transcript, effects and session/run state updated
  atomically. Reject illegal effect transitions and immutable-history rewrites.
- Both durability labels use WAL + FULL. Publish SHA-256 blobs durably before committing their
  references; deduplicate them, validate reads, and support a consistent database/blob backup.
- Hold an OS-managed exclusive writer lock per data directory. Session/run and workspace lease
  constraints must be enforceable without implementing the batch 4 loop.
- Test rollback after an injected failure, invalid transitions, amended fixture round-trip,
  process death inside a transaction, competing processes, lock release after death, blob
  deduplication, missing/corrupt blobs, durability settings and consistent backup/restore.

Tests use disposable synthetic directories only. A process-kill test is not proof of physical
power-loss survival on every filesystem. No exactly-once side-effect promise. The runtime and
core loop stay unimplemented; batch 4 is not started. Run `npm run check` and CI; record what was
executed, what remains platform-dependent, and the D2 PR dependency in the storage PR.
