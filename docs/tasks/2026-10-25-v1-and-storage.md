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

## Current delivery record (2026-10-25)

Workspace: the moyyi repository checkout. Base main: `1470a69`. D2 branch:
`codex/d2-v1-amendment`, commit `095d8948b7fd8ab8980cc3433c31d30c4acaa55c`.
[PR #6](https://github.com/Peerframe/moyyi/pull/6) targets main and is ready for review.
`npm run check` passed (13 files, 354 tests; typecheck and lint passed), then
[CI run 40163545371](https://github.com/Peerframe/moyyi/actions/runs/40163545371) passed on that
commit. Only then was `codex/batch-3-store` created from it. The amended persisted folder has
not changed during storage implementation. The one-time incompatible v1 amendment is consumed.

Batch 3 delivers `SqliteSessionStore`, the initial transactional schema migration, verified
content-addressed blobs, OS writer locks, session/run state, exclusive workspace leases and
consistent backup/restore. [ADR 0002](../decisions/0002-storage.md) records the driver comparison,
version evidence and filesystem boundary; [store.md](../store.md) documents the API and errors.
No new npm dependency, OpenBot copy, boundary-rule change or eval/checker weakening was needed.

Acceptance evidence on the storage branch:

- `npx vitest run src/store/records.test.ts`: 100 strict-record cases, including original v1
  JSON round-trip, refusal/reasoning, raw arguments, unknown usage, opaque replay and size limits.
- `npx vitest run src/store/files.test.ts`: 19 real-filesystem cases for SHA-256 publication,
  deduplication, corruption, limits, private permissions, symbolic links and same-process locks.
- `npx vitest run tests/store.test.ts tests/store-process.test.ts`: real SQLite integration
  and six child-process cases. SIGKILL before commit rolls back all records; SIGKILL after an
  acknowledged commit retains them. A killed first migration can be reopened. Competing
  processes fail to acquire the writer lock; the OS releases it after death.
- Full `npm run check`: typecheck and lint (88 files) passed; 17 test files / 506 tests passed.
  The exact final PR head CI remains the remote delivery gate; its result is recorded in the PR.
  Earlier checkpoints are not substituted for final-head evidence.

The frozen fixture's four external blob references originally have placeholder hashes and no
payloads. The integration test materializes synthetic payloads and substitutes only those
references, compares all written/read records unchanged, then repeats after reopen. Pure
record tests preserve the original fixture exactly. No missing/hash validation is bypassed.
The `unknown` effect fixture reaches its state through legal transitions, with its lease held.

Independent review closed these issues before delivery: overlapping parent/child workspace
leases, missing/altered schema constraints or extra triggers, releasing a moved workspace,
and a final backup-publication sync failure. The latter raises `BackupDurabilityError` with
the visible destination and explicitly unconfirmed durability; it is never reported as success.

Not verified: physical power loss, faulty/network filesystems, Windows, large-history load or
backup performance, and real provider APIs. Tests use local synthetic directories only; they
do not prove exactly-once external effects. No private eval files or real credentials were read.
Runtime wiring, core execution/recovery, context, permissions and providers remain future work;
`createRuntime` still reports not implemented. Batch 4 has not started.

Owner decisions: no new architecture choice is pending. Review the two PRs; after owner merges
D2, retarget the storage PR to main and let its CI run again. Neither PR is automatically merged.
There are no continuing test processes or delegated writers after the delivery checkpoint;
final code revision and CI links are recorded in the PR to avoid a self-referential commit hash.
