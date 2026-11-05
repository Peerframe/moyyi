import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  type ModelStreamEvent,
  type RuntimeEvent,
  type SessionId,
  type ToolCallId,
  UNKNOWN_USAGE,
} from "../src/contracts/index.ts";
import { scriptedProfile, scriptedProvider } from "../src/plugins/provider-scripted/index.ts";
import { configureCliHost } from "../src/runtime/cli-host.ts";
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

it("starts, reads and stops a background command through the real runtime", async () => {
  const root = mkdtempSync(join(tmpdir(), "moyyi-rbg-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "w");
  mkdirSync(workspace);
  const responses = [
    call("c1", "shell", { command: "printf ready; sleep 30", background: true }),
    call("c2", "shell_output", { handle: "bg_1" }),
    done,
    call("c3", "shell_stop", { handle: "bg_1" }),
    done,
  ];
  const options = await configureCliHost(
    { model: scriptedProfile.origin, plugins: [{ plugin: scriptedProvider(responses).plugin }] },
    { workspaceRoot: workspace, allowShell: true },
    false,
  );
  const runtime = await createRuntime({ ...options, dataDirectory: join(root, "d") });
  cleanups.push(() => runtime.close());
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
  const results = () =>
    events.flatMap((event) =>
      event.type === "entry.appended" && event.entry.body.kind === "tool_results"
        ? event.entry.body.results.map((result) => ({
            callId: result.callId,
            status: result.status,
            text: result.content.map((part) => ("text" in part ? part.text : "")).join(""),
          }))
        : [],
    );
  const turn = async () => {
    await runtime.send({ type: "run.start", sessionId, input: [{ type: "text", text: "Go" }] });
    await runtime.idle();
  };
  await turn();
  const [started, output] = results();
  expect(started).toMatchObject({ callId: "c1", status: "succeeded" });
  expect(started?.text).toContain('"handle":"bg_1"');
  expect(output).toMatchObject({ callId: "c2", status: "succeeded" });
  expect(output?.text).toContain('"state":"running"');
  // Starting asks like any command; reading output is a read and does not.
  expect(approvals).toHaveLength(1);
  expect(approvals[0]).toContain("Start background command");
  await turn();
  const stopped = results().find((result) => result.callId === "c3");
  expect(stopped?.status).toBe("succeeded");
  expect(stopped?.text).toContain('"state":"stopped"');
  expect(approvals).toHaveLength(2);
}, 30_000);
