import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ActionDigest,
  canonicalizeJson,
  type EffectClass,
  type ModelStreamEvent,
  type Plugin,
  type RuntimeEvent,
  type Scheduler,
  type SessionSnapshot,
  type ToolCallPart,
  type ToolDefinition,
  UNKNOWN_USAGE,
} from "../src/contracts/index.ts";
import { scriptedProvider } from "../src/plugins/provider-scripted/index.ts";
import { ReadOnlyPolicy } from "../src/policy/index.ts";
import { createRuntime, type Runtime, type RuntimeOptions } from "../src/runtime/index.ts";
import { SqliteSessionStore } from "../src/store/index.ts";

const disposables: { runtime: Runtime; store: SqliteSessionStore; directory: string }[] = [];
const done: Extract<ModelStreamEvent, { type: "completed" }> = {
  type: "completed",
  stopReason: "end_turn",
  providerStopReason: "stop",
  usage: UNKNOWN_USAGE,
};

function call(
  id = "call_1",
  name = "inspect",
  rawArguments = '{"path":"example.txt"}',
): ToolCallPart {
  return {
    type: "tool_call",
    callId: id,
    providerCallId: id,
    providerItemId: null,
    name,
    rawArguments,
    argumentsSource: "verbatim",
  } as ToolCallPart;
}

function toolTurn(...calls: ToolCallPart[]): readonly ModelStreamEvent[] {
  return [
    ...calls.map((part, index): ModelStreamEvent => ({ type: "part_completed", index, part })),
    { ...done, stopReason: "tool_use" },
  ];
}

function finalTurn(text = "Complete."): readonly ModelStreamEvent[] {
  return [
    { type: "text_delta", index: 0, text },
    { type: "part_completed", index: 0, part: { type: "text", text } },
    done,
  ];
}

function syntheticTool(kind: EffectClass = "read", name = "inspect"): ToolDefinition {
  return {
    name,
    description: "Synthetic tool without filesystem capabilities",
    inputSchema: {
      type: "object",
      required: ["path"],
      properties: { path: { type: "string" } },
      additionalProperties: false,
    },
    effect: { class: kind, reversibility: "none", verification: "none" },
    prepare: vi.fn(async (args) => ({
      digest: "untrusted-tool-claim" as ActionDigest,
      summary: "Inspect synthetic file",
      preconditions: [],
      payload: args,
    })),
    execute: vi.fn<ToolDefinition["execute"]>(async () => ({
      status: "succeeded",
      content: [{ type: "text", text: "Synthetic file contents" }],
    })),
  };
}

async function harness(
  responses: readonly (readonly ModelStreamEvent[])[],
  tools: readonly ToolDefinition[] = [syntheticTool()],
  options: Omit<RuntimeOptions, "plugins" | "model" | "store" | "dataDirectory"> = {},
  extras: readonly Plugin[] = [],
) {
  const directory = mkdtempSync(join(tmpdir(), "moyyi-runtime-core-"));
  const workspace = join(directory, "workspace");
  mkdirSync(workspace);
  const store = new SqliteSessionStore(join(directory, "store"));
  const scripted = scriptedProvider(responses);
  const events: RuntimeEvent[] = [];
  const deadlines = new Set<() => void>();
  const scheduler: Scheduler = {
    sleep: vi.fn(async () => {}),
    deadline: (_milliseconds, callback) => {
      deadlines.add(callback);
      return () => {
        deadlines.delete(callback);
      };
    },
  };
  const runtime = await createRuntime({
    ...options,
    store,
    model: { provider: "scripted", model: "scripted" },
    scheduler: options.scheduler ?? scheduler,
    plugins: [
      { plugin: scripted.plugin },
      {
        plugin: {
          name: "synthetic-tools",
          apiVersion: 1,
          setup: (host) => {
            for (const tool of tools) host.registerTool(tool);
          },
        },
      },
      ...extras.map((plugin) => ({ plugin })),
    ],
  });
  disposables.push({ runtime, store, directory });
  runtime.subscribe((event) => events.push(event));
  await runtime.send({ type: "session.create", workspaceRoot: workspace });
  const ready = events.find((event) => event.type === "session.ready");
  if (ready?.type !== "session.ready") throw Error("Session creation failed");
  const sessionId = ready.sessionId;
  return {
    directory,
    workspace,
    runtime,
    store,
    events,
    tools,
    client: scripted.client,
    scheduler,
    sessionId,
    // The run deadline is registered before any per-tool deadline.
    expire: () => deadlines.values().next().value?.(),
    async start() {
      await runtime.send({
        type: "run.start",
        sessionId,
        input: [{ type: "text", text: "Inspect this." }],
      });
      const started = events.findLast((event) => event.type === "run.started");
      if (started?.type !== "run.started") throw Error("Run did not start");
      return started.runId;
    },
    async snapshot(): Promise<SessionSnapshot> {
      const value = await store.loadSession(sessionId);
      if (!value) throw Error("Session vanished");
      return value;
    },
    async finish() {
      await runtime.idle();
      const finished = events.findLast((event) => event.type === "run.finished");
      if (finished?.type !== "run.finished") throw Error("Run did not finish");
      return finished.outcome;
    },
  };
}

function results(snapshot: SessionSnapshot) {
  return snapshot.entries.flatMap((entry) =>
    entry.body.kind === "tool_results" ? entry.body.results : [],
  );
}

async function approval(test: { events: readonly RuntimeEvent[] }, index = 0) {
  await vi.waitFor(() =>
    expect(
      test.events.filter((event) => event.type === "approval.requested").length,
    ).toBeGreaterThan(index),
  );
  const event = test.events.filter((event) => event.type === "approval.requested")[index];
  if (!event) throw Error("Approval missing");
  return event;
}

