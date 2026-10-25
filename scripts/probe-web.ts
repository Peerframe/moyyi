import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type ModelStreamEvent,
  type RuntimeEvent,
  type ToolCallId,
  UNKNOWN_USAGE,
} from "../src/contracts/index.ts";
import { scriptedProfile, scriptedProvider } from "../src/plugins/provider-scripted/index.ts";
import { createRuntime, type Runtime } from "../src/runtime/index.ts";

// Explicit manual network probe: one public GET, no paid model, credentials or I/O substitutions.
const root = mkdtempSync(join(tmpdir(), "moyyi-public-web-"));
const workspace = join(root, "workspace");
mkdirSync(workspace);
const finish: ModelStreamEvent = {
  type: "completed",
  stopReason: "end_turn",
  providerStopReason: null,
  usage: UNKNOWN_USAGE,
};
const provider = scriptedProvider([
  [
    {
      type: "part_completed",
      index: 0,
      part: {
        type: "tool_call",
        callId: "public_fetch" as ToolCallId,
        providerCallId: "public_fetch",
        providerItemId: null,
        name: "web_fetch",
        rawArguments: '{"url":"https://example.com/"}',
        argumentsSource: "verbatim",
      },
    },
    { ...finish, stopReason: "tool_use" },
  ],
  [
    { type: "part_completed", index: 0, part: { type: "text", text: "Recorded HTTP receipt." } },
    finish,
  ],
]);
let runtime: Runtime | undefined;
try {
  runtime = await createRuntime({
    model: scriptedProfile.origin,
    plugins: [{ plugin: provider.plugin }],
    dataDirectory: join(root, "data"),
    web: { allowedOrigins: ["https://example.com"], approval: "allow", timeoutMs: 20_000 },
  });
  const events: RuntimeEvent[] = [];
  runtime.subscribe((event) => events.push(event));
  await runtime.send({ type: "session.create", workspaceRoot: workspace });
  const session = events.find((event) => event.type === "session.ready");
  assert(session);
  await runtime.send({
    type: "run.start",
    sessionId: session.sessionId,
    input: [{ type: "text", text: "Fetch https://example.com/ once." }],
  });
  await runtime.idle();
  const result = events.flatMap((event) =>
    event.type === "entry.appended" && event.entry.body.kind === "tool_results"
      ? event.entry.body.results
      : [],
  )[0];
  assert(result);
  const text = result.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
  const passed = result.status === "succeeded" && text.includes("Example Domain");
  console.log(
    JSON.stringify({
      url: "https://example.com/",
      passed,
      toolStatus: result.status,
      run: events.findLast((event) => event.type === "run.finished")?.outcome.kind,
      realHttp: true,
      model: "scripted",
      transportOverrides: false,
    }),
  );
  if (!passed) {
    console.error(text);
    process.exitCode = 1;
  }
} finally {
  await runtime?.close();
  rmSync(root, { recursive: true, force: true });
}
