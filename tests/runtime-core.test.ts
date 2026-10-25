import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ActionDigest,
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
  let deadline: (() => void) | undefined;
  const scheduler: Scheduler = {
    sleep: vi.fn(async () => {}),
    deadline: (_milliseconds, callback) => {
      deadline = callback;
      return () => {
        deadline = undefined;
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
    runtime,
    store,
    events,
    tools,
    client: scripted.client,
    scheduler,
    sessionId,
    expire: () => deadline?.(),
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

describe("runtime core with real SQLite persistence", () => {
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

  it("stops at the model request budget after pairing the completed tool action", async () => {
    const test = await harness([toolTurn(call()), finalTurn()], undefined, {
      limits: { maxModelRequests: 1 },
    });
    await test.start();
    expect(await test.finish()).toEqual({ kind: "budget_exhausted", budget: "model_requests" });
    expect(test.client.requests).toHaveLength(1);
    const snapshot = await test.snapshot();
    expect(results(snapshot)[0]?.status).toBe("succeeded");
    expect(snapshot.runs[0]?.status).toBe("interrupted");
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
