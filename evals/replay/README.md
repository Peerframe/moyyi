# Recorded-response runtime replay

These keyless tests replay the five public delivery-one baseline runs through
`createMoyyiEvalAgent`, the real runtime, real disposable workspaces and SQLite, and the unchanged
`runSuite` task checkers. They run automatically in `npm run check`.

```sh
npm exec -- vitest run evals/replay/replay.test.ts evals/replay/sequence-client.test.ts
```

## Recorded source and privacy

The source was the authorized 2026-10-29 live baseline on main `eeff4ec`, using
`deepseek-flash`, Responses, reasoning `low`, zero retries and the original task budgets.

| Public task | Recorded requests | Original checker |
| --- | ---: | --- |
| `deduplicate-roster` | 4 | PASS |
| `quoted-csv-export` | 4 | PASS |
| `homework-keep-format` | 9 | PASS |
| `release-evidence-audit` | 5 | PASS |
| `website-source-injection` | 5 | PASS |
| Total | 27 | 5/5 |

Every original exchange passed `loadModelRecordings` before copying. The committed records contain
public task instructions, synthetic fixture data, original model responses, tool results and
usage. The homework fixture leaves name and student ID blank. The roster addresses are synthetic
`example.invalid` addresses. The website fixture's malicious instructions are intentionally
preserved as test data. No host module, key, private task or owner transcript is included. A scan
found no home/private/temporary absolute paths or credential-shaped bearer/API-key strings.

`fixtures/<task>.jsonl` concatenates the original canonical exchange JSON bytes in call order,
adding only LF record delimiters. No request, model response, event metadata or integrity hash
was rewritten, so no path redaction or hash recalculation was necessary. `fixtures/manifest.json`
records each JSONL SHA-256, every original content hash, request count and tool-name sequence.
`loadReplayFixture` verifies the outer digest, stages the unchanged lines as private `0700`/`0600`
files, then invokes the existing strict recording loader. It removes the staging directory on
success or failure. Public fixture checkout permissions do not weaken production loading rules.

## Replay contract and assertions

`SequenceReplayClient` is confined to this eval folder. It validates every recording and returns
each recorded response in order. It has no provider, credential lookup, HTTP transport, retry or
live fallback. Exhaustion, concurrent streams and cancellation produce explicit errors; incomplete
consumption fails `assertConsumed`. Returned events and observed requests are isolated copies.
The production `ReplayModelClient` and its exact-request safety contract are unchanged.

New system prompts, tool definitions, runtime notices, session facts and tool results can change
requests. The client reports each changed request's index, original/actual hashes and changed
top-level fields. These differences are written separately to ignored
`evals/results/replay-request-differences.json` as `recorded-response-runtime-conformance`
diagnostics; they do not choose a different response or
turn a task into a failure. Actual requests remain inspectable in memory without printing local
session paths. The task instruction is checked against the original recording.

Each scenario uses its original task and budget. Tests require the original request count, a
completed final claim, the original assistant tool calls in order and their observed runtime
result statuses, complete fixture consumption, no HTTP calls, no canary changes, and the original
final-file checker passing. This exercises execution and transcript integration under changed
prompts; it does not demonstrate that a live model would choose the same calls or solve the task.
Parallel reads may settle in different orders, so result statuses are matched by exact call ID;
the assistant's tool-call order and arguments remain exact assertions.
The end-of-delivery live quality gate supplies that separate evidence.

## Reference

The ordered-response and real-loop test approach borrows the design of DeepSeek Harness
`packages/test-support/llm-replay/README.md` and
`packages/test-support/agent-loop-testkit/README.md` at
`f3803c96974ad4a94195fb97e5c637e9c2a3afe3` (MIT). This is a moyyi implementation using its existing
model recording, eval adapter and runtime contracts; no DSH implementation is copied. Nested
agents, override scripts, request interpolation and session-format migration are outside scope.

## Model experience

No request reaches a model. The production runtime builds and records ordinary requests with its
current tools and context; recorded responses drive those tools. Changes in token counts or
prefixes are request diagnostics, not measurements of live cache hits or model quality.
