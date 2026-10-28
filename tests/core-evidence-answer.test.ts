import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContextCapacityError, MinimalContextBuilder } from "../src/context/index.ts";
import {
  type ActionDigest,
  canonicalizeJson,
  type ModelRequest,
  type ModelStreamEvent,
  type RunId,
  type RuntimeEvent,
  type SessionSnapshot,
  type Timestamp,
  type ToolCallPart,
  type ToolDefinition,
  UNKNOWN_USAGE,
} from "../src/contracts/index.ts";
import { AgentCore } from "../src/core/index.ts";
import { scriptedProfile } from "../src/plugins/provider-scripted/index.ts";
import { AjvArgumentValidator } from "../src/runtime/validation.ts";
import { SqliteSessionStore } from "../src/store/index.ts";

const cleanups: (() => Promise<void>)[] = [];
const complete: Extract<ModelStreamEvent, { type: "completed" }> = {
  type: "completed",
  stopReason: "end_turn",
  providerStopReason: "stop",
  usage: UNKNOWN_USAGE,
};
const input = "Explain the source behavior and its limits from the evidence.";
const draft = "Investigation draft, not the fresh answer.";
const answer = "Synthetic final response; this fixture does not establish semantic correctness.";

function textTurn(text = answer): ModelStreamEvent[] {
  return [
    { type: "text_delta", index: 0, text },
    { type: "part_completed", index: 0, part: { type: "text", text } },
    complete,
  ];
}

function call(id: string): ToolCallPart {
  return {
    type: "tool_call",
    callId: id,
    providerCallId: id,
    providerItemId: null,
    name: "inspect",
    rawArguments: '{ "path": "example.ts" }',
    argumentsSource: "verbatim",
  } as ToolCallPart;
}

function toolTurn(id = "call_1"): ModelStreamEvent[] {
  return [
    { type: "part_completed", index: 0, part: call(id) },
    { ...complete, stopReason: "tool_use" },
  ];
}

function networkError(partialOutput = false): ModelStreamEvent {
  return {
    type: "error",
    error: {
      kind: "network",
      message: "Synthetic transport failure",
      partialOutput,
      usage: UNKNOWN_USAGE,
    },
  };
}

interface Step {
  readonly events: readonly ModelStreamEvent[];
  readonly elapsedMs?: number;
  readonly waitForAbort?: boolean;
}

