import { writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import type {
  ActionDigest,
  ModelStreamEvent,
  Plugin,
  SessionId,
  ToolCallId,
} from "../../src/contracts/index.ts";
import { UNKNOWN_USAGE } from "../../src/contracts/index.ts";
import { scriptedProvider } from "../../src/plugins/provider-scripted/index.ts";
import { createRuntime } from "../../src/runtime/index.ts";

const [mode, dataDirectory, workspaceRoot] = process.argv.slice(2);
if (!dataDirectory || !workspaceRoot) throw new Error("Missing disposable paths");
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
const provider = scriptedProvider([events]);
const stop = () => {
  writeSync(1, "ready\n");
  for (;;) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
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
        return {
          digest: "synthetic" as ActionDigest,
          summary: "synthetic",
          preconditions: [],
          payload: null,
        };
      },
      async execute() {
        writeFileSync(join(workspaceRoot, "execution-count"), "1");
        if (mode === "started") stop();
        return {
          status: "succeeded",
          content: [{ type: "text", text: "exact durable result" }],
          evidence: "synthetic write complete",
        };
      },
    });
  },
};
const runtime = await createRuntime({
  dataDirectory,
  model: { provider: "scripted", model: "scripted" },
  plugins: [{ plugin: provider.plugin }, { plugin }],
  policy: { beforePrepare: () => ({ kind: "allow" }), beforeExecute: () => ({ kind: "allow" }) },
});
let sessionId: SessionId | undefined;
runtime.subscribe((event) => {
  if (event.type === "session.ready") sessionId = event.sessionId;
  if (mode === "settled" && event.type === "effect.updated" && event.effect.state === "succeeded")
    stop();
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