afterEach(async () => {
  for (const { runtime, store, directory } of disposables.splice(0)) {
    await runtime.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("model experience runtime integration", () => {
  it("resets repeat reminders when a new user message arrives during execution", async () => {
    const selected = syntheticTool();
    const secondStarted = Promise.withResolvers<void>();
    const continueSecond = Promise.withResolvers<void>();
    let count = 0;
    selected.execute = async () => {
      if (++count === 2) {
        secondStarted.resolve();
        await continueSecond.promise;
      }
      return { status: "succeeded", content: [{ type: "text", text: "Observed evidence" }] };
    };
    const test = await harness(
      [toolTurn(call("first")), toolTurn(call("second")), toolTurn(call("third")), finalTurn()],
      [selected],
    );
    const runId = await test.start();
    await secondStarted.promise;
    await test.runtime.send({
      type: "run.steer",
      runId,
      input: [{ type: "text", text: "Please inspect it again with my new requirement" }],
    });
    continueSecond.resolve();
    expect(await test.finish()).toEqual({ kind: "completed" });
    expect(count).toBe(3);
    const snapshot = await test.snapshot();
    expect(results(snapshot)).toHaveLength(3);
    expect(JSON.stringify(results(snapshot))).not.toContain("Runtime reminder");
    expect(JSON.stringify(test.client.requests[2]?.messages)).toContain("my new requirement");
  });

  it("records the third identical call's reminder even when parallel results finish in reverse order", async () => {
    const selected = syntheticTool();
    const finishes = Array.from({ length: 3 }, () => Promise.withResolvers<void>());
    let started = 0;
    selected.execute = async () => {
      const index = started++;
      await finishes[index]?.promise;
      return { status: "succeeded", content: [{ type: "text", text: `Evidence ${index + 1}` }] };
    };
    const test = await harness(
      [toolTurn(call("one"), call("two"), call("three")), finalTurn()],
      [selected],
      {
        limits: { maxParallelReads: 3, maxToolOutputBytes: 1024 },
      },
    );
    await test.start();
    await vi.waitFor(() => expect(started).toBe(3));
    for (const index of [2, 1, 0]) {
      finishes[index]?.resolve();
      await vi.waitFor(async () => expect(results(await test.snapshot())).toHaveLength(3 - index));
    }
    expect(await test.finish()).toEqual({ kind: "completed" });
    const snapshot = await test.snapshot();
    const observations = results(snapshot);
    expect(observations.map((result) => result.callId)).toEqual(["three", "two", "one"]);
    expect(
      observations
        .filter((result) => JSON.stringify(result).includes("Runtime reminder"))
        .map((result) => result.callId),
    ).toEqual(["three"]);
    const next = test.client.requests[1];
    for (const result of observations)
      expect(next?.messages.flatMap((message) => message.content)).toContainEqual(result);
    const final = snapshot.entries.findLast(
      (entry) => entry.body.kind === "assistant_message",
    )?.body;
    if (final?.kind !== "assistant_message") throw Error("Expected recorded request");
    const messages = await Promise.all(
      final.request.messages.map(async (blob) => {
        const bytes = await test.store.getBlob(blob);
        if (!bytes) throw Error("Missing recorded request");
        return JSON.parse(new TextDecoder().decode(bytes));
      }),
    );
    expect(messages).toEqual(next?.messages);
  });

  it("spills full evidence, retrieves a middle range through the real tool, and rejects a second session", async () => {
    const text = `HEAD ${"begin ".repeat(500)}MIDDLE-EVIDENCE${" end".repeat(500)} TAIL`;
    const handle = `tool-output:${createHash("sha256").update(text).digest("hex")}`;
    const argumentsJson = canonicalizeJson({
      handle,
      offset: Buffer.byteLength(text.slice(0, text.indexOf("MIDDLE"))),
      length: 15,
    });
    const selected = syntheticTool();
    selected.execute = async () => ({ status: "succeeded", content: [{ type: "text", text }] });
    const test = await harness(
      [
        toolTurn(call("spill")),
        toolTurn(call("retrieve", "read_tool_output", argumentsJson)),
        finalTurn(),
        toolTurn(call("foreign", "read_tool_output", argumentsJson)),
        finalTurn(),
      ],
      [selected],
      { limits: { maxToolOutputBytes: 512 } },
    );
    await test.start();
    expect(await test.finish()).toEqual({ kind: "completed" });
    const snapshot = await test.snapshot();
    const spill = snapshot.entries.find(
      (entry) => entry.body.kind === "tool_results" && entry.body.outputBlobs?.length,
    )?.body;
    if (spill?.kind !== "tool_results" || !spill.outputBlobs?.[0])
      throw Error("Expected persisted spill");
    const ref = spill.outputBlobs[0];
    expect(Buffer.from((await test.store.getBlob(ref.blob)) ?? []).toString("utf8")).toBe(text);
    expect(ref.bytes).toBe(Buffer.byteLength(text));
    expect(spill.results[0]?.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining("HEAD"),
    });
    expect(JSON.stringify(spill.results)).toContain("TAIL");
    expect(JSON.stringify(spill.results)).toContain(handle);
    const retrieval = results(snapshot).find((result) => result.callId === "retrieve");
    expect(retrieval?.status).toBe("succeeded");
    expect(JSON.stringify(retrieval)).toContain("MIDDLE-EVIDENCE");
    expect(JSON.stringify(test.client.requests[2]?.messages)).toContain("MIDDLE-EVIDENCE");
    expect(JSON.stringify(test.client.requests[1]?.messages)).not.toContain("MIDDLE-EVIDENCE");
    const effect = snapshot.effects.find((effect) => effect.callId === "spill");
    expect(effect?.state).toBe("succeeded");
    await test.runtime.send({ type: "session.create", workspaceRoot: test.workspace });
    const ready = test.events.findLast((event) => event.type === "session.ready");
    if (ready?.type !== "session.ready") throw Error("Expected second session");
    await test.runtime.send({
      type: "run.start",
      sessionId: ready.sessionId,
      input: [{ type: "text", text: "Try the guessed handle" }],
    });
    expect(await test.finish()).toEqual({ kind: "completed" });
    const other = await test.store.loadSession(ready.sessionId);
    if (!other) throw Error("Expected second session");
    expect(results(other)[0]).toMatchObject({
      status: "failed",
      content: [{ type: "text", text: expect.stringContaining("unavailable in this session") }],
    });
    expect(JSON.stringify(test.client.requests.at(-1)?.messages)).not.toContain("MIDDLE-EVIDENCE");
  });

  it("uses a persisted handle after closing and reopening both runtime and SQLite", async () => {
    const text = `REOPENED-EVIDENCE ${"recorded ".repeat(200)}`;
    const handle = `tool-output:${createHash("sha256").update(text).digest("hex")}`;
    const selected = syntheticTool();
    selected.execute = async () => ({ status: "succeeded", content: [{ type: "text", text }] });
    const test = await harness([toolTurn(call("spill")), finalTurn()], [selected], {
      limits: { maxToolOutputBytes: 512 },
    });
    await test.start();
    expect(await test.finish()).toEqual({ kind: "completed" });
    await test.runtime.close();
    test.store.close();
    const store = new SqliteSessionStore(join(test.directory, "store"));
    const scripted = scriptedProvider([
      toolTurn(
        call(
          "after-reopen",
          "read_tool_output",
          canonicalizeJson({ handle, offset: 0, length: 17 }),
        ),
      ),
      finalTurn(),
    ]);
    const runtime = await createRuntime({
      store,
      model: { provider: "scripted", model: "scripted" },
      plugins: [{ plugin: scripted.plugin }],
      limits: { maxToolOutputBytes: 512 },
    });
    const disposable = disposables.find((entry) => entry.runtime === test.runtime);
    if (!disposable) throw Error("Missing cleanup owner");
    disposable.runtime = runtime;
    disposable.store = store;
    await runtime.send({ type: "session.load", sessionId: test.sessionId });
    await runtime.send({
      type: "run.start",
      sessionId: test.sessionId,
      input: [{ type: "text", text: "Continue from the saved output" }],
    });
    await runtime.idle();
    const snapshot = await store.loadSession(test.sessionId);
    if (!snapshot) throw Error("Expected reopened session");
    expect(results(snapshot).find((result) => result.callId === "after-reopen")).toMatchObject({
      status: "succeeded",
    });
    expect(JSON.stringify(scripted.client.requests.at(-1)?.messages)).toContain(
      "REOPENED-EVIDENCE",
    );
  });

  it.each([false, true])(
    "runs todo_write through policy and records the list (denied=%s)",
    async (denied) => {
      const todos = [
        { content: "Inspect evidence", status: "completed" },
        { content: "Verify result", status: "in_progress" },
      ];
      const policy = new ReadOnlyPolicy({ requireApproval: denied ? ["todo_write"] : [] });
      const test = await harness(
        [toolTurn(call("todo", "todo_write", canonicalizeJson({ todos }))), finalTurn()],
        [],
        { policy },
      );
      await test.start();
      if (denied) {
        const asked = await approval(test);
        await test.runtime.send({
          type: "approval.respond",
          effectId: asked.effectId,
          digest: asked.digest,
          decision: "deny",
        });
      }
      expect(await test.finish()).toEqual({ kind: "completed" });
      const snapshot = await test.snapshot();
      const outcome = results(snapshot)[0];
      expect(outcome?.status).toBe(denied ? "denied" : "succeeded");
      expect(snapshot.effects[0]?.state).toBe(denied ? "denied" : "succeeded");
      if (!denied)
        expect(outcome?.content).toEqual([
          { type: "text", text: "Updated todo list: 0 pending, 1 in progress, 1 completed." },
        ]);
      else expect(JSON.stringify(outcome)).not.toContain("Updated todo list");
      expect(test.client.requests[0]?.tools.some((tool) => tool.name === "todo_write")).toBe(true);
      expect(
        test.client.requests[1]?.messages.flatMap((message) => message.content),
      ).toContainEqual(call("todo", "todo_write", canonicalizeJson({ todos })));
    },
  );

  it("records the fixed read deadline only after cooperative cleanup, then lets the model continue", async () => {
    let expireRead: (() => void) | undefined;
    const cleanup = Promise.withResolvers<void>();
    const cancelled = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const selected = syntheticTool();
    selected.execute = async (_action, context) => {
      context.signal.addEventListener("abort", () => cancelled.resolve(), { once: true });
      started.resolve();
      await cancelled.promise;
      await cleanup.promise;
      context.signal.throwIfAborted();
      throw Error("unreachable");
    };
    const scheduler: Scheduler = {
      sleep: async () => {},
      deadline(milliseconds, callback) {
        if (milliseconds === 37) expireRead = callback;
        return () => {};
      },
    };
    const test = await harness([toolTurn(call("slow")), finalTurn()], [selected], {
      scheduler,
      readToolTimeoutMs: 37,
    });
    await test.start();
    await started.promise;
    expect(expireRead).toBeDefined();
    expireRead?.();
    await cancelled.promise;
    expect(results(await test.snapshot())).toEqual([]);
    expect(test.client.requests).toHaveLength(1);
    cleanup.resolve();
    expect(await test.finish()).toEqual({ kind: "completed" });
    expect(results(await test.snapshot())[0]).toMatchObject({
      status: "failed",
      content: [{ type: "text", text: "tool call timed out after 37ms" }],
    });
    expect(JSON.stringify(test.client.requests[1]?.messages)).toContain(
      "tool call timed out after 37ms",
    );
  });
});

describe("runtime core with real SQLite persistence", () => {
  it.each(["provider", "context"])(
    "emits one usable run.finished event for a long emoji error from %s",
    async (source) => {
      const message = `a${String.fromCodePoint(0x1f600).repeat(600)}`;
      const extras: Plugin[] =
        source === "context"
          ? [
              {
                name: "failing-context",
                apiVersion: 1,
                setup(host) {
                  host.registerContextSource({
                    id: "failing",
                    async collect() {
                      throw Error(message);
                    },
                  });
                },
              },
            ]
          : [];
      const test = await harness([], undefined, {}, extras);
      if (source === "provider")
        test.client.stream = () => {
          throw Error(message);
        };
      await test.start();
      const outcome = await test.finish();
      expect(outcome.kind).toBe("failed");
      if (outcome.kind !== "failed") throw Error("Expected a failed outcome");
      expect(outcome.reason.isWellFormed()).toBe(true);
      expect(outcome.reason.length).toBeLessThanOrEqual(1024);
      const finished = test.events.filter((event) => event.type === "run.finished");
      expect(finished).toHaveLength(1);
      expect(() => canonicalizeJson(finished)).not.toThrow();
      expect((await test.snapshot()).runs[0]?.status).toBe("interrupted");
    },
  );

  it("persists the original completed call when a later event attempts to replace it", async () => {
    const selected = syntheticTool();
    const test = await harness(
      [
        [
          { type: "part_completed", index: 0, part: call() },
          { type: "part_completed", index: 0, part: call("late_replacement") },
          done,
        ],
      ],
      [selected],
    );
    await test.start();
    expect((await test.finish()).kind).toBe("failed");
    const snapshot = await test.snapshot();
    const assistant = snapshot.entries.find((entry) => entry.body.kind === "assistant_message");
    expect(assistant?.body).toMatchObject({ stopReason: "interrupted", content: [call()] });
    expect(results(snapshot).map((result) => [result.callId, result.status])).toEqual([
      ["call_1", "failed"],
    ]);
    expect(selected.execute).not.toHaveBeenCalled();
    expect(snapshot.effects).toEqual([]);
  });

  it("completes a model → tool → model turn and preserves the exact request blobs", async () => {
    const test = await harness([toolTurn(call()), finalTurn()]);
    await test.start();
    expect(await test.finish()).toEqual({ kind: "completed" });
    expect(test.tools[0]?.execute).toHaveBeenCalledTimes(1);
    expect(test.client.requests).toHaveLength(2);
    const snapshot = await test.snapshot();
    expect(results(snapshot).map((result) => [result.callId, result.status])).toEqual([
      ["call_1", "succeeded"],
    ]);
    expect(snapshot.effects.map((effect) => effect.state)).toEqual(["succeeded"]);
    expect(snapshot.runs[0]?.status).toBe("completed");
    expect(
      test.client.requests[1]?.messages.some((message) =>
        message.content.some((part) => part.type === "tool_result" && part.callId === "call_1"),
      ),
    ).toBe(true);
    const assistants = snapshot.entries.filter((entry) => entry.body.kind === "assistant_message");
    expect(assistants).toHaveLength(2);
    for (const entry of assistants) {
      if (entry.body.kind !== "assistant_message") continue;
      expect(await test.store.getBlob(entry.body.request.system)).not.toBeNull();
      expect(await test.store.getBlob(entry.body.request.tools)).not.toBeNull();
      for (const ref of entry.body.request.messages)
        expect(await test.store.getBlob(ref)).not.toBeNull();
    }
  });

  it("pairs schema-invalid arguments and unknown tools without preparing or executing", async () => {
    const selected = syntheticTool();
    const test = await harness(
      [
        toolTurn(call("invalid", "inspect", '{"path":42}'), call("missing", "not_registered")),
        finalTurn(),
      ],
      [selected],
    );
    await test.start();
    expect(await test.finish()).toEqual({ kind: "completed" });
    expect(selected.prepare).not.toHaveBeenCalled();
    expect(selected.execute).not.toHaveBeenCalled();
    const snapshot = await test.snapshot();
    expect(results(snapshot).map((result) => [result.callId, result.status])).toEqual([
      ["invalid", "failed"],
      ["missing", "failed"],
    ]);
    expect(snapshot.effects).toEqual([]);
  });

  it("rejects stale approval digests, then records the valid denial without execution", async () => {
    const selected = syntheticTool();
    const test = await harness([toolTurn(call()), finalTurn()], [selected], {
      policy: new ReadOnlyPolicy({ requireApproval: ["inspect"] }),
    });
    await test.start();
    const asked = await approval(test);
    expect(asked.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    await test.runtime.send({
      type: "approval.respond",
      effectId: asked.effectId,
      digest: "stale" as ActionDigest,
      decision: "approve",
    });
    expect(
      test.events.some(
        (event) => event.type === "command.rejected" && event.reason.includes("stale"),
      ),
    ).toBe(true);
    expect(selected.execute).not.toHaveBeenCalled();
    expect((await test.snapshot()).effects[0]?.state).toBe("awaiting_approval");
    await test.runtime.send({
      type: "approval.respond",
      effectId: asked.effectId,
      digest: asked.digest,
      decision: "deny",
    });
    await test.finish();
    expect(selected.execute).not.toHaveBeenCalled();
    expect(results(await test.snapshot())[0]?.status).toBe("denied");
    expect((await test.snapshot()).effects[0]?.state).toBe("denied");
  });

  it("requires a new digest and approval after preconditions change while approval is pending", async () => {
    const selected = syntheticTool();
    let prepared = 0;
    selected.prepare = vi.fn(async () => ({
      digest: "same-tool-claim" as ActionDigest,
      summary: "Inspect revision",
      preconditions: [],
      payload: { revision: ++prepared },
    }));
    const test = await harness([toolTurn(call()), finalTurn()], [selected], {
      policy: new ReadOnlyPolicy({ requireApproval: ["inspect"] }),
      preconditions: {
        check: vi
          .fn()
          .mockResolvedValueOnce({ valid: false, reason: "Changed" })
          .mockResolvedValue({ valid: true }),
      },
    });
    await test.start();
    const first = await approval(test);
    await test.runtime.send({
      type: "approval.respond",
      effectId: first.effectId,
      digest: first.digest,
      decision: "approve",
    });
    const second = await approval(test, 1);
    expect(second.effectId).toBe(first.effectId);
    expect(second.digest).not.toBe(first.digest);
    await test.runtime.send({
      type: "approval.respond",
      effectId: first.effectId,
      digest: first.digest,
      decision: "approve",
    });
    expect(selected.execute).not.toHaveBeenCalled();
    await test.runtime.send({
      type: "approval.respond",
      effectId: second.effectId,
      digest: second.digest,
      decision: "approve",
    });
    expect(await test.finish()).toEqual({ kind: "completed" });
    expect(selected.execute).toHaveBeenCalledTimes(1);
    expect((await test.snapshot()).effects[0]?.digest).toBe(second.digest);
  });

  it("rejects a formerly valid approval after permission revoke and regrant", async () => {
    const selected = syntheticTool();
    const policy = new ReadOnlyPolicy({ requireApproval: ["inspect"] });
    const test = await harness([toolTurn(call()), finalTurn()], [selected], { policy });
    await test.start();
    const asked = await approval(test);
    policy.revoke();
    policy.grant();
    await test.runtime.send({
      type: "approval.respond",
      effectId: asked.effectId,
      digest: asked.digest,
      decision: "approve",
    });
    await test.finish();
    expect(selected.execute).not.toHaveBeenCalled();
    expect(results(await test.snapshot())[0]?.status).toBe("cancelled");
    expect(
      test.events.some(
        (event) => event.type === "command.rejected" && event.reason.includes("revoked"),
      ),
    ).toBe(true);
  });

  it("retains partial streamed text and cancels every completed call when streaming is cancelled", async () => {
    const selected = syntheticTool();
    const test = await harness(
      [
        [
          { type: "part_completed", index: 0, part: call() },
          { type: "text_delta", index: 1, text: "Partial text" },
          {
            type: "part_completed",
            index: 1,
            part: { type: "text", text: "Partial text finished" },
          },
          { ...done, stopReason: "tool_use" },
        ],
      ],
      [selected],
    );
    test.runtime.subscribe((event) => {
      if (event.type === "assistant.delta")
        void test.runtime.send({ type: "run.cancel", runId: event.runId });
    });
    await test.start();
    expect(await test.finish()).toEqual({ kind: "cancelled" });
    const snapshot = await test.snapshot();
    const assistant = snapshot.entries.find((entry) => entry.body.kind === "assistant_message");
    expect(assistant?.body).toMatchObject({
      kind: "assistant_message",
      stopReason: "interrupted",
      content: [call(), { type: "text", text: "Partial text" }],
    });
    expect(results(snapshot).map((result) => [result.callId, result.status])).toEqual([
      ["call_1", "cancelled"],
    ]);
    expect(selected.execute).not.toHaveBeenCalled();
    expect(snapshot.effects).toEqual([]);
  });

  it("cancels an executing read and durably records its failed result", async () => {
    const selected = syntheticTool();
    selected.execute = vi.fn(async (_action, context) => {
      await new Promise<never>((_resolve, reject) =>
        context.signal.addEventListener("abort", () => reject(Error("Read interrupted")), {
          once: true,
        }),
      );
      throw Error("Unreachable");
    });
    const test = await harness([toolTurn(call())], [selected]);
    const runId = await test.start();
    await vi.waitFor(() => expect(selected.execute).toHaveBeenCalledTimes(1));
    await test.runtime.send({ type: "run.cancel", runId });
    expect(await test.finish()).toEqual({ kind: "cancelled" });
    const snapshot = await test.snapshot();
    expect(snapshot.effects[0]?.state).toBe("failed");
    expect(results(snapshot)[0]?.status).toBe("failed");
    expect(snapshot.runs[0]?.status).toBe("interrupted");
  });

  it("retries rate limiting only before partial output, preserving a retry notice", async () => {
    const error: ModelStreamEvent = {
      type: "error",
      error: {
        kind: "rate_limited",
        message: "Retry later",
        retryAfterMs: 37,
        partialOutput: false,
        usage: UNKNOWN_USAGE,
      },
    };
    const test = await harness([[error], finalTurn()]);
    await test.start();
    expect(await test.finish()).toEqual({ kind: "completed" });
    expect(test.client.requests).toHaveLength(2);
    expect(test.scheduler.sleep).toHaveBeenCalledWith(37, expect.any(AbortSignal));
    expect(
      (await test.snapshot()).entries.some(
        (entry) => entry.body.kind === "notice" && entry.body.code === "model_retry",
      ),
    ).toBe(true);
  });

  it("retains usage and the exact request for a failed attempt before retrying", async () => {
    const usage = { ...UNKNOWN_USAGE, status: "partial" as const, inputTokens: 17 };
    const test = await harness([
      [
        {
          type: "error",
          error: { kind: "network", message: "Connection lost", partialOutput: false, usage },
        },
      ],
      finalTurn(),
    ]);
    await test.start();
    expect(await test.finish()).toEqual({ kind: "completed" });
    const assistants = (await test.snapshot()).entries.filter(
      (entry) => entry.body.kind === "assistant_message",
    );
    expect(assistants).toHaveLength(2);
    const attempt = assistants[0]?.body;
    if (attempt?.kind !== "assistant_message") throw Error("Missing failed attempt");
    expect(attempt).toMatchObject({ stopReason: "interrupted", content: [], usage });
    const decode = async (ref: typeof attempt.request.system) => {
      const bytes = await test.store.getBlob(ref);
      if (!bytes) throw Error("Missing request blob");
      return JSON.parse(new TextDecoder().decode(bytes));
    };
    expect(await decode(attempt.request.system)).toEqual({
      origin: test.client.requests[0]?.origin,
      maxOutputTokens: test.client.requests[0]?.maxOutputTokens,
      content: test.client.requests[0]?.system,
    });
    expect(await Promise.all(attempt.request.messages.map(decode))).toEqual(
      test.client.requests[0]?.messages,
    );
    expect(
      test.client.requests[1]?.messages.some(
        (message) => message.role === "assistant" && message.content.length === 0,
      ),
    ).toBe(false);
    expect(JSON.stringify(test.client.requests[1]?.messages)).toContain(
      "previous model request was interrupted without recorded content",
    );
  });

  it("does not retry rate limiting after visible partial output", async () => {
    const test = await harness([
      [
        { type: "text_delta", index: 0, text: "Already visible" },
        {
          type: "error",
          error: {
            kind: "rate_limited",
            message: "Partial failure",
            partialOutput: true,
            usage: UNKNOWN_USAGE,
          },
        },
      ],
      finalTurn("Must remain unused"),
    ]);
    await test.start();
    expect((await test.finish()).kind).toBe("failed");
    expect(test.client.requests).toHaveLength(1);
    expect(test.scheduler.sleep).not.toHaveBeenCalled();
    const assistant = (await test.snapshot()).entries.find(
      (entry) => entry.body.kind === "assistant_message",
    );
    expect(assistant?.body).toMatchObject({
      stopReason: "interrupted",
      content: [{ type: "text", text: "Already visible" }],
    });
  });

  it("honors a provider partial-output declaration even when no delta was delivered", async () => {
    const test = await harness([
      [
        {
          type: "error",
          error: {
            kind: "rate_limited",
            message: "Output existed upstream",
            partialOutput: true,
            usage: UNKNOWN_USAGE,
          },
        },
      ],
      finalTurn("Must remain unused"),
    ]);
    await test.start();
    expect((await test.finish()).kind).toBe("failed");
    expect(test.client.requests).toHaveLength(1);
    expect(test.client.remaining).toBe(1);
    expect(test.scheduler.sleep).not.toHaveBeenCalled();
    const snapshot = await test.snapshot();
    expect(
      snapshot.entries.some(
        (entry) =>
          entry.body.kind === "assistant_message" && entry.body.stopReason === "interrupted",
      ),
    ).toBe(true);
  });

  it("reports cancellation during retry backoff without making another model request", async () => {
    const scheduler: Scheduler = {
      deadline: () => () => {},
      sleep: vi.fn(async (_milliseconds, signal) => {
        if (signal.aborted) throw new DOMException("Aborted", "AbortError");
        await new Promise<never>((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          ),
        );
      }),
    };
    const test = await harness(
      [
        [
          {
            type: "error",
            error: {
              kind: "rate_limited",
              message: "Try later",
              partialOutput: false,
              usage: UNKNOWN_USAGE,
            },
          },
        ],
        finalTurn("Must remain unused"),
      ],
      undefined,
      { scheduler },
    );
    test.runtime.subscribe((event) => {
      if (
        event.type === "entry.appended" &&
        event.entry.body.kind === "notice" &&
        event.entry.body.code === "model_retry" &&
        event.entry.runId
      ) {
        void test.runtime.send({ type: "run.cancel", runId: event.entry.runId });
      }
    });
    await test.start();
    expect(await test.finish()).toEqual({ kind: "cancelled" });
    expect(test.client.requests).toHaveLength(1);
    expect(test.client.remaining).toBe(1);
    expect((await test.snapshot()).runs[0]?.status).toBe("interrupted");
  });

  it.each(["tool_use", "max_tokens"] as const)(
    "never executes a final-attempt tool (%s)",
    async (stopReason) => {
      const selected = syntheticTool();
      const test = await harness(
        [
          [
            { type: "part_completed", index: 0, part: call() },
            { ...done, stopReason },
          ],
          finalTurn(),
        ],
        [selected],
        {
          limits: { maxModelRequests: 1 },
        },
      );
      await test.start();
      expect(await test.finish()).toEqual({
        kind: "budget_exhausted",
        budget: stopReason === "max_tokens" ? "model_output_tokens" : "model_requests",
      });
      expect(test.client.requests).toHaveLength(1);
      const snapshot = await test.snapshot();
      expect(results(snapshot)[0]?.status).toBe("denied");
      expect(selected.prepare).not.toHaveBeenCalled();
      expect(selected.execute).not.toHaveBeenCalled();
      expect(snapshot.effects).toHaveLength(0);
      expect(test.client.requests[0]?.toolChoice).toBe("none");
      expect(test.events.some((event) => event.type === "approval.requested")).toBe(false);
      expect(snapshot.runs[0]?.status).toBe("interrupted");
    },
  );

  it("counts down, preserves evidence and records the reserved final request exactly", async () => {
    const selected = syntheticTool();
    const test = await harness(
      [
        toolTurn(call("first")),
        toolTurn(call("second")),
        finalTurn("Verified two reads; no tests run."),
      ],
      [selected],
      { limits: { maxModelRequests: 3 } },
    );
    await test.start();
    expect(await test.finish()).toEqual({ kind: "completed" });
    expect(test.client.requests).toHaveLength(3);
    expect(selected.execute).toHaveBeenCalledTimes(2);
    const snapshot = await test.snapshot();
    const notices = snapshot.entries.filter(
      (entry) => entry.body.kind === "notice" && entry.body.code === "model_request_budget",
    );
    expect(notices).toHaveLength(3);
    for (const [index, request] of test.client.requests.entries()) {
      expect(JSON.stringify(request.messages.at(-1))).toContain(
        `attempt ${index + 1} of 3; ${3 - index} request(s) remaining including this one`,
      );
      expect(JSON.stringify(request.messages.at(-1))).toContain(
        `${2 - index} tool-enabled request(s) remain before the answer-only final request`,
      );
      expect(request.toolChoice).toBe(index === 2 ? "none" : undefined);
      expect(request.tools.some((tool) => tool.name === "inspect")).toBe(true);
      expect(request.system).toEqual(test.client.requests[0]?.system);
    }
    expect(JSON.stringify(test.client.requests[0]?.messages.at(-1))).not.toContain(
      "This is the last tool-enabled request",
    );
    const lastToolRequest = JSON.stringify(test.client.requests[1]?.messages.at(-1));
    expect(lastToolRequest).toContain("This is the last tool-enabled request");
    expect(lastToolRequest).toContain("artifact creation and verification in this tool batch");
    expect(lastToolRequest).toContain("A proposed artifact in chat is not a created file");
    expect(JSON.stringify(test.client.requests[2]?.messages)).toContain("Synthetic file contents");
    const final = snapshot.entries.findLast((entry) => entry.body.kind === "assistant_message");
    if (final?.body.kind !== "assistant_message") throw Error("Missing final answer");
    const recorded = await test.store.getBlob(final.body.request.system);
    if (!recorded) throw Error("Missing final request blob");
    expect(final.body.request.rendererVersion).toBe("moyyi-core-v2");
    expect(JSON.parse(new TextDecoder().decode(recorded))).toEqual({
      origin: test.client.requests[2]?.origin,
      maxOutputTokens: test.client.requests[2]?.maxOutputTokens,
      content: test.client.requests[2]?.system,
      toolChoice: "none",
    });
  });

  it("can answer with a one-request budget without granting a tool opportunity", async () => {
    const test = await harness(
      [finalTurn("Not enough evidence to verify this claim.")],
      undefined,
      {
        limits: { maxModelRequests: 1 },
      },
    );
    await test.start();
    expect(await test.finish()).toEqual({ kind: "completed" });
    expect(test.client.requests).toHaveLength(1);
    expect(test.client.requests[0]?.toolChoice).toBe("none");
    expect(JSON.stringify(test.client.requests[0]?.messages.at(-1))).toContain(
      "0 tool-enabled request(s) remain before the answer-only final request",
    );
    expect(JSON.stringify(test.client.requests[0]?.messages)).toContain("what remains");
    expect((await test.snapshot()).effects).toHaveLength(0);
  });

  it.each([
    { label: "empty", text: "", stopReason: "end_turn" as const },
    { label: "whitespace", text: "  ", stopReason: "end_turn" as const },
    { label: "truncated", text: "Unfinished answer", stopReason: "max_tokens" as const },
    { label: "unknown stop", text: "Unproven answer", stopReason: "other" as const },
  ])("does not report a $label final response as completed", async ({ text, stopReason }) => {
    const test = await harness(
      [
        [
          { type: "part_completed", index: 0, part: { type: "text", text } },
          { ...done, stopReason },
        ],
      ],
      undefined,
      { limits: { maxModelRequests: 1 } },
    );
    await test.start();
    expect(await test.finish()).toEqual({
      kind: "budget_exhausted",
      budget: stopReason === "max_tokens" ? "model_output_tokens" : "model_requests",
    });
    expect(test.client.requests).toHaveLength(1);
  });

  it.each([
    { label: "empty", text: "", stopReason: "end_turn" as const },
    { label: "whitespace", text: " \n\t", stopReason: "end_turn" as const },
    { label: "reasoning-only", text: "Unfinished reasoning", stopReason: "end_turn" as const },
    {
      label: "reasoning-only-final",
      text: "Unfinished reasoning",
      stopReason: "max_tokens" as const,
    },
    { label: "truncated", text: "Unfinished answer", stopReason: "max_tokens" as const },
    { label: "unknown stop", text: "Unproven answer", stopReason: "other" as const },
    { label: "interrupted stop", text: "Partial answer", stopReason: "interrupted" as const },
  ])("does not report a $label response as completed", async ({ label, text, stopReason }) => {
    const usage = {
      status: "final" as const,
      inputTokens: 17,
      outputTokens: 9,
      cacheReadTokens: 3,
      cacheWriteTokens: null,
      reasoningTokens: label.startsWith("reasoning-only") ? 9 : 0,
    };
    const part = label.startsWith("reasoning-only")
      ? { type: "reasoning" as const, kind: "visible" as const, text }
      : { type: "text" as const, text };
    const providerStopReason = { status: stopReason, source: "synthetic-terminal" };
    const selected = syntheticTool();
    const test = await harness(
      [
        [
          { type: "part_completed", index: 0, part },
          { ...done, stopReason, providerStopReason, usage },
        ],
        finalTurn("Must remain unused"),
      ],
      [selected],
      { limits: { maxModelRequests: label === "reasoning-only-final" ? 1 : 3, maxRetries: 2 } },
    );
    await test.start();
    expect(await test.finish()).toEqual(
      stopReason === "max_tokens"
        ? { kind: "budget_exhausted", budget: "model_output_tokens" }
        : {
            kind: "failed",
            reason:
              stopReason === "end_turn"
                ? "Model response contained no answer text"
                : `Model response did not complete (stop reason: ${stopReason})`,
          },
    );
    expect(test.client.requests).toHaveLength(1);
    expect(test.client.requests[0]?.toolChoice).toBe(
      label === "reasoning-only-final" ? "none" : undefined,
    );
    expect(test.client.remaining).toBe(1);
    expect(test.scheduler.sleep).not.toHaveBeenCalled();
    expect(selected.prepare).not.toHaveBeenCalled();
    expect(selected.execute).not.toHaveBeenCalled();
    const snapshot = await test.snapshot();
    expect(snapshot.runs[0]?.status).toBe("interrupted");
    expect(snapshot.effects).toEqual([]);
    expect(results(snapshot)).toEqual([]);
    const assistant = snapshot.entries.filter((entry) => entry.body.kind === "assistant_message");
    expect(assistant).toHaveLength(1);
    expect(assistant[0]?.body).toMatchObject({
      content: [part],
      stopReason,
      providerStopReason,
      usage,
    });
    expect(
      snapshot.entries.some(
        (entry) => entry.body.kind === "notice" && entry.body.code === "model_retry",
      ),
    ).toBe(false);
  });

  it("fails a pre-final end_turn with proposed calls without executing them", async () => {
    const selected = syntheticTool();
    const proposed = call();
    const test = await harness(
      [
        [
          { type: "part_completed", index: 0, part: proposed },
          { type: "part_completed", index: 1, part: { type: "text", text: "Claimed complete" } },
          done,
        ],
        finalTurn("Must remain unused"),
      ],
      [selected],
      { limits: { maxModelRequests: 3 } },
    );
    await test.start();
    expect(await test.finish()).toEqual({
      kind: "failed",
      reason: "Model response ended without completing its tool calls",
    });
    expect(test.client.requests).toHaveLength(1);
    expect(test.client.remaining).toBe(1);
    expect(selected.prepare).not.toHaveBeenCalled();
    expect(selected.execute).not.toHaveBeenCalled();
    const snapshot = await test.snapshot();
    expect(snapshot.runs[0]?.status).toBe("interrupted");
    expect(snapshot.effects).toEqual([]);
    expect(results(snapshot)).toMatchObject([{ callId: proposed.callId, status: "failed" }]);
    expect(
      snapshot.entries.find((entry) => entry.body.kind === "assistant_message")?.body,
    ).toMatchObject({
      content: [proposed, { type: "text", text: "Claimed complete" }],
      stopReason: "end_turn",
    });
  });

  it("accepts an explicit final refusal without manufacturing task success evidence", async () => {
    const test = await harness(
      [
        [
          {
            type: "part_completed",
            index: 0,
            part: { type: "refusal", text: "I cannot verify that." },
          },
          { ...done, stopReason: "refusal" },
        ],
      ],
      undefined,
      { limits: { maxModelRequests: 1 } },
    );
    await test.start();
    expect(await test.finish()).toEqual({ kind: "completed" });
    expect((await test.snapshot()).effects).toHaveLength(0);
  });

  it("accepts a nonblank pre-final refusal without consuming another request", async () => {
    const test = await harness(
      [
        [
          {
            type: "part_completed",
            index: 0,
            part: { type: "refusal", text: "I cannot do that." },
          },
          { ...done, stopReason: "refusal" },
        ],
        finalTurn("Must remain unused"),
      ],
      undefined,
      { limits: { maxModelRequests: 3 } },
    );
    await test.start();
    expect(await test.finish()).toEqual({ kind: "completed" });
    expect(test.client.requests).toHaveLength(1);
    expect(test.client.remaining).toBe(1);
    const snapshot = await test.snapshot();
    expect(snapshot.runs[0]?.status).toBe("completed");
    expect(snapshot.effects).toEqual([]);
    expect(results(snapshot)).toEqual([]);
  });

  it("counts a transient failure before closeout and never retries a final failure", async () => {
    const failure: ModelStreamEvent = {
      type: "error",
      error: {
        kind: "network",
        message: "Unavailable",
        partialOutput: false,
        usage: UNKNOWN_USAGE,
      },
    };
    const test = await harness([[failure], [failure], finalTurn("Never requested")], undefined, {
      limits: { maxModelRequests: 2, maxRetries: 5 },
    });
    await test.start();
    expect(await test.finish()).toEqual({ kind: "failed", reason: "Unavailable" });
    expect(test.client.requests).toHaveLength(2);
    expect(JSON.stringify(test.client.requests[0]?.messages.at(-1))).toContain(
      "1 tool-enabled request(s) remain before the answer-only final request",
    );
    expect(JSON.stringify(test.client.requests[0]?.messages.at(-1))).toContain(
      "This is the last tool-enabled request",
    );
    expect(test.client.requests[1]?.toolChoice).toBe("none");
    expect(JSON.stringify(test.client.requests[1]?.messages.at(-1))).toContain(
      "attempt 2 of 2; 1 request(s)",
    );
    expect(JSON.stringify(test.client.requests[1]?.messages.at(-1))).toContain(
      "0 tool-enabled request(s) remain before the answer-only final request",
    );
    expect(test.scheduler.sleep).toHaveBeenCalledTimes(1);
    expect(test.client.remaining).toBe(1);
  });

  it("honors cancellation during the final request without a replacement answer request", async () => {
    const test = await harness([finalTurn(), finalTurn("Never requested")], undefined, {
      limits: { maxModelRequests: 1 },
    });
    test.runtime.subscribe((event) => {
      if (event.type === "assistant.delta")
        void test.runtime.send({ type: "run.cancel", runId: event.runId });
    });
    await test.start();
    expect(await test.finish()).toEqual({ kind: "cancelled" });
    expect(test.client.requests).toHaveLength(1);
    expect((await test.snapshot()).effects).toHaveLength(0);
  });

  it("expires its time budget during execution using an injected deterministic deadline", async () => {
    const selected = syntheticTool();
    selected.execute = vi.fn(async (_action, context) => {
      await new Promise<never>((_resolve, reject) =>
        context.signal.addEventListener("abort", () => reject(Error("Deadline")), { once: true }),
      );
      throw Error("Unreachable");
    });
    const test = await harness([toolTurn(call())], [selected]);
    await test.start();
    await vi.waitFor(() => expect(selected.execute).toHaveBeenCalledTimes(1));
    test.expire();
    expect(await test.finish()).toEqual({ kind: "budget_exhausted", budget: "time" });
    expect(results(await test.snapshot())[0]?.status).toBe("failed");
  });

  it("includes steering received during approval in the following model request", async () => {
    const test = await harness([toolTurn(call()), finalTurn()], undefined, {
      policy: new ReadOnlyPolicy({ requireApproval: ["inspect"] }),
    });
    const runId = await test.start();
    const asked = await approval(test);
    await test.runtime.send({
      type: "run.steer",
      runId,
      input: [{ type: "text", text: "Also consider the new constraint." }],
    });
    await test.runtime.send({
      type: "approval.respond",
      effectId: asked.effectId,
      digest: asked.digest,
      decision: "approve",
    });
    expect(await test.finish()).toEqual({ kind: "completed" });
    expect(
      test.client.requests[1]?.messages.some((message) =>
        message.content.some(
          (part) => part.type === "text" && part.text === "Also consider the new constraint.",
        ),
      ),
    ).toBe(true);
    expect(
      (await test.snapshot()).entries.some(
        (entry) => entry.body.kind === "user_message" && entry.body.steering,
      ),
    ).toBe(true);
  });

  it("continues after an end-turn response when steering was accepted during that response", async () => {
    const test = await harness([finalTurn("First response."), finalTurn("Steering handled.")]);
    const unblock = Promise.withResolvers<void>();
    const delta = Promise.withResolvers<void>();
    const original = test.client.stream.bind(test.client);
    let first = true;
    test.client.stream = async function* (request, signal) {
      const blocked = first;
      first = false;
      for await (const event of original(request, signal)) {
        if (blocked && event.type === "part_completed") await unblock.promise;
        yield event;
      }
    };
    test.runtime.subscribe((event) => {
      if (event.type === "assistant.delta") delta.resolve();
    });
    const runId = await test.start();
    try {
      await delta.promise;
      await test.runtime.send({
        type: "run.steer",
        runId,
        input: [{ type: "text", text: "Please address this newly supplied requirement." }],
      });
      expect(
        test.events.some(
          (event) => event.type === "command.rejected" && event.command === "run.steer",
        ),
      ).toBe(false);
      expect(
        (await test.snapshot()).entries.some(
          (entry) => entry.body.kind === "user_message" && entry.body.steering,
        ),
      ).toBe(true);
      unblock.resolve();
      expect(await test.finish()).toEqual({ kind: "completed" });
      expect(test.client.requests).toHaveLength(2);
      expect(
        test.client.requests[1]?.messages.some((message) =>
          message.content.some(
            (part) =>
              part.type === "text" &&
              part.text === "Please address this newly supplied requirement.",
          ),
        ),
      ).toBe(true);
    } finally {
      unblock.resolve();
    }
  });

  it("retains accepted steering but does not continue after a truncated response", async () => {
    const selected = syntheticTool();
    const text = "Only the start of an answer.";
    const steering = "Please address this newly supplied requirement.";
    const test = await harness(
      [
        [
          { type: "text_delta", index: 0, text },
          { type: "part_completed", index: 0, part: { type: "text", text } },
          { ...done, stopReason: "max_tokens" },
        ],
        finalTurn("Must remain unused"),
      ],
      [selected],
      { limits: { maxModelRequests: 3 } },
    );
    const unblock = Promise.withResolvers<void>();
    const delta = Promise.withResolvers<void>();
    const original = test.client.stream.bind(test.client);
    test.client.stream = async function* (request, signal) {
      for await (const event of original(request, signal)) {
        if (event.type === "part_completed") await unblock.promise;
        yield event;
      }
    };
    test.runtime.subscribe((event) => {
      if (event.type === "assistant.delta") delta.resolve();
    });
    const runId = await test.start();
    try {
      await delta.promise;
      await test.runtime.send({
        type: "run.steer",
        runId,
        input: [{ type: "text", text: steering }],
      });
      expect(test.events.some((event) => event.type === "command.rejected")).toBe(false);
      unblock.resolve();
      expect(await test.finish()).toEqual({
        kind: "budget_exhausted",
        budget: "model_output_tokens",
      });
      expect(test.client.requests).toHaveLength(1);
      expect(test.client.remaining).toBe(1);
      expect(selected.prepare).not.toHaveBeenCalled();
      expect(selected.execute).not.toHaveBeenCalled();
      const snapshot = await test.snapshot();
      expect(snapshot.runs[0]?.status).toBe("interrupted");
      expect(snapshot.effects).toEqual([]);
      expect(
        snapshot.entries
          .filter((entry) => entry.body.kind === "user_message")
          .map((entry) => entry.body),
      ).toMatchObject([
        { content: [{ type: "text", text: "Inspect this." }], steering: false },
        { content: [{ type: "text", text: steering }], steering: true },
      ]);
      expect(
        snapshot.entries.find((entry) => entry.body.kind === "assistant_message")?.body,
      ).toMatchObject({ content: [{ type: "text", text }], stopReason: "max_tokens" });
    } finally {
      unblock.resolve();
    }
  });

  it("makes concurrent close calls wait for the same pending plugin cleanup without a model", async () => {
    const cleanupStarted = Promise.withResolvers<void>();
    const releaseCleanup = Promise.withResolvers<void>();
    const cleanup = vi.fn(async () => {
      cleanupStarted.resolve();
      await releaseCleanup.promise;
    });
    const runtime = await createRuntime({
      plugins: [
        {
          plugin: {
            name: "blocking-cleanup",
            apiVersion: 1,
            setup(host) {
              host.onDispose(cleanup);
            },
          },
        },
      ],
    });
    const finished: number[] = [];
    const first = runtime.close().then(() => finished.push(1));
    const second = runtime.close().then(() => finished.push(2));
    try {
      await cleanupStarted.promise;
      await Promise.resolve();
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(finished).toEqual([]);
      releaseCleanup.resolve();
      await Promise.all([first, second]);
      expect(finished.sort()).toEqual([1, 2]);
      expect(cleanup).toHaveBeenCalledTimes(1);
    } finally {
      releaseCleanup.resolve();
      await Promise.all([first, second]);
    }
  });

  it.each(["workspace_write", "process", "external"] as const)(
    "default policy denies %s before preparation",
    async (kind) => {
      const selected = syntheticTool(kind);
      const test = await harness([toolTurn(call()), finalTurn()], [selected]);
      await test.start();
      expect(await test.finish()).toEqual({ kind: "completed" });
      expect(selected.prepare).not.toHaveBeenCalled();
      expect(selected.execute).not.toHaveBeenCalled();
      expect(results(await test.snapshot())[0]?.status).toBe("denied");
    },
  );

  it.each(["deny", "allow", "throw"])(
    "plugin policy %s can never widen the runtime grant",
    async (decision) => {
      const selected = syntheticTool();
      const plugin: Plugin = {
        name: "restrictive-policy",
        apiVersion: 1,
        setup(host) {
          host.registerPolicyRule({
            id: "rule",
            evaluate: () => {
              if (decision === "throw") throw Error("Rule failed");
              if (decision === "deny") return { kind: "deny", reason: "Restricted" };
              return { kind: "allow" } as never;
            },
          });
        },
      };
      const test = await harness([toolTurn(call()), finalTurn()], [selected], {}, [plugin]);
      await test.start();
      await test.finish();
      expect(selected.prepare).not.toHaveBeenCalled();
      expect(selected.execute).not.toHaveBeenCalled();
      expect(results(await test.snapshot())[0]?.status).toBe("denied");
    },
  );

  it("isolates throwing and mutating observers from the approved action and stored transcript", async () => {
    const selected = syntheticTool();
    const plugin: Plugin = {
      name: "unreliable-observer",
      apiVersion: 1,
      setup(host) {
        host.onEvent((event) => {
          if (event.type === "approval.requested") Object.assign(event, { digest: "forged" });
          if (event.type === "entry.appended") Object.assign(event.entry.body, { kind: "forged" });
          throw Error("Observer failure");
        });
      },
    };
    const test = await harness(
      [toolTurn(call()), finalTurn()],
      [selected],
      { policy: new ReadOnlyPolicy({ requireApproval: ["inspect"] }) },
      [plugin],
    );
    test.runtime.subscribe(() => {
      throw Error("Client observer failure");
    });
    await test.start();
    const asked = await approval(test);
    expect(asked.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    await test.runtime.send({
      type: "approval.respond",
      effectId: asked.effectId,
      digest: asked.digest,
      decision: "approve",
    });
    expect(await test.finish()).toEqual({ kind: "completed" });
    expect(selected.execute).toHaveBeenCalledTimes(1);
    expect((await test.snapshot()).effects[0]?.digest).toBe(asked.digest);
    expect(test.runtime.diagnostics.some((message) => message.includes("observer failed"))).toBe(
      true,
    );
    expect(test.runtime.diagnostics).toContain("Event listener threw");
    expect(test.client.requests).toHaveLength(2);
  });
});
