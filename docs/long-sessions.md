# Recovery and long conversations

Use `/compact` in an idle interactive session to summarize older turns with the currently
selected model. The same operation is available through the protocol:

```ts
await runtime.send({ type: "session.compact", sessionId });
await runtime.idle();
```

The latest two user turns remain verbatim. The earlier eligible prefix is replaced in future
model requests by a recorded summary; the original conversation is retained in SQLite and blobs.
`/resume` shows recorded history, with summary-request audit entries labeled separately.
Compaction uses one model request, so a paid host can incur its normal cost. `/cancel` or Ctrl-C
cancels this run before publication. If the summary transaction has already begun, it may
finish successfully despite a late cancellation; a published summary is reported as completed.
Ordinary steering and a second concurrent run are rejected during compaction.
The finite `--demo` provider is not a summarizer; use scripted tests for offline verification.

With `RuntimeOptions.autoCompact` (CLI `--auto-compact` or `--long`), the same compaction runs
automatically at the start of a turn whose compactable history needs at least 70% (or the
configured ratio) of the model's context window. It uses one request of that turn, never the
last one; a summary that does not reduce the context is discarded and the turn continues.
Inside a long turn, before each tool-enabled request over the same threshold, it summarizes
earlier tool steps of that turn instead, keeping the request, any steering and the latest three
steps verbatim. Original entries remain in history. See
[ADR 0049](decisions/0049-long-running-sessions.md).

Compact before the source becomes too large. Very short history, an unsafe tool boundary,
oversized input, a response without summary text, a refusal or an incomplete response, or a summary that cannot reduce
the request is rejected. A rejected summary preserves the old active history; it never silently removes
messages. Summary generation cannot call tools, approve actions or mark unknown actions successful.

The context builder keeps static sections first, then session and turn sections, and produces
stable tool ordering. Unchanged history remains a reusable prefix. This is cache-aware request
construction, not a local cache or a guarantee of provider cache hits. A compaction changes that
prefix. Actual cache usage remains whatever the provider reports, including unknown counters.

On restart, the runtime reconciles durable records. An action recorded as started with no known
outcome becomes unknown and is not automatically repeated. Actions that never started are
cancelled. Settled results remain paired with their calls, and unknown writes/commands retain
the workspace lease. Recovery can itself be interrupted and retried without duplicate actions
or losing its notice. Inspect unknown effects and the workspace before deciding how to continue.
A historical unknown tool result is conservatively retained even after a later reconciliation
notice; its original record is not rewritten. This can limit the prefix eligible for compaction.

Run `npm run eval:long-sessions` for deterministic long-history compaction/resume/recompaction,
real read-tool execution, and rejected summary cases. Tests additionally exercise cancellation,
budget and real process-kill boundaries. These runs need no credential and make no network model
call. They do not prove a real model preserves every fact. A separate live eight-turn/reopen/compact/
reopen case preserved ten corrected facts, constraints and pending states; original history was
retained and resume made no model request. This single case does not establish general fidelity
or cache savings. See the [current evidence](tasks/2026-10-26-optimization-plan.md). See [ADR 0014](decisions/0014-recovery-and-compaction.md) and
the [current handoff](tasks/2026-10-25-phase-4-long-sessions.md).
