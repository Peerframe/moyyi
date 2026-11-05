import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

it("denies changes before approval in plan mode, allows reads, and restores normal approval", async () => {
  const root = mkdtempSync(join(tmpdir(), "moyyi-plan-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "w");
  mkdirSync(workspace);
  writeFileSync(join(workspace, "README.md"), "Plan fixture.\n");
  const create = { path: "PLAN.md", text: "# Plan\n" };
  const options = await configureCliHost(
    {
      model: scriptedProfile.origin,
      plugins: [
        {
          plugin: scriptedProvider([
            call("r1", "read", { path: "README.md" }),
            call("w1", "create", create),
            done,
            call("w2", "create", create),
            done,
          ]).plugin,
        },
      ],
    },
    { workspaceRoot: workspace, allowWrite: true },
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
  await runtime.send({ type: "session.mode", sessionId, mode: "plan" });
  await runtime.send({ type: "run.start", sessionId, input: [{ type: "text", text: "Plan" }] });
  await runtime.idle();
  const states = () =>
    events.flatMap((event) =>
      event.type === "effect.updated" && ["succeeded", "denied"].includes(event.effect.state)
        ? [[event.effect.tool, event.effect.state]]
        : [],
    );
  expect(states()).toEqual([
    ["read", "succeeded"],
    ["create", "denied"],
  ]);
  expect(approvals).toEqual([]);
  expect(existsSync(join(workspace, "PLAN.md"))).toBe(false);
  expect(JSON.stringify(events)).toContain("Plan mode: changes, commands and external calls");
  await runtime.send({ type: "session.mode", sessionId, mode: "default" });
  await runtime.send({ type: "run.start", sessionId, input: [{ type: "text", text: "Do it" }] });
  await runtime.idle();
  expect(approvals).toHaveLength(1);
  expect(existsSync(join(workspace, "PLAN.md"))).toBe(true);
});
