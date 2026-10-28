import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MinimalContextBuilder } from "../src/context/index.ts";
import {
  type ActionDigest,
  type ContextBuilder,
  type ContextInput,
  canonicalizeJson,
  type ModelStreamEvent,
  type RuntimeEvent,
  type SessionId,
  type SessionSnapshot,
  type Timestamp,
  type ToolCallPart,
  type ToolDefinition,
  UNKNOWN_USAGE,
} from "../src/contracts/index.ts";
import { AgentCore, type CoreDeps } from "../src/core/index.ts";
import { ScriptedModelClient, scriptedProfile } from "../src/plugins/provider-scripted/index.ts";
import { SqliteSessionStore } from "../src/store/index.ts";

const disposables: { directory: string; store: SqliteSessionStore; core?: AgentCore }[] = [];
const done: Extract<ModelStreamEvent, { type: "completed" }> = {
  type: "completed",
  stopReason: "end_turn",
  providerStopReason: "stop",
  usage: UNKNOWN_USAGE,
};

function answer(
  text = "Answer.",
  stopReason: Extract<ModelStreamEvent, { type: "completed" }>["stopReason"] = "end_turn",
): readonly ModelStreamEvent[] {
  return [
    { type: "text_delta", index: 0, text },
    { type: "part_completed", index: 0, part: { type: "text", text } },
    { ...done, stopReason },
  ];
}

function call(id: string): ToolCallPart {
  return {
    type: "tool_call",
    callId: id as ToolCallPart["callId"],
    providerCallId: id,
    providerItemId: null,
    name: "inspect",
    rawArguments: "{}",
    argumentsSource: "verbatim",
  };
}

function read(id: string): readonly ModelStreamEvent[] {
  return [
    { type: "part_completed", index: 0, part: call(id) },
    { ...done, stopReason: "tool_use" },
  ];
}

function reviewContext() {
  const builder = new MinimalContextBuilder();
  return {
    build: (input: ContextInput) => builder.build(input),
    buildAnswerReview: vi.fn((input: ContextInput, _stage: "evidence" | "answer") => {
      const built = builder.build(input);
      // A custom builder cannot restore tool authority omitted by this deliberately bad adapter.
      const { toolChoice: _toolChoice, ...request } = built.request;
      return { ...built, request };
    }),
  } satisfies ContextBuilder;
}

function harness(
  responses: readonly (readonly ModelStreamEvent[])[],
  options: Pick<CoreDeps, "answerReview" | "limits" | "context"> = {
    answerReview: true,
    limits: { maxModelRequests: 4 },
    context: reviewContext(),
  },
  effectClass: "read" | "workspace_write" = "read",
) {
  const directory = mkdtempSync(join(tmpdir(), "moyyi-answer-review-"));
  const store = new SqliteSessionStore(join(directory, "store"));
  const resource: (typeof disposables)[number] = { directory, store };
  disposables.push(resource);
  const events: RuntimeEvent[] = [];
  const client = new ScriptedModelClient(responses);
  const tool: ToolDefinition = {
    name: "inspect",
    description: "Return a fixed observed value",
    inputSchema: { type: "object", additionalProperties: false },
    effect: { class: effectClass, reversibility: "none", verification: "none" },
    prepare: vi.fn(async () => ({
      digest: "unused" as ActionDigest,
      summary: "Inspect a value",
      payload: null,
      preconditions: [],
    })),
    execute: vi.fn(async () => ({
      status: "succeeded" as const,
      content: [{ type: "text" as const, text: "Observed value: 42" }],
    })),
  };
  let expire = () => {};
  const scheduler = {
    sleep: vi.fn(async () => {}),
    deadline: vi.fn((_milliseconds: number, callback: () => void) => {
      expire = callback;
      return () => {};
    }),
  };
  const core = new AgentCore({
    ...options,
    model: client,
    profile: { ...scriptedProfile, maxOutputTokens: 8192 },
    store,
    tools: [tool],
    policy: {
      beforePrepare: () => ({ kind: "allow" }),
      beforeExecute: () => ({ kind: "allow" }),
    },
    validator: { validate: (_schema, raw) => ({ valid: true, value: JSON.parse(raw) }) },
    preconditions: { check: async () => ({ valid: true }) },
    hasher: {
      digest: (value) =>
        `sha256:${createHash("sha256").update(canonicalizeJson(value)).digest("hex")}` as ActionDigest,
    },
    scheduler,
    clock: { now: () => new Date().toISOString() as Timestamp },
    ids: { next: (prefix) => `${prefix}_${randomUUID()}` },
    emit: (event) => events.push(event),
  });
  resource.core = core;
  let sessionId: SessionId;
  return {
    core,
    client,
    tool,
    store,
    events,
    scheduler,
    expire: () => expire(),
    async start() {
      await core.send({ type: "session.create", workspaceRoot: directory });
      const ready = events.find((event) => event.type === "session.ready");
      if (ready?.type !== "session.ready") throw Error("Session did not start");
      sessionId = ready.sessionId;
      await core.send({
        type: "run.start",
        sessionId,
        input: [{ type: "text", text: "Explain the observed value." }],
      });
      const started = events.find((event) => event.type === "run.started");
      if (started?.type !== "run.started") throw Error("Run did not start");
      return started.runId;
    },
    async finish() {
      await core.idle();
      const finished = events.findLast((event) => event.type === "run.finished");
      if (finished?.type !== "run.finished") throw Error("Run did not finish");
      return finished.outcome;
    },
    async snapshot(): Promise<SessionSnapshot> {
      const result = await store.loadSession(sessionId);
      if (!result) throw Error("Missing session");
      return result;
    },
  };
}