async function harness(
  steps: readonly Step[],
  options: { enabled?: boolean | undefined; maxRequests?: number; maxRetries?: number } = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "moyyi-core-evidence-answer-"));
  const workspace = join(directory, "workspace");
  mkdirSync(workspace);
  const store = new SqliteSessionStore(join(directory, "store"));
  const context = new MinimalContextBuilder();
  const fresh = vi.spyOn(context, "buildEvidenceAnswer");
  const ordinary = vi.spyOn(context, "build");
  const events: RuntimeEvent[] = [];
  const requests: ModelRequest[] = [];
  const signals: AbortSignal[] = [];
  let serial = 0;
  let now = Date.parse("2026-10-28T00:00:00Z");
  const timers = new Map<() => void, number>();
  const advance = (milliseconds: number) => {
    now += milliseconds;
    for (const [callback, due] of timers) {
      if (due > now) continue;
      timers.delete(callback);
      callback();
    }
  };
  const deadline = vi.fn((milliseconds: number, callback: () => void) => {
    timers.set(callback, now + milliseconds);
    return () => {
      timers.delete(callback);
    };
  });
  const sleep = vi.fn(async (milliseconds: number, signal: AbortSignal) => {
    signal.throwIfAborted();
    advance(milliseconds);
    signal.throwIfAborted();
  });
  const selected: ToolDefinition = {
    name: "inspect",
    description: "Deterministic read observation without filesystem authority",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
    effect: { class: "read", reversibility: "none", verification: "none" },
    prepare: vi.fn(async (args) => ({
      digest: "untrusted" as ActionDigest,
      summary: "Read fixture",
      preconditions: [],
      payload: args,
    })),
    execute: vi.fn<ToolDefinition["execute"]>(async () => ({
      status: "succeeded",
      content: [
        { type: "text", text: "Original observation: configuration is captured at construction." },
      ],
    })),
  };
  const core = new AgentCore({
    model: {
      async *stream(request, signal) {
        const step = steps[requests.length];
        requests.push(request);
        signals.push(signal);
        if (!step) throw Error("Unexpected additional model request");
        advance(step.elapsedMs ?? 0);
        for (const event of step.events) {
          if (signal.aborted) break;
          await Promise.resolve();
          yield event;
        }
        if (step.waitForAbort && !signal.aborted)
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true }),
          );
        if (signal.aborted)
          yield {
            type: "error",
            error: {
              kind: "cancelled",
              message: "Cancelled fixture",
              partialOutput: true,
              usage: UNKNOWN_USAGE,
            },
          };
      },
    },
    profile: { ...scriptedProfile, maxOutputTokens: 8192 },
    tools: [selected],
    store,
    context,
    policy: { beforePrepare: () => ({ kind: "allow" }), beforeExecute: () => ({ kind: "allow" }) },
    validator: new AjvArgumentValidator(),
    preconditions: { check: async () => ({ valid: true }) },
    hasher: {
      digest: (value) =>
        `sha256:${createHash("sha256").update(canonicalizeJson(value)).digest("hex")}` as ActionDigest,
    },
    scheduler: { deadline, sleep },
    clock: { now: () => new Date(now).toISOString() as Timestamp },
    ids: { next: (prefix) => `${prefix}_${++serial}` },
    emit: (event) => events.push(event),
    limits: {
      maxModelRequests: options.maxRequests ?? 8,
      timeoutMs: 300_000,
      maxRetries: options.maxRetries ?? 0,
    },
    ...("enabled" in options
      ? options.enabled === undefined
        ? {}
        : { evidenceAnswer: options.enabled }
      : { evidenceAnswer: true }),
  });
  cleanups.push(async () => {
    await core.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  });
  await core.send({ type: "session.create", workspaceRoot: workspace });
  const ready = events.find((event) => event.type === "session.ready");
  if (ready?.type !== "session.ready") throw Error("Missing session");
  const sessionId = ready.sessionId;
  return {
    core,
    store,
    context,
    fresh,
    ordinary,
    events,
    requests,
    signals,
    selected,
    deadline,
    sleep,
    advance,
    sessionId,
    async start() {
      await core.send({ type: "run.start", sessionId, input: [{ type: "text", text: input }] });
      const started = events.findLast((event) => event.type === "run.started");
      if (started?.type !== "run.started") throw Error("Missing run");
      return started.runId;
    },
    async finish() {
      await core.idle();
      const finished = events.findLast((event) => event.type === "run.finished");
      if (finished?.type !== "run.finished") throw Error("Missing outcome");
      return finished.outcome;
    },
    async snapshot() {
      const snapshot = await store.loadSession(sessionId);
      if (!snapshot) throw Error("Missing stored session");
      return snapshot;
    },
  };
}

function assistants(snapshot: SessionSnapshot) {
  return snapshot.entries.flatMap((entry) =>
    entry.body.kind === "assistant_message" ? [entry.body] : [],
  );
}

function results(snapshot: SessionSnapshot) {
  return snapshot.entries.flatMap((entry) =>
    entry.body.kind === "tool_results" ? entry.body.results : [],
  );
}

