import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import type { RuntimeEvent, SessionId } from "../src/contracts/index.ts";
import { configureCliHost, createCliRuntime } from "../src/runtime/cli-host.ts";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "moyyi-always-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "w");
  mkdirSync(workspace);
  writeFileSync(join(workspace, "README.md"), "Fixture.\n");
  const runtime = await createCliRuntime({
    demo: true,
    dataDirectory: join(root, "d"),
    approveReads: true,
    launch: { workspaceRoot: workspace },
  });
  cleanups.push(() => runtime.close());
  const events: RuntimeEvent[] = [];
  runtime.subscribe((event) => events.push(event));
  await runtime.send({ type: "session.create", workspaceRoot: workspace });
  const ready = events.find((event) => event.type === "session.ready");
  const sessionId = (ready as { sessionId: SessionId }).sessionId;
  const turn = async (
    respond?: (approval: Extract<RuntimeEvent, { type: "approval.requested" }>) => Promise<void>,
  ) => {
    const start = events.length;
    await runtime.send({ type: "run.start", sessionId, input: [{ type: "text", text: "Read" }] });
    for (;;) {
      const recent = events.slice(start);
      const finished = recent.find((event) => event.type === "run.finished");
      if (finished?.type === "run.finished") return { recent, outcome: finished.outcome };
      const approval = recent.find((event) => event.type === "approval.requested");
      if (approval?.type === "approval.requested" && respond) {
        const answer = respond;
        respond = undefined;
        await answer(approval);
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  };
  return { runtime, events, sessionId, turn };
}

it("stops asking for the same tool after /always, until the session is loaded again", async () => {
  const f = await fixture();
  const first = await f.turn((approval) =>
    f.runtime.send({
      type: "approval.respond",
      effectId: approval.effectId,
      digest: approval.digest,
      decision: "approve",
      scope: "session",
    }),
  );
  expect(first.outcome).toEqual({ kind: "completed" });
  const second = await f.turn();
  expect(second.outcome).toEqual({ kind: "completed" });
  expect(second.recent.some((event) => event.type === "approval.requested")).toBe(false);
  expect(
    second.recent.some(
      (event) => event.type === "effect.updated" && event.effect.state === "succeeded",
    ),
  ).toBe(true);
  await f.runtime.send({ type: "session.load", sessionId: f.sessionId });
  const third = await f.turn((approval) =>
    f.runtime.send({
      type: "approval.respond",
      effectId: approval.effectId,
      digest: approval.digest,
      decision: "deny",
    }),
  );
  expect(third.recent.some((event) => event.type === "approval.requested")).toBe(true);
  expect(
    third.recent.some(
      (event) => event.type === "effect.updated" && event.effect.state === "denied",
    ),
  ).toBe(true);
});

it("only remembers approvals, and a stale digest remembers nothing", async () => {
  const f = await fixture();
  const first = await f.turn(async (approval) => {
    await f.runtime.send({
      type: "approval.respond",
      effectId: approval.effectId,
      digest: approval.digest,
      decision: "deny",
      scope: "session",
    });
    await f.runtime.send({
      type: "approval.respond",
      effectId: approval.effectId,
      digest: "sha256:stale" as never,
      decision: "approve",
      scope: "session",
    });
    await f.runtime.send({
      type: "approval.respond",
      effectId: approval.effectId,
      digest: approval.digest,
      decision: "approve",
    });
  });
  const rejected = first.recent.filter((event) => event.type === "command.rejected");
  expect(rejected.map((event) => (event as { reason: string }).reason)).toEqual([
    "Only an approval can be remembered for the session",
    "Unknown or stale approval digest",
  ]);
  const second = await f.turn((approval) =>
    f.runtime.send({
      type: "approval.respond",
      effectId: approval.effectId,
      digest: approval.digest,
      decision: "approve",
    }),
  );
  expect(second.recent.some((event) => event.type === "approval.requested")).toBe(true);
});

it("maps the long-task and writable-command launch options onto runtime options", async () => {
  const root = mkdtempSync(join(tmpdir(), "moyyi-launch-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const configured = await configureCliHost(
    { model: { provider: "scripted", model: "scripted" } },
    {
      workspaceRoot: root,
      allowShellWrite: true,
      maxRequests: 200,
      timeoutSeconds: 3600,
      autoCompact: true,
    },
    false,
  );
  expect(configured.workspaceProcesses).toMatchObject({
    workspaceAccess: "read-write",
    approval: "ask",
  });
  expect(configured.limits).toEqual({ maxModelRequests: 200, timeoutMs: 3_600_000 });
  expect(configured.autoCompact).toBe(true);
  const readOnly = await configureCliHost(
    { model: { provider: "scripted", model: "scripted" } },
    { workspaceRoot: root, allowShell: true },
    false,
  );
  expect(readOnly.workspaceProcesses).toMatchObject({ workspaceAccess: "read-only" });
  await expect(
    configureCliHost(
      { model: { provider: "s", model: "m" } },
      { workspaceRoot: root, timeoutSeconds: 5 },
      false,
    ),
  ).rejects.toThrow("10 to 86400");
});

it("lets an approved command change the workspace only with --allow-shell-write", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  const { createRuntime } = await import("../src/runtime/index.ts");
  const { scriptedProfile, scriptedProvider } = await import(
    "../src/plugins/provider-scripted/index.ts"
  );
  const { UNKNOWN_USAGE } = await import("../src/contracts/index.ts");
  const call = (id: string) =>
    [
      {
        type: "part_completed",
        index: 0,
        part: {
          type: "tool_call",
          callId: id,
          providerCallId: id,
          providerItemId: null,
          name: "shell",
          rawArguments: JSON.stringify({ command: "printf ok > out.txt" }),
          argumentsSource: "verbatim",
        },
      },
      { type: "completed", stopReason: "tool_use", providerStopReason: null, usage: UNKNOWN_USAGE },
    ] as const;
  const done = [
    { type: "part_completed", index: 0, part: { type: "text", text: "Done." } },
    { type: "completed", stopReason: "end_turn", providerStopReason: null, usage: UNKNOWN_USAGE },
  ] as const;
  for (const write of [false, true]) {
    const root = mkdtempSync(join(tmpdir(), "moyyi-shell-write-"));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const workspace = join(root, "w");
    mkdirSync(workspace);
    const options = await configureCliHost(
      {
        model: scriptedProfile.origin,
        plugins: [{ plugin: scriptedProvider([call(`call_${write}`), done] as never).plugin }],
      },
      { workspaceRoot: workspace, ...(write ? { allowShellWrite: true } : { allowShell: true }) },
      false,
    );
    const runtime = await createRuntime({ ...options, dataDirectory: join(root, "d") });
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
    const ready = events.find((event) => event.type === "session.ready") as {
      sessionId: SessionId;
    };
    await runtime.send({
      type: "run.start",
      sessionId: ready.sessionId,
      input: [{ type: "text", text: "Write a file" }],
    });
    await runtime.idle();
    expect(existsSync(join(workspace, "out.txt"))).toBe(write);
    if (write) expect(readFileSync(join(workspace, "out.txt"), "utf8")).toBe("ok");
    expect(events.some((event) => event.type === "approval.requested")).toBe(true);
  }
}, 20_000);
