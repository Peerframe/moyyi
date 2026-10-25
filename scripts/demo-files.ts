import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type FileList,
  type FileRead,
  type FileSearch,
  type ModelStreamEvent,
  type RunOutcome,
  type SessionId,
  type ToolCallId,
  type ToolResultPart,
  UNKNOWN_USAGE,
} from "../src/contracts/index.ts";
import { scriptedProfile, scriptedProvider } from "../src/plugins/provider-scripted/index.ts";
import { createRuntime, type Runtime } from "../src/runtime/index.ts";

const terminal = (stopReason: "tool_use" | "end_turn"): ModelStreamEvent => ({
  type: "completed",
  stopReason,
  providerStopReason: null,
  usage: UNKNOWN_USAGE,
});
const tool = (name: string, args: unknown): readonly ModelStreamEvent[] => [
  {
    type: "part_completed",
    index: 0,
    part: {
      type: "tool_call",
      callId: `demo_${name}` as ToolCallId,
      providerCallId: `demo_${name}`,
      providerItemId: null,
      name,
      rawArguments: JSON.stringify(args),
      argumentsSource: "verbatim",
    },
  },
  terminal("tool_use"),
];
const answer =
  "src/main.ts exports greet(), which returns Hello from moyyi. The ignored fixture was excluded from search.";
const provider = scriptedProvider([
  tool("list", {}),
  tool("search", { query: "greet(" }),
  tool("read", { path: "src/main.ts" }),
  [
    { type: "text_delta", index: 0, text: answer },
    { type: "part_completed", index: 0, part: { type: "text", text: answer } },
    terminal("end_turn"),
  ],
]);
const directory = mkdtempSync(join(tmpdir(), "moyyi-demo-files-"));
let runtime: Runtime | undefined;
try {
  const workspace = join(directory, "workspace");
  mkdirSync(join(workspace, "src"), { recursive: true });
  mkdirSync(join(workspace, "generated"));
  writeFileSync(
    join(workspace, "README.md"),
    "# Demo project\nThe greeting is implemented in src/main.ts.\n",
  );
  writeFileSync(
    join(workspace, "src/main.ts"),
    'export function greet() { return "Hello from moyyi"; }\n',
  );
  writeFileSync(join(workspace, ".gitignore"), "generated/\n");
  writeFileSync(join(workspace, "generated/ignored.ts"), "// greet() ignored fixture\n");
  runtime = await createRuntime({
    dataDirectory: join(directory, "data"),
    model: scriptedProfile.origin,
    limits: { timeoutMs: 15000 },
    plugins: [{ plugin: provider.plugin }],
  });
  assert.ok(runtime.plugins.every((plugin) => plugin.state === "loaded"));
  let sessionId: SessionId | undefined;
  let outcome: RunOutcome | undefined;
  let reloading = false;
  const results = new Map<string, ToolResultPart>();
  runtime.subscribe((event) => {
    if (event.type === "session.ready") sessionId = event.sessionId;
    if (event.type === "assistant.delta") console.log(`Assistant: ${event.text}`);
    if (event.type === "entry.appended" && event.entry.body.kind === "tool_results") {
      for (const result of event.entry.body.results) {
        if (reloading) results.set(result.callId, result);
        else
          console.log(
            `Tool ${result.callId.replace("demo_", "")}: ${result.status}\n${result.content.map((part) => (part.type === "text" ? part.text : "[image]")).join("\n")}`,
          );
      }
    }
    if (event.type === "run.finished") outcome = event.outcome;
    if (event.type === "command.rejected") console.error(`Rejected: ${event.reason}`);
  });
  console.log(
    "moyyi file demo: real list/search/read tools, temporary workspace and SQLite; scripted model, no network calls.",
  );
  console.log("User: Find the greeting implementation and explain what it returns.");
  await runtime.send({ type: "session.create", workspaceRoot: workspace });
  assert.ok(sessionId);
  await runtime.send({
    type: "run.start",
    sessionId,
    input: [
      { type: "text", text: "Find the greeting implementation and explain what it returns." },
    ],
  });
  await runtime.idle();
  reloading = true;
  await runtime.send({ type: "session.load", sessionId });
  assert.deepEqual(outcome, { kind: "completed" });
  assert.equal(results.size, 3);
  assert.equal(provider.client.requests.length, 4);
  const data = <T>(name: string): T => {
    const result = results.get(`demo_${name}`);
    assert.equal(result?.status, "succeeded");
    const part = result?.content.find((part) => part.type === "text");
    assert.ok(part?.type === "text");
    return JSON.parse(part.text) as T;
  };
  assert.ok(data<FileList>("list").entries.some((entry) => entry.path === "src"));
  assert.deepEqual(
    data<FileSearch>("search").matches.map((match) => match.path),
    ["src/main.ts"],
  );
  assert.equal(
    data<FileRead>("read").text,
    'export function greet() { return "Hello from moyyi"; }\n',
  );
  for (const [index, result] of [...results.values()].entries()) {
    assert.ok(
      provider.client.requests[index + 1]?.messages.some((message) =>
        message.content.some(
          (part) =>
            part.type === "tool_result" &&
            part.callId === result.callId &&
            JSON.stringify(part) === JSON.stringify(result),
        ),
      ),
    );
  }
  console.log(
    "Verified: three persisted real file results, each delivered to the next model request; ignored content excluded; run completed.",
  );
  console.log(
    "The model's plan and final answer are scripted. This demonstrates file access and execution guarantees, not model reasoning quality.",
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  try {
    await runtime?.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
