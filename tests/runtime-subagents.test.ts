import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type ModelClient,
  type ModelRequest,
  type ModelStreamEvent,
  type RuntimeEvent,
  type SessionId,
  type ToolCallId,
  type ToolResultPart,
  UNKNOWN_USAGE,
} from "../src/contracts/index.ts";
import { scriptedProfile } from "../src/plugins/provider-scripted/index.ts";
import { ReadOnlyPolicy } from "../src/policy/index.ts";
import { createRuntime, type RuntimeOptions } from "../src/runtime/index.ts";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const call = (id: string, name: string, args: unknown, index = 0) => ({
  type: "part_completed" as const,
  index,
  part: {
    type: "tool_call" as const,
    callId: id as ToolCallId,
    providerCallId: id,
    providerItemId: null,
    name,
    rawArguments: JSON.stringify(args),
    argumentsSource: "verbatim" as const,
  },
});
const toolUse: ModelStreamEvent = {
  type: "completed",
  stopReason: "tool_use",
  providerStopReason: null,
  usage: UNKNOWN_USAGE,
};
const answer = (text: string): ModelStreamEvent[] => [
  { type: "part_completed", index: 0, part: { type: "text", text } },
  { type: "completed", stopReason: "end_turn", providerStopReason: null, usage: UNKNOWN_USAGE },
];

/** Routes main-agent and sub-agent requests to separate scripts, keyed by the brief text. */
class SplitClient implements ModelClient {
  readonly requests: ModelRequest[] = [];
  active = 0;
  maxActive = 0;
  readonly main: ModelStreamEvent[][];
  readonly children: Record<string, ModelStreamEvent[][]>;
  readonly hold: ((request: ModelRequest, signal: AbortSignal) => Promise<void>) | undefined;
  constructor(
    main: ModelStreamEvent[][],
    children: Record<string, ModelStreamEvent[][]>,
    hold?: (request: ModelRequest, signal: AbortSignal) => Promise<void>,
  ) {
    this.main = main;
    this.children = children;
    this.hold = hold;
  }
  async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelStreamEvent> {
    this.requests.push(request);
    const text = JSON.stringify(request.messages);
    const key = Object.keys(this.children).find((name) => text.includes(`main agent: ${name}`));
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      await this.hold?.(request, signal);
      if (signal.aborted) {
        yield {
          type: "error",
          error: {
            kind: "cancelled",
            message: "aborted",
            partialOutput: false,
            usage: UNKNOWN_USAGE,
          },
        };
        return;
      }
      const events = key ? this.children[key]?.shift() : this.main.shift();
      if (!events) throw Error(`No scripted response for ${key ?? "main"}`);
      for (const event of events) yield event;
    } finally {
      this.active--;
    }
  }
}

