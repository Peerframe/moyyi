import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, expect, it } from "vitest";
import {
  type ModelStreamEvent,
  type RuntimeEvent,
  type SessionId,
  type ToolCallId,
  UNKNOWN_USAGE,
} from "../src/contracts/index.ts";
import { scriptedProfile, scriptedProvider } from "../src/plugins/provider-scripted/index.ts";
import { createRuntime } from "../src/runtime/index.ts";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const call = (id: string, name: string, args: unknown): ModelStreamEvent[] => [
  {
    type: "part_completed",
    index: 0,
    part: {
      type: "tool_call",
      callId: id as ToolCallId,
      providerCallId: id,
      providerItemId: null,
      name,
      rawArguments: JSON.stringify(args),
      argumentsSource: "verbatim",
    },
  },
  { type: "completed", stopReason: "tool_use", providerStopReason: null, usage: UNKNOWN_USAGE },
];
const done: ModelStreamEvent[] = [
  { type: "part_completed", index: 0, part: { type: "text", text: "Done." } },
  { type: "completed", stopReason: "end_turn", providerStopReason: null, usage: UNKNOWN_USAGE },
];

it("offers configured MCP tools, applies owner approvals and stops the server on close", async () => {
  const root = mkdtempSync(join(tmpdir(), "moyyi-rmcp-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "w");
  mkdirSync(workspace);
  const pidFile = join(root, "pid");
  const provider = scriptedProvider([
    call("c1", "mcp__fixture__echo", { text: "from the model" }),
    call("c2", "mcp__fixture__fail", {}),
    done,
  ]);
  const runtime = await createRuntime({
    model: scriptedProfile.origin,
    dataDirectory: join(root, "d"),
    plugins: [{ plugin: provider.plugin }],
    mcp: {
      servers: [
        {
          name: "fixture",
          command: process.execPath,
          args: [resolve("tests/fixtures/mcp-server.mjs")],
          env: { MCP_FIXTURE_PID_FILE: pidFile },
          readOnlyTools: ["echo"],
          tools: ["echo", "fail"],
        },
      ],
    },
  });
  let closed = false;
  cleanups.push(async () => {
    if (!closed) await runtime.close();
  });
  expect(runtime.plugins).toContainEqual({ name: "mcp", state: "loaded" });
  expect(runtime.diagnostics).toContainEqual(expect.stringContaining("mcp | fixture: 2 tool(s)"));
  const events: RuntimeEvent[] = [];
  const approvals: string[] = [];
  runtime.subscribe((event) => {
    events.push(event);
    if (event.type === "approval.requested") {
      approvals.push(event.summary);
      void runtime.send({
        type: "approval.respond",
        effectId: event.effectId,
        digest: event.digest,
        decision: "approve",
      });
    }
  });
  await runtime.send({ type: "session.create", workspaceRoot: workspace });
  const { sessionId } = events.find((event) => event.type === "session.ready") as {
    sessionId: SessionId;
  };
  await runtime.send({ type: "run.start", sessionId, input: [{ type: "text", text: "Use MCP" }] });
  await runtime.idle();
  const offered = provider.client.requests[0]?.tools.map((tool) => tool.name) ?? [];
  expect(offered).toEqual(expect.arrayContaining(["mcp__fixture__echo", "mcp__fixture__fail"]));
  expect(offered).not.toContain("mcp__fixture__slow");
  const results = events.flatMap((event) =>
    event.type === "entry.appended" && event.entry.body.kind === "tool_results"
      ? event.entry.body.results
      : [],
  );
  expect(results.map((result) => [result.callId, result.status])).toEqual([
    ["c1", "succeeded"],
    ["c2", "failed"],
  ]);
  expect(JSON.stringify(results[0]?.content)).toContain("echo: from the model");
  // The owner-declared read-only tool ran without asking; the external one asked once.
  expect(approvals).toEqual(["Call fail on MCP server fixture"]);
  expect(events.findLast((event) => event.type === "run.finished")).toMatchObject({
    outcome: { kind: "completed" },
  });
  const pid = Number(readFileSync(pidFile, "utf8"));
  await runtime.close();
  closed = true;
  await delay(50);
  expect(() => process.kill(pid, 0)).toThrow();
}, 30_000);
