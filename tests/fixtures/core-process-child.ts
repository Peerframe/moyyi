import { appendFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import type {
  ActionDigest,
  ModelStreamEvent,
  Plugin,
  SessionId,
  SessionStore,
  StoreBatch,
  ToolCallId,
} from "../../src/contracts/index.ts";
import { UNKNOWN_USAGE } from "../../src/contracts/index.ts";
import { scriptedProvider } from "../../src/plugins/provider-scripted/index.ts";
import { createRuntime } from "../../src/runtime/index.ts";
import { SqliteSessionStore } from "../../src/store/index.ts";

const [mode, dataDirectory, workspaceRoot] = process.argv.slice(2);
if (!mode || !dataDirectory || !workspaceRoot) throw new Error("Missing disposable checkpoint");
const recovering = mode.startsWith("recovery-");
const events: ModelStreamEvent[] = [
  {
    type: "part_completed",
    index: 0,
    part: {
      type: "tool_call",
      callId: "call_crash" as ToolCallId,
      providerCallId: "wire_crash",
      providerItemId: null,
      name: "synthetic_write",
      rawArguments: "{}",
      argumentsSource: "verbatim",
    },
  },
  { type: "completed", stopReason: "tool_use", providerStopReason: null, usage: UNKNOWN_USAGE },
];
const provider = scriptedProvider(
  recovering
    ? []
    : [
        events,
        [
          { type: "part_completed", index: 0, part: { type: "text", text: "Done" } },
          {
            type: "completed",
            stopReason: "end_turn",
            providerStopReason: null,
            usage: UNKNOWN_USAGE,
          },
        ],
      ],
);
const stop = (checkpoint: string, batch?: StoreBatch) => {
  writeSync(
    1,
    `${JSON.stringify({ checkpoint, requests: provider.client.requests.length, batch })}\nready\n`,
  );
  for (;;) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
};
const backing = new SqliteSessionStore(dataDirectory);
let recoveryCommits = 0;
const store: SessionStore = {
  listSessions: () => backing.listSessions(),
  loadSession: (id) => backing.loadSession(id),
  unsettledEffects: () => backing.unsettledEffects(),
  putBlob: (bytes) => backing.putBlob(bytes),
  getBlob: (ref) => backing.getBlob(ref),
  async commit(batch) {
    // Checkpoints are outside the real SQLite transaction. A crash before a commit is
    // equivalent to its previous committed row; no product fault-injection hooks are used.
    await backing.commit(batch);
    if (recovering) {
      recoveryCommits++;
      if (mode === "recovery-normalized" && recoveryCommits === 1) stop(mode, batch);
      if (
        mode === "recovery-finalized" &&
        batch.entries.some(
          (entry) => entry.body.kind === "notice" && entry.body.code === "run_recovered",
        )
      )
        stop(mode, batch);
      if (
        mode === "recovery-reconciled" &&
        batch.entries.some(
          (entry) => entry.body.kind === "notice" && entry.body.code === "effect_reconciled",
        )
      )
        stop(mode, batch);
      return;
    }
    const checkpoints = [
      ...(batch.sessions?.some((session) => session.headEntryId === null)
        ? ["session-created"]
        : []),
      ...(batch.runs?.some((run) => run.status === "active") ? ["run-started"] : []),
      ...batch.entries.flatMap((entry) =>
        entry.body.kind === "assistant_message"
          ? [
              entry.body.content.some((part) => part.type === "tool_call")
                ? "assistant-call"
                : "assistant-final",
            ]
          : [],
      ),
      ...batch.effects.map((effect) =>
        effect.state === "started"
          ? "started-barrier"
          : effect.state === "succeeded"
            ? "settled"
            : effect.state,
      ),
      ...(batch.leases?.some((lease) => lease.kind === "acquire") ? ["lease-acquired"] : []),
      ...(batch.runs?.some((run) => run.status === "completed") ? ["run-finalized"] : []),
    ];
    if (checkpoints.includes(mode)) stop(mode, batch);
  },
};
const plugin: Plugin = {
  name: "synthetic",
  apiVersion: 1,
  setup(host) {
    host.registerTool({
      name: "synthetic_write",
      description: "Synthetic crash probe only",
      inputSchema: { type: "object", additionalProperties: false },
      effect: { class: "workspace_write", reversibility: "none", verification: "none" },
      async prepare() {
        if (recovering) throw new Error("Recovery must never prepare an action");
        return {
          digest: "synthetic" as ActionDigest,
          summary: "synthetic",
          preconditions: [],
          payload: null,
        };
      },
      async execute() {
        appendFileSync(join(workspaceRoot, "execution-count"), "1");
        if (recovering) throw new Error("Recovery must never execute an action");
        if (mode === "started") stop("after-side-effect");
        return {
          status: "succeeded",
          content: [{ type: "text", text: "exact durable result" }],
          evidence: "synthetic write complete",
        };
      },
      async reconcile() {
        return mode === "recovery-reconciled"
          ? { resolved: true, status: "succeeded", evidence: "verified synthetic write" }
          : { resolved: false, reason: "No new evidence" };
      },
    });
  },
};
const runtime = await createRuntime({
  store,
  model: { provider: "scripted", model: "scripted" },
  plugins: [{ plugin: provider.plugin }, { plugin }],
  policy: {
    beforePrepare: () => ({ kind: "allow" }),
    beforeExecute: () => ({ kind: "ask" }),
  },
});
if (recovering) throw new Error("Recovery did not reach its checkpoint");
let sessionId: SessionId | undefined;
runtime.subscribe((event) => {
  if (event.type === "session.ready") sessionId = event.sessionId;
  if (event.type === "approval.requested")
    void runtime.send({
      type: "approval.respond",
      effectId: event.effectId,
      digest: event.digest,
      decision: "approve",
    });
});
await runtime.send({ type: "session.create", workspaceRoot });
if (!sessionId) throw new Error("No session");
await runtime.send({
  type: "run.start",
  sessionId,
  input: [{ type: "text", text: "Run synthetic write" }],
});
await runtime.idle();
throw new Error("Child should have stopped at the checkpoint");
