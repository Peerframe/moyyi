import { writeSync } from "node:fs";
import {
  type ModelStreamEvent,
  type SessionId,
  type ToolCallId,
  UNKNOWN_USAGE,
} from "../../src/contracts/index.ts";
import { scriptedProfile, scriptedProvider } from "../../src/plugins/provider-scripted/index.ts";
import { createRuntime } from "../../src/runtime/index.ts";

const [checkpoint, dataDirectory, workspaceRoot] = process.argv.slice(2);
if (!dataDirectory || !workspaceRoot || !["started", "running"].includes(checkpoint ?? ""))
  throw Error("Missing disposable shell crash arguments");
const terminal = (stopReason: "tool_use" | "end_turn"): ModelStreamEvent => ({
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
        callId: "call_shell_crash" as ToolCallId,
        providerCallId: "wire_shell_crash",
        providerItemId: null,
        name: "shell",
        rawArguments: JSON.stringify({
          command:
            'printf "%s" "$$" > process-group; printf once >> marker; /bin/sleep 0.8; printf ended > ended',
          timeoutMs: 5_000,
        }),
        argumentsSource: "verbatim",
      },
    },
    terminal("tool_use"),
  ],
  [terminal("end_turn")],
]);
let sequence = 0;
const runtime = await createRuntime({
  dataDirectory,
  model: scriptedProfile.origin,
  plugins: [{ plugin: provider.plugin }],
  workspaceProcesses: { roots: [workspaceRoot], approval: "allow" },
  ids: {
    next: (prefix) =>
      prefix === "session" ? "session_shell_crash" : `${prefix}_shell_crash_${++sequence}`,
  },
});
runtime.subscribe((event) => {
  if (
    checkpoint === "started" &&
    event.type === "effect.updated" &&
    event.effect.state === "started"
  ) {
    writeSync(1, "ready\n");
    // The parent kills the actual runtime after the durable barrier, before native launch.
    for (;;) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  }
});
await runtime.send({ type: "session.create", workspaceRoot });
if (checkpoint === "running") writeSync(1, "ready\n");
await runtime.send({
  type: "run.start",
  sessionId: "session_shell_crash" as SessionId,
  input: [{ type: "text", text: "Run the synthetic shell crash fixture." }],
});
await runtime.idle();
await runtime.close();
throw Error("Parent did not interrupt the synthetic runtime in time");