afterEach(async () => {
  for (const { core, store, directory } of disposables.splice(0)) {
    await core?.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("opt-in bounded answer review with real core and SQLite", () => {
  it("requires a review builder and at least four total requests", () => {
    expect(() =>
      harness([], {
        answerReview: true,
        context: new MinimalContextBuilder(),
        limits: { maxModelRequests: 3 },
      }),
    ).toThrow("at least 4");
    expect(() =>
      harness([], {
        answerReview: true,
        context: { build: (input) => new MinimalContextBuilder().build(input) },
        limits: { maxModelRequests: 4 },
      }),
    ).toThrow("review context builder");
  });

  it.each([4, 8])("reserves exactly two stages within a %i-request limit", async (maximum) => {
    const context = reviewContext();
    const test = harness(
      [
        ...Array.from({ length: maximum - 2 }, (_, index) => read(`read_${index}`)),
        answer('{"evidence":42}'),
        answer("The observed value is 42."),
        answer("A forbidden extra request."),
      ],
      { answerReview: true, context, limits: { maxModelRequests: maximum, timeoutMs: 300_000 } },
    );
    await test.start();
    expect(await test.finish()).toEqual({ kind: "completed" });
    expect(test.client.requests).toHaveLength(maximum);
    expect(test.client.remaining).toBe(1);
    expect(test.tool.execute).toHaveBeenCalledTimes(maximum - 2);
    expect(context.buildAnswerReview.mock.calls.map((entry) => entry[1])).toEqual([
      "evidence",
      "answer",
    ]);
    expect(test.client.requests.slice(0, -2).every((request) => !request.toolChoice)).toBe(true);
    expect(test.client.requests.slice(-2).every((request) => request.toolChoice === "none")).toBe(
      true,
    );
    expect(test.client.requests.every((request) => request.maxOutputTokens === 8192)).toBe(true);
    expect(test.scheduler.deadline).toHaveBeenCalledTimes(1);
    expect(test.scheduler.deadline).toHaveBeenCalledWith(300_000, expect.any(Function));
    const evidence = test.client.requests.at(-2);
    const results = evidence?.messages.flatMap((message) =>
      message.content.filter((part) => part.type === "tool_result"),
    );
    expect(results).toHaveLength(maximum - 2);
    expect(results?.at(-1)?.callId).toBe(`read_${maximum - 3}`);
    expect(
      results?.every(
        (result) =>
          result.content[0]?.type === "text" && result.content[0].text === "Observed value: 42",
      ),
    ).toBe(true);
    const snapshot = await test.snapshot();
    const responses = snapshot.entries.flatMap((entry) =>
      entry.body.kind === "assistant_message" ? [entry.body] : [],
    );
    expect(responses.slice(-2).map((body) => body.request?.rendererVersion)).toEqual([
      "moyyi-evidence-review-v1",
      "moyyi-reviewed-answer-v1",
    ]);
    for (const response of responses) {
      expect(response.usage).toEqual(UNKNOWN_USAGE);
      expect(await test.store.getBlob(response.request.system)).not.toBeNull();
    }
    expect(snapshot.runs).toHaveLength(1);
    expect(
      test.events.filter((event) => event.type === "assistant.delta").map((event) => event.text),
    ).toEqual(["The observed value is 42."]);
    expect(
      snapshot.entries.filter(
        (entry) => entry.body.kind === "notice" && entry.body.code === "answer_review_stage",
      ),
    ).toHaveLength(2);
    expect(JSON.stringify(test.client.requests[maximum - 3])).toContain(
      "1 investigation request(s) remain",
    );
    expect(JSON.stringify(test.client.requests[maximum - 3])).not.toContain(
      "last tool-enabled request",
    );
  });

  it("moves an early answer through one review and one answer without spending unused allowance", async () => {
    const test = harness([answer("Early draft."), answer("Evidence."), answer("Final.")]);
    await test.start();
    expect(await test.finish()).toEqual({ kind: "completed" });
    expect(test.client.requests).toHaveLength(3);
    expect(test.tool.prepare).not.toHaveBeenCalled();
    expect(
      test.events.filter((event) => event.type === "assistant.delta").map((event) => event.text),
    ).toEqual(["Early draft.", "Final."]);
  });

  it.each([undefined, false])(
    "keeps the original path when the flag is %s",
    async (answerReview) => {
      const context = reviewContext();
      const test = harness([read("first"), answer("Unreviewed.")], {
        context,
        ...(answerReview === undefined ? {} : { answerReview }),
        limits: { maxModelRequests: 2 },
      });
      await test.start();
      expect(await test.finish()).toEqual({ kind: "completed" });
      expect(context.buildAnswerReview).not.toHaveBeenCalled();
      expect(test.client.requests).toHaveLength(2);
      expect(test.client.requests[1]?.toolChoice).toBe("none");
      expect(JSON.stringify(test.client.requests[0])).toContain(
        "This is the last tool-enabled request.",
      );
      expect(JSON.stringify(test.client.requests[0])).not.toContain("Two requests are reserved");
    },
  );

  it.each([0, 1])("retains refusal at stage %i without further review calls", async (stage) => {
    const refusal: readonly ModelStreamEvent[] = [
      { type: "part_completed", index: 0, part: { type: "refusal", text: "Cannot do this." } },
      { ...done, stopReason: "refusal" },
    ];
    const test = harness([...(stage ? [answer("Draft.")] : []), refusal, answer("Must not run.")]);
    await test.start();
    expect(await test.finish()).toEqual({ kind: "completed" });
    expect(test.client.requests).toHaveLength(stage + 1);
    expect(test.client.remaining).toBe(1);
  });

  it.each(["investigation", "evidence"] as const)(
    "does not review refusal content with end_turn in %s",
    async (stage) => {
      const refusal: readonly ModelStreamEvent[] = [
        { type: "part_completed", index: 0, part: { type: "refusal", text: "Cannot do this." } },
        done,
      ];
      const test = harness([
        ...(stage === "evidence" ? [answer("Draft.")] : []),
        refusal,
        answer("Must not run."),
      ]);
      await test.start();
      expect(await test.finish()).toEqual({ kind: "completed" });
      expect(test.client.requests).toHaveLength(stage === "evidence" ? 2 : 1);
      expect(test.client.remaining).toBe(1);
      const snapshot = await test.snapshot();
      expect(
        snapshot.entries.some(
          (entry) =>
            entry.body.kind === "assistant_message" &&
            entry.body.content.some((part) => part.type === "refusal"),
        ),
      ).toBe(true);
    },
  );

  it("does not execute mixed refusal and tool-use content or send it to review", async () => {
    const test = harness([
      [
        { type: "part_completed", index: 0, part: { type: "refusal", text: "Cannot do this." } },
        { type: "part_completed", index: 1, part: call("forbidden") },
        { ...done, stopReason: "tool_use" },
      ],
      answer("Must not run."),
    ]);
    await test.start();
    expect(await test.finish()).toEqual({
      kind: "failed",
      reason: "Refused response contained tool calls",
    });
    expect(test.tool.prepare).not.toHaveBeenCalled();
    expect(test.client.requests).toHaveLength(1);
    expect(
      (await test.snapshot()).entries.flatMap((entry) =>
        entry.body.kind === "tool_results" ? entry.body.results : [],
      ),
    ).toMatchObject([{ callId: "forbidden", status: "denied" }]);
  });

  it.each(["evidence", "answer"] as const)(
    "denies tool violations in %s without preparation",
    async (stage) => {
      const test = harness([
        answer("Draft."),
        ...(stage === "answer" ? [answer("Evidence.")] : []),
        read("forbidden"),
        answer("Must not run."),
      ]);
      await test.start();
      expect(await test.finish()).toEqual({
        kind: "failed",
        reason: "Answer review returned a forbidden tool call",
      });
      expect(test.tool.prepare).not.toHaveBeenCalled();
      expect(test.tool.execute).not.toHaveBeenCalled();
      const snapshot = await test.snapshot();
      expect(snapshot.effects).toEqual([]);
      expect(
        snapshot.entries.flatMap((entry) =>
          entry.body.kind === "tool_results" ? entry.body.results : [],
        ),
      ).toMatchObject([{ callId: "forbidden", status: "denied" }]);
      expect(test.client.remaining).toBe(1);
    },
  );

  it.each(["evidence", "answer"] as const)(
    "preserves %s output exhaustion without another call",
    async (stage) => {
      const test = harness([
        answer("Draft."),
        ...(stage === "answer" ? [answer("Evidence.")] : []),
        answer("Incomplete", "max_tokens"),
        answer("Must not run."),
      ]);
      await test.start();
      expect(await test.finish()).toEqual({
        kind: "budget_exhausted",
        budget: "model_output_tokens",
      });
      expect(test.client.remaining).toBe(1);
    },
  );

  it("does not reserve review after an unfinished investigation response", async () => {
    const test = harness([
      read("first"),
      answer("Incomplete", "max_tokens"),
      answer("Must not run."),
    ]);
    await test.start();
    expect(await test.finish()).toEqual({
      kind: "budget_exhausted",
      budget: "model_output_tokens",
    });
    expect(test.client.requests).toHaveLength(2);
    expect(test.client.remaining).toBe(1);
  });

  it("does not retry the last investigation attempt into reserved review capacity", async () => {
    const error: readonly ModelStreamEvent[] = [
      {
        type: "error",
        error: {
          kind: "network",
          message: "Disconnected",
          partialOutput: false,
          usage: UNKNOWN_USAGE,
        },
      },
    ];
    const test = harness([read("first"), error, answer("Must not run.")], {
      answerReview: true,
      context: reviewContext(),
      limits: { maxModelRequests: 4, maxRetries: 2 },
    });
    await test.start();
    expect(await test.finish()).toEqual({ kind: "failed", reason: "Disconnected" });
    expect(test.scheduler.sleep).not.toHaveBeenCalled();
    expect(test.client.requests).toHaveLength(2);
    expect(test.client.remaining).toBe(1);
  });

  it("does not promote an unknown investigation effect to reviewed completion", async () => {
    const test = harness([read("effect"), answer("Must not run.")], undefined, "workspace_write");
    vi.mocked(test.tool.execute).mockRejectedValue(new Error("Interrupted effect"));
    await test.start();
    expect(await test.finish()).toEqual({
      kind: "failed",
      reason: "Tool outcome unknown; verify before retrying",
    });
    expect(test.client.requests).toHaveLength(1);
    const snapshot = await test.snapshot();
    expect(snapshot.effects).toMatchObject([{ state: "unknown" }]);
    expect(snapshot.leases).toHaveLength(1);
    expect(snapshot.runs[0]?.status).toBe("interrupted");
  });

  it("pairs truncated review tool calls as denied while retaining output exhaustion", async () => {
    const test = harness([
      answer("Draft."),
      [
        { type: "part_completed", index: 0, part: call("forbidden") },
        { ...done, stopReason: "max_tokens" },
      ],
      answer("Must not run."),
    ]);
    await test.start();
    expect(await test.finish()).toEqual({
      kind: "budget_exhausted",
      budget: "model_output_tokens",
    });
    expect(test.tool.prepare).not.toHaveBeenCalled();
    expect(
      (await test.snapshot()).entries.flatMap((entry) =>
        entry.body.kind === "tool_results" ? entry.body.results : [],
      ),
    ).toMatchObject([{ callId: "forbidden", status: "denied" }]);
    expect(test.client.remaining).toBe(1);
  });

  it("does not send an answer after an empty evidence response", async () => {
    const test = harness([answer("Draft."), [done], answer("Must not run.")]);
    await test.start();
    expect(await test.finish()).toEqual({
      kind: "failed",
      reason: "Model response contained no answer text",
    });
    expect(test.client.requests).toHaveLength(2);
    expect(test.client.remaining).toBe(1);
  });

  it.each(["evidence", "answer"] as const)("does not retry a retryable %s error", async (stage) => {
    const error: readonly ModelStreamEvent[] = [
      {
        type: "error",
        error: { kind: "overloaded", message: "Busy", partialOutput: false, usage: UNKNOWN_USAGE },
      },
    ];
    const test = harness(
      [
        answer("Draft."),
        ...(stage === "answer" ? [answer("Evidence.")] : []),
        error,
        answer("Must not run."),
      ],
      {
        answerReview: true,
        context: reviewContext(),
        limits: { maxModelRequests: 8, maxRetries: 2 },
      },
    );
    await test.start();
    expect(await test.finish()).toEqual({ kind: "failed", reason: "Busy" });
    expect(test.scheduler.sleep).not.toHaveBeenCalled();
    expect(test.client.remaining).toBe(1);
  });

  it.each(["cancel", "deadline"] as const)("preserves %s during review", async (mode) => {
    const test = harness([answer("Draft."), answer("Evidence."), answer("Must not run.")]);
    const stream = test.client.stream.bind(test.client);
    test.client.stream = async function* (request, signal) {
      if (test.client.requests.length === 1) {
        if (mode === "deadline") test.expire();
        else {
          const started = test.events.find((event) => event.type === "run.started");
          if (started?.type !== "run.started") throw Error("Missing run");
          await test.core.send({ type: "run.cancel", runId: started.runId });
        }
      }
      yield* stream(request, signal);
    };
    await test.start();
    expect(await test.finish()).toEqual(
      mode === "deadline" ? { kind: "budget_exhausted", budget: "time" } : { kind: "cancelled" },
    );
    expect(test.client.requests).toHaveLength(2);
    expect(test.client.remaining).toBe(1);
  });

  it.each(["evidence", "answer"] as const)(
    "preserves steering in %s and refuses a stale conclusion",
    async (stage) => {
      const test = harness([
        answer("Draft."),
        answer("Evidence."),
        answer("Stale answer."),
        answer("Must not run."),
      ]);
      const stream = test.client.stream.bind(test.client);
      test.client.stream = async function* (request, signal) {
        if (test.client.requests.length === (stage === "evidence" ? 1 : 2)) {
          const started = test.events.find((event) => event.type === "run.started");
          if (started?.type !== "run.started") throw Error("Missing run");
          await test.core.send({
            type: "run.steer",
            runId: started.runId,
            input: [{ type: "text", text: "The task has changed." }],
          });
        }
        yield* stream(request, signal);
      };
      await test.start();
      expect(await test.finish()).toMatchObject({
        kind: "failed",
        reason: expect.stringContaining("Task changed during answer review"),
      });
      expect(test.client.requests).toHaveLength(stage === "evidence" ? 2 : 3);
      const snapshot = await test.snapshot();
      expect(
        snapshot.entries.some(
          (entry) =>
            entry.body.kind === "user_message" &&
            entry.body.steering &&
            entry.body.content[0]?.type === "text" &&
            entry.body.content[0].text === "The task has changed.",
        ),
      ).toBe(true);
    },
  );
});