async function start(client: SplitClient, extra: Partial<RuntimeOptions> = {}) {
  const root = mkdtempSync(join(tmpdir(), "moyyi-sub-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "w");
  mkdirSync(workspace);
  writeFileSync(join(workspace, "README.md"), "The project codename is HERON.\n");
  const runtime = await createRuntime({
    model: scriptedProfile.origin,
    dataDirectory: join(root, "d"),
    subagents: { maxRequests: 3, timeoutMs: 20_000, maxConcurrent: 2, maxPerRun: 3 },
    plugins: [
      {
        plugin: {
          name: "split-model",
          apiVersion: 1,
          setup(host) {
            host.registerModelProvider({
              id: "scripted",
              models: [scriptedProfile],
              createClient: () => client,
            });
          },
        },
      },
    ],
    ...extra,
  });
  cleanups.push(() => runtime.close());
  const events: RuntimeEvent[] = [];
  runtime.subscribe((event) => events.push(event));
  await runtime.send({ type: "session.create", workspaceRoot: workspace });
  const { sessionId } = events.find((event) => event.type === "session.ready") as {
    sessionId: SessionId;
  };
  return { runtime, events, sessionId };
}

const mainResults = (events: RuntimeEvent[], sessionId: SessionId): ToolResultPart[] =>
  events.flatMap((event) =>
    event.type === "entry.appended" &&
    event.entry.sessionId === sessionId &&
    event.entry.body.kind === "tool_results"
      ? event.entry.body.results
      : [],
  );
const report = (result: ToolResultPart | undefined) =>
  JSON.parse(result?.content.map((part) => ("text" in part ? part.text : "")).join("") ?? "{}");

describe("read-only sub-agents", () => {
  it("runs a sub-agent in a child session with read-only tools and returns its report", async () => {
    const client = new SplitClient(
      [
        [call("m1", "agent", { description: "find codename", prompt: "Read README.md." }), toolUse],
        answer("The codename is HERON."),
      ],
      {
        "find codename": [
          [call("s1", "read", { path: "README.md" }), toolUse],
          answer("README.md says the codename is HERON."),
        ],
      },
    );
    const t = await start(client);
    await t.runtime.send({
      type: "run.start",
      sessionId: t.sessionId,
      input: [{ type: "text", text: "What is the codename?" }],
    });
    await t.runtime.idle();
    const [result] = mainResults(t.events, t.sessionId);
    expect(result?.status).toBe("succeeded");
    const body = report(result);
    expect(body).toMatchObject({
      outcome: "completed",
      report: "README.md says the codename is HERON.",
    });
    // The child session is separate, and its session.ready never reached the client.
    expect(body.subagentSession).not.toBe(t.sessionId);
    expect(t.events.filter((event) => event.type === "session.ready")).toHaveLength(1);
    const childRequest = client.requests.find((request) =>
      JSON.stringify(request.messages).includes("main agent: find codename"),
    );
    const childTools = childRequest?.tools.map((tool) => tool.name) ?? [];
    expect(childTools).toContain("read");
    for (const name of ["agent", "create", "edit", "shell", "web_fetch"])
      expect(childTools).not.toContain(name);
    expect(client.requests[0]?.tools.map((tool) => tool.name)).toContain("agent");
    expect(t.events.findLast((event) => event.type === "run.finished")).toMatchObject({
      outcome: { kind: "completed" },
    });
  });

  it("runs sub-agents of one response in parallel, within the concurrency limit", async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const client = new SplitClient(
      [
        [
          call("m1", "agent", { description: "alpha", prompt: "A" }),
          call("m2", "agent", { description: "beta", prompt: "B" }, 1),
          toolUse,
        ],
        answer("Both done."),
      ],
      { alpha: [answer("alpha report")], beta: [answer("beta report")] },
      async (request) => {
        if (JSON.stringify(request.messages).includes("main agent:")) {
          if (client.active >= 2) release();
          await gate;
        }
      },
    );
    const t = await start(client);
    await t.runtime.send({
      type: "run.start",
      sessionId: t.sessionId,
      input: [{ type: "text", text: "Go" }],
    });
    await t.runtime.idle();
    expect(client.maxActive).toBe(2);
    // Each result is recorded when its call finishes, so match results by call, not position.
    expect(
      Object.fromEntries(
        mainResults(t.events, t.sessionId).map((result) => [result.callId, report(result).report]),
      ),
    ).toEqual({ m1: "alpha report", m2: "beta report" });
  });

  it("reports a sub-agent that runs out of requests as a failed tool result", async () => {
    const read = (id: string) => [call(id, "read", { path: "README.md" }), toolUse];
    const client = new SplitClient(
      [
        [call("m1", "agent", { description: "loop", prompt: "Keep reading." }), toolUse],
        answer("It ran out."),
      ],
      { loop: [read("s1"), read("s2"), read("s3")] },
    );
    const t = await start(client);
    await t.runtime.send({
      type: "run.start",
      sessionId: t.sessionId,
      input: [{ type: "text", text: "Go" }],
    });
    await t.runtime.idle();
    const [result] = mainResults(t.events, t.sessionId);
    expect(result?.status).toBe("failed");
    expect(report(result)).toMatchObject({
      outcome: "budget_exhausted",
      reason: "budget exhausted: model_requests",
    });
  });

  it("cancels the sub-agent when the main run is cancelled", async () => {
    const client = new SplitClient(
      [[call("m1", "agent", { description: "slow", prompt: "Wait." }), toolUse]],
      { slow: [answer("never")] },
      async (request, signal) => {
        if (JSON.stringify(request.messages).includes("main agent: slow"))
          await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
      },
    );
    const t = await start(client);
    await t.runtime.send({
      type: "run.start",
      sessionId: t.sessionId,
      input: [{ type: "text", text: "Go" }],
    });
    const started = () =>
      t.events.filter((event) => event.type === "run.started") as {
        runId: string;
        sessionId: SessionId;
      }[];
    while (started().length < 2) await new Promise((resolve) => setTimeout(resolve, 10));
    const main = started().find((event) => event.sessionId === t.sessionId);
    await t.runtime.send({ type: "run.cancel", runId: main?.runId as never });
    await t.runtime.idle();
    const finished = t.events.filter((event) => event.type === "run.finished");
    expect(finished.map((event) => (event as { outcome: { kind: string } }).outcome.kind)).toEqual(
      expect.arrayContaining(["cancelled", "cancelled"]),
    );
    expect(finished).toHaveLength(2);
  });

  it("routes a sub-agent's approval to the child run", async () => {
    const client = new SplitClient(
      [
        [call("m1", "agent", { description: "ask", prompt: "Read README.md." }), toolUse],
        answer("Done."),
      ],
      { ask: [[call("s1", "read", { path: "README.md" }), toolUse], answer("Read it.")] },
    );
    const t = await start(client, {
      policy: new ReadOnlyPolicy({ requireApproval: ["read"] }),
    });
    t.runtime.subscribe((event) => {
      if (event.type === "approval.requested")
        void t.runtime.send({
          type: "approval.respond",
          effectId: event.effectId,
          digest: event.digest,
          decision: "approve",
        });
    });
    await t.runtime.send({
      type: "run.start",
      sessionId: t.sessionId,
      input: [{ type: "text", text: "Go" }],
    });
    await t.runtime.idle();
    expect(t.events.some((event) => event.type === "command.rejected")).toBe(false);
    expect(report(mainResults(t.events, t.sessionId)[0])).toMatchObject({
      outcome: "completed",
      report: "Read it.",
    });
  });

  it("limits sub-agents per run and is off unless enabled", async () => {
    const calls = [1, 2, 3, 4].map((n) =>
      call(`m${n}`, "agent", { description: `task${n}`, prompt: "x" }, n - 1),
    );
    const client = new SplitClient([[...calls, toolUse], answer("Done.")], {
      task1: [answer("1")],
      task2: [answer("2")],
      task3: [answer("3")],
      task4: [answer("4")],
    });
    const t = await start(client);
    await t.runtime.send({
      type: "run.start",
      sessionId: t.sessionId,
      input: [{ type: "text", text: "Go" }],
    });
    await t.runtime.idle();
    const statuses = mainResults(t.events, t.sessionId).map((result) => result.status);
    expect(statuses.filter((status) => status === "succeeded")).toHaveLength(3);
    expect(statuses.filter((status) => status === "failed")).toHaveLength(1);
    const off = new SplitClient([answer("No agents.")], {});
    const plain = await start(off, { subagents: false });
    await plain.runtime.send({
      type: "run.start",
      sessionId: plain.sessionId,
      input: [{ type: "text", text: "Go" }],
    });
    await plain.runtime.idle();
    expect(off.requests[0]?.tools.map((tool) => tool.name)).not.toContain("agent");
  });
});
