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
  executor/protocol re-approval with a new digest. Phase 2 adds real write/undo conflict tests in `tests/runtime-writes.test.ts`
- [x] Outcome unknown after interruption — [real-process recovery tests](../tests/core-recovery.test.ts)
  kill after execution starts, reopen, retain unknown and never invoke the action again

These are independently written moyyi tests based on the listed failure scenarios. They do not
copy OpenBot code or establish general filesystem/process isolation. Batch 4's synthetic
write tools were synthetic; phase 2 introduces an explicit runtime write grant. The default remains read-only.

## Copied code

| moyyi path | OpenBot source | Revision | Notes |
|---|---|---|---|
| `src/plugins/skills/parse.ts` | `packages/employee-publisher/src/agent-skills.ts` | `010439bb9002fabb7e1facd8450ee85edbafa309` | Adapted bounded YAML AST-validation approach (aliases, anchors/tags, scalar keys, node/depth caps); rewritten schema checks and moyyi plugin/port, no publisher or authority code. MIT notice in `THIRD_PARTY_NOTICES.md` |

## Skills boundary experience

Reviewed the same OpenBot revision's `apps/server-python/src/openbot_server/employee_knowledge_inputs.py`
and `apps/server-python/tests/test_skill_yaml.py`. The scalar-type cases (block/folded strings,
comments, YAML 1.2 strings and numeric/boolean/null rejection), duplicate-key cases and inert
`allowed-tools` boundary are independently rewritten in
[src/plugins/skills/parse.test.ts](../src/plugins/skills/parse.test.ts). OpenBot's secret-text heuristic,
publication schemas, author/publisher identity and control plane are not imported. No OpenBot
worktree file was modified. The reviewed source files matched that commit despite unrelated local
OpenBot changes. The runtime reader, request recording, permission and cancellation mechanisms
remain moyyi's existing implementations; see [ADR 0019](decisions/0019-explicit-skills-context.md).
