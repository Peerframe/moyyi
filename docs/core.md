# Running the self-owned core

The merged batch 4 core provides a working programmatic agent loop with deterministic models and
synthetic tools. Start with:

```sh
npm ci
npm run demo:scripted
npm run eval:core
```

The demo asks a scripted model to add two numbers using a registered read-only tool, commits the
tool result, sends it back to the model, and prints the final answer. It uses and removes its own
temporary SQLite directory. It performs no model API request, no real file-tool operation and
no network operation. The answer is scripted; this demonstrates execution, not model intelligence.

The fault eval reports 25 deterministic protocol/lifecycle scenarios and writes synthetic
evidence to ignored `evals/results/core.json`. It observes committed events and reloads entries
through the client protocol; direct database and real-process crash checks are in the tests.
It does not load `evals/private`, change public-task checkers, or claim a public-corpus score.

The ordinary run loop tells the model its remaining request count before every attempt. The last
request is reserved for a final answer: it retains prior tool evidence but disables new tool calls.
Even a provider that ignores this control cannot execute a tool in that attempt. Retries count
against the same quota, and the final attempt is not retried. With `maxModelRequests: 1`, the model
can only answer from existing context. Empty/truncated/tool-only final responses stop as budget
exhaustion; a complete answer may honestly describe partial results. Protocol completion is not
a task-quality score. Cancellation and other resource limits can still prevent an answer.
See [ADR 0021](decisions/0021-request-budget-closeout.md) for recording and provider compatibility.

The same completeness requirement applies before the last request. A token-capped response stops
with `budget_exhausted: model_output_tokens`; an empty/reasoning-only answer, unknown terminal
or uncompleted tool proposals fail the run. Partial content, usage and the original stop reason
remain recorded. There is no automatic retry or continuation, including for pending steering;
accepted steering remains in history. Valid completed responses keep ordinary steering behavior.
See [ADR 0034](decisions/0034-incomplete-response-outcomes.md). This diagnoses an incomplete
response, not the truth or completeness of its claims.

## Runtime API

Use `createRuntime` with `plugins`, an explicitly selected `{provider, model}`, and either
`dataDirectory` or an injected `SessionStore`. The runtime owns a store it creates; callers
close injected stores themselves. Plugins still load atomically and report their status. The batch 5 runtime registers the built-in
`fs` plugin before additional plugins; duplicate tool/plugin names fail instead of replacing it.
Without model/storage configuration, commands fail closed. The batch 7 CLI now drives this protocol interactively; see [cli.md](cli.md).

Subscribe before sending commands. `session.create` emits `session.ready`; `run.start` accepts
input and emits `run.started`. `send(run.start)` resolves when accepted, while `idle()` waits for
the current runs. Use `run.cancel`, `run.steer`, and `approval.respond` through the same protocol.
Unsubscribe and `close()` when finished. Concurrent close calls wait for the same cleanup.
The runtime waits for in-flight tool work to settle before releasing its store and plugins.

Accepted steering is committed immediately. Before finishing a normal response, the core checks
whether any accepted steering was absent from that request and starts another request if needed.
Commands arriving after finalization begins are rejected instead of silently dropped. Budgets
still apply: a new instruction does not add free model calls or reset the deadline.

## Execution guarantees

- Tools execute only after a complete, conforming assistant tool-use turn. The core first
  saves the assistant and the exact common request. A provider gets a separate request copy.
  For renderer `moyyi-core-v1`, the system blob contains `{origin, maxOutputTokens, content}`;
  the tools blob and individual message blobs preserve the remaining request fields. Real
  provider wire recording/mapping was added in batch 6; see [deepseek.md](deepseek.md).
- Argument validation precedes `prepare`. Preparation requires read permission. An `ask`
  decision before a prepared action exists fails closed and requires a host scope grant;
  selected read tools can ask for approval after preparation under `ReadOnlyPolicy`.
- The executor hashes the complete action, tool, arguments and effect profile. Approval
  matches the effect ID, action digest and current permission revision. A changed precondition
  requires preparation and approval again, with a bounded number of rechecks. Revocation
  invalidates the old approval even if permission is granted again later.
- `started` must commit successfully before invocation. Final effect state and bounded tool
  output commit in one transaction. Read calls can run in bounded parallel groups; other
  effects create sequential barriers. Completion order is recorded faithfully.
- Cancellation is checked across every preparation/approval/start boundary. Completed effects
  are retained. A thrown write/process/external execution may have happened and becomes
  `unknown`; it is not retried. The default policy denies all those effect classes. Tests use
  explicit synthetic policies to exercise their lifecycle without adding production tools.
- Interrupted text/refusal/reasoning and completed parts are stored. Incomplete argument deltas
  lacking a callable identity are retained as explicitly non-executable text. Every recorded
  callable tool part receives a result, including cancellation or unknown outcome.
- Only rate-limit, overload or network errors with **neither observed nor provider-reported
  partial output** can retry. Retry count, model requests and elapsed work time are bounded.
  Backoff cancellation reports cancellation, and timeout reports budget exhaustion.
  Each failed attempt retains its request and available usage before any retry. An interrupted
  attempt without recorded content becomes a runtime notice in later context; partial content
  remains unchanged. This does not claim the provider generated no output.
- Startup marks active runs interrupted, cancels effects that never started, and changes
  started effects to unknown. Permitted `reconcile` methods may inspect evidence; they never
  invoke `execute`. Evidence resolution and its new notice commit atomically. Original unknown
  results stay immutable. Repeated startup does not duplicate results/notices or replay work.
- Client and plugin observers receive frozen event copies and cannot alter an approval or
  pending tool action by mutating displayed events. Exceptions/rejected observer promises
  are isolated and recorded as diagnostics.

The default limits are 12 model requests, 60 seconds of work time, 2 retries, 4 parallel reads,
64 KiB raw input, 1 MiB cumulative model stream bytes and 32 KiB serialized tool output. The
limits can be configured by trusted runtime composition. Persistence/cleanup must still finish
after cancellation; an in-process tool that ignores its signal cannot be forcibly stopped by
this API. Untrusted process containment is a separate future capability.

## Current boundaries

The context builder retains history without automatic compaction/truncation. It uses a
conservative text capacity estimate; images fail explicitly until provider-specific accounting
exists. Opaque replay stays opaque and unchanged for its originating adapter to validate.
See [ADR 0008](decisions/0008-core-execution.md) for the validator choice and precondition scope.

Batch 5 now provides operation-time read-only capabilities and the `fs` plugin; see
[files.md](files.md) for limits and revocation. There are still no shell or write tools, real
model provider, interactive terminal or hot reload. The precondition verifier is a separate
preflight port, not an atomic write primitive. No physical power-loss, hostile-plugin CPU isolation, provider API compatibility
or real-agent task-performance claim is made.

Relevant checks: `npm run check`, `npm run eval:core`, `npm run demo:scripted` and
`npm run build`. The [handoff](tasks/2026-10-25-batch-4-core.md) records exact delivery evidence.
