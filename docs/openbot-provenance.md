# OpenBot provenance

moyyi is a new project. OpenBot's code is not copied wholesale, renamed or used as a fallback.
This file records everything that is taken from OpenBot so the origin stays traceable.

## Rules

- Port failure scenarios and the knowledge in their tests, rewritten against moyyi's contracts.
- Small functions without business dependencies may be copied. Record each one below with its
  source path and revision.
- Not ported: Server authority, Bot/team/channel models, Temporal, old protocols, old database
  migrations.

## Failure scenarios to port

Each becomes a deterministic test using the scripted model and fault injection:

- [x] Cancellation racing a tool start — [executor tests](../src/core/executor.test.ts), including
  cancellation immediately after the durable start barrier, before invocation
- [x] Permission revoked during a run — executor and [protocol tests](../tests/runtime-core.test.ts),
  including revoke/regrant invalidating an approval epoch
- [x] Output and input size limits exceeded — executor truncation and
  [argument validation tests](../src/runtime/validation.test.ts)
- [x] Invalid tool arguments — strict JSON/schema rejection before prepare, paired result
- [x] Symlinks pointing outside the workspace — actual disposable filesystem cases in
  [precondition tests](../src/runtime/preconditions.test.ts); this validates the preflight port,
  not a file capability. The batch 5 operation-time confinement tests remain required
- [x] Overwrite conflicts (file changed after preview or approval) — file-hash preflight plus
  executor/protocol re-approval with a new digest. No actual file-write tool is implemented
- [x] Outcome unknown after interruption — [real-process recovery tests](../tests/core-recovery.test.ts)
  kill after execution starts, reopen, retain unknown and never invoke the action again

These are independently written moyyi tests based on the listed failure scenarios. They do not
copy OpenBot code or establish general filesystem/process isolation. Batch 4's synthetic
write tools exist only in tests; the default product policy remains read-only.

## Copied code

| moyyi path | OpenBot source | Revision | Notes |
|---|---|---|---|
| — | — | — | nothing copied yet |
