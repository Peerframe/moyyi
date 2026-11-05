import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  type ModelStreamEvent,
  type RuntimeEvent,
  type SessionId,
  type ToolCallId,
  UNKNOWN_USAGE,
} from "../src/contracts/index.ts";
import { scriptedProfile, scriptedProvider } from "../src/plugins/provider-scripted/index.ts";
import { ReadOnlyPolicy } from "../src/policy/index.ts";
import type { HookConfig } from "../src/runtime/hooks.ts";
import { createRuntime } from "../src/runtime/index.ts";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
const recorder = resolve("tests/fixtures/hook-recorder.mjs");
const responses = (): ModelStreamEvent[][] => [
  [
    {
      type: "part_completed",
      index: 0,
      part: {
        type: "tool_call",
        callId: "c1" as ToolCallId,
        providerCallId: "c1",
        providerItemId: null,
        name: "read",
        rawArguments: '{"path":"README.md"}',
        argumentsSource: "verbatim",
      },
    },
    { type: "completed", stopReason: "tool_use", providerStopReason: null, usage: UNKNOWN_USAGE },
  ],
  [
    { type: "part_completed", index: 0, part: { type: "text", text: "Done." } },
    { type: "completed", stopReason: "end_turn", providerStopReason: null, usage: UNKNOWN_USAGE },
  ],
];

async function until(check: () => boolean, ms = 8000) {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw Error("Timed out waiting for hooks");
    await new Promise((done) => setTimeout(done, 20));
  }
}

async function run(hooks: (out: string) => HookConfig[], approveReads = false) {
  const root = mkdtempSync(join(tmpdir(), "moyyi-hooks-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "w");
  mkdirSync(workspace);
  writeFileSync(join(workspace, "README.md"), "Hook fixture.\n");
  const out = join(root, "hooks.jsonl");
  const runtime = await createRuntime({
    model: scriptedProfile.origin,
    dataDirectory: join(root, "d"),
    plugins: [{ plugin: scriptedProvider(responses()).plugin }],
    hooks: hooks(out),
    ...(approveReads ? { policy: new ReadOnlyPolicy({ requireApproval: ["read"] }) } : {}),
  });
  cleanups.push(() => runtime.close());
  const events: RuntimeEvent[] = [];
  runtime.subscribe((event) => {
    events.push(event);
    if (event.type === "approval.requested")
      void runtime.send({
        type: "approval.respond",
        effectId: event.effectId,
        digest: event.digest,
        decision: "approve",
      });
  });
  await runtime.send({ type: "session.create", workspaceRoot: workspace });
  const { sessionId } = events.find((event) => event.type === "session.ready") as {
    sessionId: SessionId;
  };
  await runtime.send({ type: "run.start", sessionId, input: [{ type: "text", text: "Go" }] });
  await runtime.idle();
  const lines = () =>
    existsSync(out)
      ? readFileSync(out, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
  return { runtime, events, sessionId, lines };
}

const hook = (on: HookConfig["on"], out: string, extra: Partial<HookConfig> = {}): HookConfig => ({
  on,
  command: process.execPath,
  args: [recorder],
  env: { HOOK_OUT: out },
  ...extra,
});

it("notifies owner hooks of approvals, finished tools and finished runs", async () => {
  const t = await run(
    (out) => [
      hook("approval.requested", out),
      hook("tool.finished", out, { tools: ["read"] }),
      hook("run.finished", out),
      hook("tool.finished", out, { tools: ["shell"] }),
    ],
    true,
  );
  await until(() => t.lines().length >= 3);
  const lines = t.lines();
  expect(lines.map((line) => line.event).sort()).toEqual([
    "approval.requested",
    "run.finished",
    "tool.finished",
  ]);
  expect(lines.find((line) => line.event === "tool.finished")).toMatchObject({
    tool: "read",
    state: "succeeded",
    sessionId: t.sessionId,
  });
  expect(lines.find((line) => line.event === "run.finished")).toMatchObject({
    sessionId: t.sessionId,
    outcome: { kind: "completed" },
  });
  expect(lines.find((line) => line.event === "approval.requested")?.summary).toBeTruthy();
  // The run itself is unaffected by hooks.
  expect(t.events.findLast((event) => event.type === "run.finished")).toMatchObject({
    outcome: { kind: "completed" },
  });
});

it("reports failing and hanging hooks as diagnostics without failing the run", async () => {
  const t = await run((out) => [
    hook("run.finished", out, { env: { HOOK_OUT: out, HOOK_MODE: "fail" } }),
    hook("tool.finished", out, { env: { HOOK_OUT: out, HOOK_MODE: "sleep" }, timeoutMs: 1000 }),
  ]);
  expect(t.events.findLast((event) => event.type === "run.finished")).toMatchObject({
    outcome: { kind: "completed" },
  });
  await until(() => t.runtime.diagnostics.length >= 2);
  expect(t.runtime.diagnostics).toEqual(
    expect.arrayContaining([
      "hooks | run.finished hook exited 3: hook failed on purpose",
      "hooks | tool.finished hook timed out",
    ]),
  );
}, 20_000);

it("rejects invalid hook configuration when the runtime is created", async () => {
  for (const hooks of [
    [{ on: "tool.started", command: "x" }],
    [{ on: "run.finished", command: "" }],
    [{ on: "run.finished", command: "x", cwd: "relative" }],
    [{ on: "run.finished", command: "x", timeoutMs: 10 }],
    [{ on: "run.finished", command: "x", tools: ["read"] }],
  ] as unknown as HookConfig[][])
    await expect(
      createRuntime({ model: scriptedProfile.origin, hooks, plugins: [] }),
    ).rejects.toThrow(/[Hh]ook/u);
});