async function waitForRequests(test: Awaited<ReturnType<typeof harness>>, count: number) {
  await vi.waitFor(() => expect(test.requests).toHaveLength(count));
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

describe("bounded evidence answer through the real core and SQLite", () => {
  it.each([false, undefined])(
    "keeps ordinary completion unchanged when enabled=%s",
    async (enabled) => {
      const test = await harness([{ events: textTurn(draft) }], { enabled });
      await test.start();
      expect(await test.finish()).toEqual({ kind: "completed" });
      expect(test.requests).toHaveLength(1);
      expect(test.fresh).not.toHaveBeenCalled();
      expect(assistants(await test.snapshot())[0]?.request.rendererVersion).toBe("moyyi-core-v2");
    },
  );

  it("turns an early complete draft into one fresh answer and records the actual requests", async () => {
    const reasoning = "Private investigation reasoning must not seed the answer.";
    const test = await harness([
      { events: toolTurn() },
      {
        events: [
          {
            type: "part_completed",
            index: 1,
            part: { type: "reasoning", kind: "visible", text: reasoning },
          },
          ...textTurn(draft),
        ],
      },
      { events: textTurn() },
    ]);
    await test.start();
    expect(await test.finish()).toEqual({ kind: "completed" });
    expect(test.requests).toHaveLength(3);
    expect(test.fresh).toHaveBeenCalledTimes(1);
    const freshRequest = test.requests[2];
    expect(freshRequest).toMatchObject({ tools: [], toolChoice: "none", maxOutputTokens: 8192 });
    const serialized = canonicalizeJson(freshRequest);
    expect(serialized).toContain(input);
    expect(serialized).toContain("Original observation:");
    expect(serialized).not.toContain(draft);
    expect(serialized).not.toContain(reasoning);
    const snapshot = await test.snapshot();
    const recorded = assistants(snapshot);
    expect(recorded.map((body) => body.request.rendererVersion)).toEqual([
      "moyyi-core-v2",
      "moyyi-core-v2",
      "moyyi-evidence-answer-v1",
    ]);
    expect(recorded[1]?.content).toContainEqual({ type: "text", text: draft });
    expect(results(snapshot)).toHaveLength(1);
    const ref = recorded[2]?.request.messages[0];
    if (!ref) throw Error("Missing request blob reference");
    const blob = await test.store.getBlob(ref);
    if (!blob) throw Error("Missing request blob");
    expect(JSON.parse(new TextDecoder().decode(blob))).toEqual(freshRequest?.messages[0]);
    expect(test.deadline).toHaveBeenCalledTimes(1);
    expect(test.deadline).toHaveBeenCalledWith(300_000, expect.any(Function));
  });

  it.each([149_999, 150_000])(
    "switches only at the safe half-time boundary (%i ms)",
    async (elapsedMs) => {
      const test = await harness([
        { events: toolTurn(), elapsedMs },
        { events: textTurn(draft) },
        { events: textTurn() },
      ]);
      await test.start();
      expect(await test.finish()).toEqual({ kind: "completed" });
      expect(test.requests).toHaveLength(elapsedMs < 150_000 ? 3 : 2);
      expect(test.requests[1]?.toolChoice).toBe(elapsedMs < 150_000 ? undefined : "none");
      expect(test.fresh).toHaveBeenCalledTimes(1);
    },
  );

  it("uses request eight for the fresh answer and never creates a ninth allowance", async () => {
    const test = await harness([
      ...Array.from({ length: 7 }, (_, i) => ({ events: toolTurn(`call_${i + 1}`) })),
      { events: textTurn() },
    ]);
    await test.start();
    expect(await test.finish()).toEqual({ kind: "completed" });
    expect(test.requests).toHaveLength(8);
    expect(test.selected.execute).toHaveBeenCalledTimes(7);
    expect(test.fresh).toHaveBeenCalledTimes(1);
    expect(test.requests[7]?.toolChoice).toBe("none");
    expect(results(await test.snapshot())).toHaveLength(7);
  });

  it("denies a final-stage tool violation without prepare, execution, or a follow-up", async () => {
    const test = await harness([{ events: textTurn(draft) }, { events: toolTurn("forbidden") }]);
    await test.start();
    expect((await test.finish()).kind).toBe("budget_exhausted");
    expect(test.requests).toHaveLength(2);
    expect(test.selected.prepare).not.toHaveBeenCalled();
    expect(test.selected.execute).not.toHaveBeenCalled();
    const snapshot = await test.snapshot();
    expect(snapshot.effects).toEqual([]);
    expect(results(snapshot)).toMatchObject([{ callId: "forbidden", status: "denied" }]);
  });

  it.each(["refusal", "end_turn"] as const)(
    "preserves refusal content with %s without synthesizing another answer",
    async (stopReason) => {
      const test = await harness([
        {
          events: [
            {
              type: "part_completed",
              index: 0,
              part: { type: "refusal", text: "Cannot perform this task." },
            },
            { ...complete, stopReason },
          ],
        },
      ]);
      await test.start();
      await test.finish();
      expect(test.requests).toHaveLength(1);
      expect(test.fresh).not.toHaveBeenCalled();
      expect(assistants(await test.snapshot())[0]?.content).toContainEqual({
        type: "refusal",
        text: "Cannot perform this task.",
      });
    },
  );

  it("retains a refusal from the fresh answer without another attempt", async () => {
    const test = await harness([
      { events: textTurn(draft) },
      {
        events: [
          {
            type: "part_completed",
            index: 0,
            part: { type: "refusal", text: "Cannot give this answer." },
          },
          { ...complete, stopReason: "refusal" },
        ],
      },
    ]);
    await test.start();
    await test.finish();
    expect(test.requests).toHaveLength(2);
    expect(assistants(await test.snapshot())[1]?.stopReason).toBe("refusal");
  });

  it.each([
    { name: "transport error", events: [networkError()], expected: "failed" },
    {
      name: "partial transport error",
      events: [{ type: "text_delta", index: 0, text: "partial" }, networkError(true)],
      expected: "failed",
    },
    {
      name: "output truncation",
      events: [...textTurn("partial").slice(0, -1), { ...complete, stopReason: "max_tokens" }],
      expected: "budget_exhausted",
    },
    { name: "empty end turn", events: [complete], expected: "failed" },
  ] satisfies { name: string; events: ModelStreamEvent[]; expected: string }[])(
    "does not turn investigation $name into a fresh continuation",
    async ({ events, expected }) => {
      const test = await harness([{ events }]);
      await test.start();
      expect((await test.finish()).kind).toBe(expected);
      expect(test.requests).toHaveLength(1);
      expect(test.fresh).not.toHaveBeenCalled();
    },
  );

  it("never retries a failed fresh answer even when ordinary retries are permitted", async () => {
    const test = await harness([{ events: textTurn(draft) }, { events: [networkError()] }], {
      maxRetries: 2,
    });
    await test.start();
    expect((await test.finish()).kind).toBe("failed");
    expect(test.requests).toHaveLength(2);
    expect(test.sleep).not.toHaveBeenCalled();
    expect(assistants(await test.snapshot())[1]?.stopReason).toBe("interrupted");
  });

  it("does not retry or synthesize after a half-time error despite the host retry allowance", async () => {
    const test = await harness(
      [{ events: [networkError()], elapsedMs: 150_000 }, { events: [networkError()] }],
      { maxRetries: 1 },
    );
    await test.start();
    expect((await test.finish()).kind).toBe("failed");
    expect(test.requests).toHaveLength(1);
    expect(test.sleep).not.toHaveBeenCalled();
    expect(test.fresh).not.toHaveBeenCalled();
  });

  it("keeps the fresh answer's output limit as the failure cause", async () => {
    const test = await harness([
      { events: textTurn(draft) },
      {
        events: [
          ...textTurn("Partial final text").slice(0, -1),
          { ...complete, stopReason: "max_tokens" },
        ],
      },
    ]);
    await test.start();
    expect(await test.finish()).toEqual({
      kind: "budget_exhausted",
      budget: "model_output_tokens",
    });
    expect(test.requests).toHaveLength(2);
    expect(assistants(await test.snapshot())[1]?.content).toContainEqual({
      type: "text",
      text: "Partial final text",
    });
  });

  it.each([false, true])(
    "cancels during %s fresh stage without a continuation",
    async (freshStage) => {
      const test = await harness([
        ...(freshStage ? [{ events: textTurn(draft) }] : []),
        {
          events: [{ type: "text_delta", index: 0, text: "Partial received text" }],
          waitForAbort: true,
        },
      ]);
      const runId = await test.start();
      await waitForRequests(test, freshStage ? 2 : 1);
      await test.core.send({ type: "run.cancel", runId });
      expect(await test.finish()).toEqual({ kind: "cancelled" });
      expect(test.requests).toHaveLength(freshStage ? 2 : 1);
      expect(test.signals.every((signal) => signal.aborted)).toBe(true);
      expect(assistants(await test.snapshot()).at(-1)?.stopReason).toBe("interrupted");
    },
  );

  it("does not renew the shared deadline for the fresh answer", async () => {
    const test = await harness([
      { events: toolTurn(), elapsedMs: 150_000 },
      {
        events: [{ type: "text_delta", index: 0, text: "Late partial answer" }],
        waitForAbort: true,
      },
    ]);
    await test.start();
    await waitForRequests(test, 2);
    test.advance(150_000);
    expect(await test.finish()).toEqual({ kind: "budget_exhausted", budget: "time" });
    expect(test.requests).toHaveLength(2);
    expect(test.deadline).toHaveBeenCalledTimes(1);
    expect(assistants(await test.snapshot()).at(-1)?.stopReason).toBe("interrupted");
  });

  it("cannot recover a slow investigation by spending another request after deadline", async () => {
    const test = await harness([{ events: toolTurn(), elapsedMs: 300_000 }]);
    await test.start();
    expect(await test.finish()).toEqual({ kind: "budget_exhausted", budget: "time" });
    expect(test.requests).toHaveLength(1);
    expect(test.fresh).not.toHaveBeenCalled();
    expect(test.selected.execute).not.toHaveBeenCalled();
  });

  it("rejects steering without appending a new user instruction", async () => {
    const test = await harness([{ events: [], waitForAbort: true }]);
    const runId: RunId = await test.start();
    await waitForRequests(test, 1);
    await test.core.send({
      type: "run.steer",
      runId,
      input: [{ type: "text", text: "New direction" }],
    });
    expect(test.events).toContainEqual(
      expect.objectContaining({ type: "command.rejected", command: "run.steer" }),
    );
    expect(
      (await test.snapshot()).entries.filter((entry) => entry.body.kind === "user_message"),
    ).toHaveLength(1);
    await test.core.send({ type: "run.cancel", runId });
    await test.finish();
    expect(test.requests).toHaveLength(1);
  });

  it("rejects an existing conversation before writing history or invoking a model", async () => {
    const test = await harness([{ events: textTurn(draft) }, { events: textTurn() }]);
    await test.start();
    await test.finish();
    const before = await test.snapshot();
    await test.core.send({
      type: "run.start",
      sessionId: test.sessionId,
      input: [{ type: "text", text: "Continue" }],
    });
    await test.core.idle();
    expect(test.events).toContainEqual(
      expect.objectContaining({ type: "command.rejected", command: "run.start" }),
    );
    expect(await test.snapshot()).toEqual(before);
    expect(test.requests).toHaveLength(2);
  });

  it("fails before another model call if the evidence projection exceeds capacity", async () => {
    const test = await harness([{ events: textTurn(draft) }]);
    test.fresh.mockImplementation(() => {
      throw new ContextCapacityError(200_001, 200_000);
    });
    await test.start();
    expect(await test.finish()).toMatchObject({
      kind: "failed",
      reason: expect.stringContaining("Context capacity exceeded"),
    });
    expect(test.requests).toHaveLength(1);
    expect(assistants(await test.snapshot())).toHaveLength(1);
  });
});
