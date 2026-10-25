import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ActionDigest,
  type ModelStreamEvent,
  type Plugin,
  type RunOutcome,
  type SessionId,
  type ToolCallId,
  UNKNOWN_USAGE,
} from "../src/contracts/index.ts";
import { scriptedProfile, scriptedProvider } from "../src/plugins/provider-scripted/index.ts";
import { createRuntime, type Runtime } from "../src/runtime/index.ts";
import { SqliteSessionStore } from "../src/store/index.ts";

const complete = (stopReason: "tool_use" | "end_turn"): ModelStreamEvent => ({
  type: "completed",
  stopReason,
  providerStopReason: null,
  usage: UNKNOWN_USAGE,
});
const provider = scriptedProvider([
  [
    {
      type: "part_completed",
      index: 0,
      part: {
        type: "tool_call",
        callId: "demo_add_1" as ToolCallId,
        providerCallId: "demo_add_1",
        providerItemId: null,
        name: "demo_add",
        rawArguments: '{"a":2,"b":3}',
        argumentsSource: "verbatim",
      },
    },
    complete("tool_use"),
  ],
  [
    {
      type: "text_delta",
      index: 0,
      text: "2 + 3 = 5. The tool result was recorded before this answer.",
    },
    {
      type: "part_completed",
      index: 0,
      part: { type: "text", text: "2 + 3 = 5. The tool result was recorded before this answer." },
    },
    complete("end_turn"),
  ],
]);
let executions = 0;
const arithmetic: Plugin = {
  name: "demo-arithmetic",
  apiVersion: 1,
  setup(host) {
    host.registerTool({
      name: "demo_add",
      description: "Add two small integers without external side effects.",
      inputSchema: {
        type: "object",
        properties: {
          a: { type: "integer", minimum: -1000, maximum: 1000 },
          b: { type: "integer", minimum: -1000, maximum: 1000 },
        },
        required: ["a", "b"],
        additionalProperties: false,
      },
      effect: { class: "read", reversibility: "not_applicable", verification: "not_applicable" },
      async prepare(args) {
        const { a, b } = args as { a: number; b: number };
        return {
          digest: "core-replaces-this" as ActionDigest,
          summary: `Add ${a} and ${b}`,
          preconditions: [],
          payload: { a, b },
        };
      },
      async execute(action) {
        const { a, b } = action.payload as { a: number; b: number };
        executions++;
        console.log(`Tool: demo_add(${a}, ${b}) = ${a + b}`);
        return { status: "succeeded", content: [{ type: "text", text: String(a + b) }] };
      },
    });
  },
};

const directory = mkdtempSync(join(tmpdir(), "moyyi-demo-"));
let store: SqliteSessionStore | undefined;
let runtime: Runtime | undefined;
try {
  const workspace = join(directory, "workspace");
  mkdirSync(workspace);
  store = new SqliteSessionStore(join(directory, "data"));
  runtime = await createRuntime({
    store,
    model: scriptedProfile.origin,
    plugins: [{ plugin: provider.plugin }, { plugin: arithmetic }],
  });
  assert.ok(
    runtime.plugins.every((plugin) => plugin.state === "loaded"),
    "Demo plugins must load",
  );
  let sessionId: SessionId | undefined;
  let outcome: RunOutcome | undefined;
  runtime.subscribe((event) => {
    if (event.type === "session.ready") sessionId = event.sessionId;
    if (event.type === "assistant.delta") console.log(`Assistant: ${event.text}`);
    if (event.type === "effect.updated" && event.effect.state === "started")
      console.log("Journal: durable started record committed; tool may execute.");
    if (event.type === "run.finished") {
      outcome = event.outcome;
      console.log(`Run: ${event.outcome.kind}`);
    }
    if (event.type === "command.rejected") console.error(`Rejected: ${event.reason}`);
  });
  console.log(
    "moyyi deterministic demo: real runtime + temporary SQLite; scripted model, synthetic read tool.",
  );
  console.log("User: What is 2 + 3?");
  await runtime.send({ type: "session.create", workspaceRoot: workspace });
  assert.ok(sessionId, "Session creation must succeed");
  await runtime.send({
    type: "run.start",
    sessionId,
    input: [{ type: "text", text: "What is 2 + 3? Use demo_add." }],
  });
  await runtime.idle();
  const snapshot = await store.loadSession(sessionId);
  assert.equal(executions, 1);
  assert.deepEqual(outcome, { kind: "completed" });
  assert.equal(snapshot?.effects[0]?.state, "succeeded");
  assert.ok(
    snapshot?.entries.some(
      (entry) =>
        entry.body.kind === "tool_results" &&
        entry.body.results.some(
          (result) =>
            result.status === "succeeded" &&
            result.content.some((part) => part.type === "text" && part.text === "5"),
        ),
    ),
  );
  assert.ok(
    provider.client.requests[1]?.messages.some((message) =>
      message.content.some((part) => part.type === "tool_result" && part.status === "succeeded"),
    ),
  );
  console.log(
    "Verified: one execution, persisted tool result, second model request, completed run.",
  );
  console.log("This demonstrates execution guarantees; it is not a real-model capability score.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  try {
    await runtime?.close();
  } finally {
    try {
      store?.close();
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
}
