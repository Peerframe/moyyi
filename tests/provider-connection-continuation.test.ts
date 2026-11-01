import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  type ActionDigest,
  canonicalizeJson,
  type ModelMessage,
  type ModelOrigin,
  type ModelRequest,
  type Plugin,
  type RuntimeEvent,
  type SessionId,
  type ToolCallPart,
} from "../src/contracts/index.ts";
import { buildDeepSeekRequest } from "../src/plugins/provider-deepseek/codec.ts";
import { deepSeekFixture, deepSeekFixtureSse } from "../src/plugins/provider-deepseek/fixtures.ts";
import {
  createDeepSeekPlugin,
  type DeepSeekTransport,
} from "../src/plugins/provider-deepseek/index.ts";
import { buildKimiRequest } from "../src/plugins/provider-kimi/codec.ts";
import { kimiFixture } from "../src/plugins/provider-kimi/fixtures.ts";
import { createKimiPlugin } from "../src/plugins/provider-kimi/index.ts";
import { createRuntime } from "../src/runtime/index.ts";
import { SqliteSessionStore } from "../src/store/index.ts";

const deepseek = { provider: "deepseek", model: "deepseek-flash" };
const kimi = { provider: "kimi", model: "kimi-k3.1-pro" };
const tools = [
  { name: "inspect", description: "Inspect synthetic evidence", inputSchema: { type: "object" } },
];

function request(origin: ModelOrigin, messages: readonly ModelMessage[]): ModelRequest {
  return { origin, messages, system: [], tools, maxOutputTokens: 512 };
}
function pair(origin: ModelOrigin, local = "local:1", wire = "wire_call"): ModelMessage[] {
  const call: ToolCallPart = {
    type: "tool_call",
    callId: local as ToolCallPart["callId"],
    providerCallId: wire,
    providerItemId: origin.provider === "deepseek" ? "response_item" : null,
    name: "inspect",
    rawArguments: '{ "evidence": true }',
    argumentsSource: "verbatim",
  };
  return [
    {
      role: "assistant",
      origin,
      stopReason: "tool_use",
      content: [
        { type: "reasoning", kind: "visible", text: `${origin.provider} private reasoning` },
        { type: "text", text: "Inspect the evidence." },
        call,
      ],
      replay: {
        version: 1,
        payloadVersion: 1,
        origin: { ...origin, modelRevision: null, apiProfile: "synthetic" },
        contentHash: `sha256:${"a".repeat(64)}`,
        payload: "private replay",
      },
    },
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          callId: call.callId,
          status: "succeeded",
          content: [{ type: "text", text: "Evidence: 42" }],
        },
      ],
    },
  ];
}

describe("provider connection history", () => {
  it.each([
    { source: deepseek, target: kimi, build: buildKimiRequest },
    { source: kimi, target: deepseek, build: buildDeepSeekRequest },
  ])(
    "renders foreign $source.provider history as text and paired calls for $target.provider",
    ({ source, target, build }) => {
      const messages = pair(source);
      const first = messages[0];
      if (!first) throw Error("Missing fixture");
      messages[0] = {
        ...first,
        content: [
          ...first.content,
          { type: "reasoning", kind: "opaque" },
          { type: "reasoning", kind: "summary", text: "Private summary" },
        ],
      };
      const before = canonicalizeJson(messages);
      const wire = build(request(target, messages));
      const text = JSON.stringify(wire);
      expect(text).toContain("Inspect the evidence.");
      expect(text).toContain("Evidence: 42");
      expect(text).not.toContain("private reasoning");
      expect(text).not.toContain("Private summary");
      expect(text).not.toContain("private replay");
      expect(canonicalizeJson(messages)).toBe(before);
      if (target.provider === "kimi") {
        const history = wire.messages as {
          role: string;
          tool_calls?: { id: string }[];
          tool_call_id?: string;
        }[];
        expect(history[0]?.tool_calls?.[0]?.id).toBe("wire_call");
        expect(history[1]?.tool_call_id).toBe("wire_call");
      } else {
        const history = wire.input as { type: string; call_id?: string; arguments?: string }[];
        const call = history.find((item) => item.type === "function_call");
        expect(call?.arguments).toBe('{ "evidence": true }');
        expect(history.find((item) => item.type === "function_call_output")?.call_id).toBe(
          call?.call_id,
        );
      }
    },
  );

  it.each([
    { origin: deepseek, build: buildDeepSeekRequest },
    { origin: kimi, build: buildKimiRequest },
  ])("preserves $origin.provider reasoning and wire IDs across keys", ({ origin, build }) => {
    const messages = pair(origin);
    const body = JSON.stringify(build(request(origin, messages)));
    expect(body).toContain(`${origin.provider} private reasoning`);
    expect(body).toContain("wire_call");
    expect(body).not.toContain("moyyi_foreign_");
    // Both adapters use visible common content and do not transmit opaque replay payloads.
    expect(messages[0]?.replay?.payload).toBe("private replay");
  });

  it("maps repeated foreign wire IDs without colliding with same-provider IDs", () => {
    const messages = [
      ...pair(deepseek, "native", "moyyi_foreign_1"),
      ...pair(kimi, "first", "repeated"),
      ...pair(kimi, "second", "repeated"),
    ];
    const wire = buildDeepSeekRequest(request(deepseek, messages));
    const history = wire.input as { type: string; call_id?: string }[];
    const ids = history.filter((item) => item.type === "function_call").map((item) => item.call_id);
    expect(ids).toEqual(["moyyi_foreign_1", "moyyi_foreign_2", "moyyi_foreign_3"]);
    expect(
      history.filter((item) => item.type === "function_call_output").map((item) => item.call_id),
    ).toEqual(ids);
    expect(buildDeepSeekRequest(request(deepseek, messages))).toEqual(wire);
  });

  it.each([
    { source: deepseek, target: kimi, build: buildKimiRequest },
    { source: kimi, target: deepseek, build: buildDeepSeekRequest },
  ])(
    "keeps interruption and pairing checks across $source.provider to $target.provider",
    ({ source, target, build }) => {
      const messages = pair(source);
      const first = messages[0];
      if (!first) throw Error("Missing fixture");
      expect(() =>
        build(request(target, [{ ...first, stopReason: "interrupted" }, ...messages.slice(1)])),
      ).toThrow("Interrupted or unproven");
      expect(() => build(request(target, [first]))).toThrow("Every tool call needs a result");
      expect(() => build(request(target, [...messages, messages[1] as ModelMessage]))).toThrow(
        "Unpaired or duplicate",
      );
      const repeated = first.content.at(-1);
      if (!repeated) throw Error("Missing call fixture");
      expect(() =>
        build(
          request(target, [
            { ...first, content: [...first.content, repeated] },
            ...messages.slice(1),
          ]),
        ),
      ).toThrow("Duplicate call ID");
    },
  );
});

const inspectPlugin: Plugin = {
  name: "connection-inspect",
  apiVersion: 1,
  setup(host) {
    const spec = tools[0];
    if (!spec) throw Error("Missing tool fixture");
    host.registerTool({
      ...spec,
      effect: { class: "read", reversibility: "none", verification: "none" },
      async prepare(args) {
        return {
          digest: "ignored" as ActionDigest,
          summary: "Inspect",
          preconditions: [],
          payload: args,
        };
      },
      async execute() {
        return { status: "succeeded", content: [{ type: "text", text: "Evidence: 42" }] };
      },
    });
  },
};

function transport(sequence: readonly { status: number; body: string }[]) {
  const requests: Record<string, unknown>[] = [];
  const send: DeepSeekTransport = async (body) => {
    const next = sequence[requests.length];
    if (!next) throw Error("Unexpected automatic model request");
    requests.push(JSON.parse(body) as Record<string, unknown>);
    return {
      status: next.status,
      contentType: next.status === 200 ? "text/event-stream" : "application/json",
      retryAfter: null,
      async close() {},
      body: {
        async *[Symbol.asyncIterator]() {
          yield new TextEncoder().encode(next.body);
        },
      },
    };
  };
  return { send, requests };
}
function toolWire(origin: ModelOrigin) {
  return origin.provider === "deepseek"
    ? deepSeekFixtureSse(
        deepSeekFixture([
          { type: "reasoning", text: "Original provider reasoning" },
          { type: "function_call", callId: "wire_inspect", name: "inspect", arguments: "{}" },
        ]),
      )
    : kimiFixture({
        reasoning: "Original provider reasoning",
        calls: [{ id: "wire_inspect", name: "inspect", arguments: "{}" }],
      });
}
function answerWire(origin: ModelOrigin) {
  return origin.provider === "deepseek"
    ? deepSeekFixtureSse(
        deepSeekFixture([{ type: "message", text: "The verified evidence is 42." }]),
      )
    : kimiFixture({ text: "The verified evidence is 42." });
}
function provider(origin: ModelOrigin, send: DeepSeekTransport) {
  return origin.provider === "deepseek"
    ? createDeepSeekPlugin(send, { reasoningEffort: "low" })
    : createKimiPlugin(send);
}

describe("synthetic connection continuation through the runtime", () => {
  it.each([
    { source: deepseek, target: kimi },
    { source: kimi, target: deepseek },
  ])(
    "retains the quota attempt and continues $source.provider to $target.provider in one session",
    async ({ source, target }) => {
      const directory = mkdtempSync(join(tmpdir(), "moyyi-connection-continuation-"));
      const workspace = join(directory, "workspace");
      mkdirSync(workspace);
      const store = new SqliteSessionStore(join(directory, "store"));
      const failed = transport([
        { status: 200, body: toolWire(source) },
        {
          status: source.provider === "kimi" ? 429 : 402,
          body: '{"error":{"type":"exceeded_current_quota_error","message":"private account diagnostic"}}',
        },
      ]);
      const resumed = transport([{ status: 200, body: answerWire(target) }]);
      const limits = { maxRetries: 0, maxModelRequests: 3 };
      let runtime = await createRuntime({
        store,
        model: source,
        plugins: [{ plugin: provider(source, failed.send) }, { plugin: inspectPlugin }],
        limits,
      });
      const events: RuntimeEvent[] = [];
      runtime.subscribe((event) => events.push(event));
      try {
        await runtime.send({ type: "session.create", workspaceRoot: workspace });
        const ready = events.find((event) => event.type === "session.ready");
        if (ready?.type !== "session.ready") throw Error("No session");
        const sessionId: SessionId = ready.sessionId;
        await runtime.send({
          type: "run.start",
          sessionId,
          input: [{ type: "text", text: "Inspect and report the evidence." }],
        });
        await runtime.idle();
        expect(events.findLast((event) => event.type === "run.finished")).toMatchObject({
          outcome: { kind: "failed", modelErrorKind: "quota" },
        });
        expect(failed.requests).toHaveLength(2);
        expect(JSON.stringify(events)).not.toContain("private account diagnostic");
        const before = await store.loadSession(sessionId);
        const retained = canonicalizeJson(before?.entries);
        await runtime.close();
        runtime = await createRuntime({
          store,
          model: target,
          plugins: [{ plugin: provider(target, resumed.send) }, { plugin: inspectPlugin }],
          limits,
        });
        runtime.subscribe((event) => events.push(event));
        await runtime.send({ type: "session.load", sessionId });
        expect(resumed.requests).toHaveLength(0);
        await runtime.send({
          type: "run.start",
          sessionId,
          input: [{ type: "text", text: "Continue using the recorded evidence." }],
        });
        await runtime.idle();
        expect(events.findLast((event) => event.type === "run.finished")).toMatchObject({
          outcome: { kind: "completed" },
        });
        expect(resumed.requests).toHaveLength(1);
        expect(JSON.stringify(resumed.requests[0])).toContain("Evidence: 42");
        expect(JSON.stringify(resumed.requests[0])).not.toContain("Original provider reasoning");
        const after = await store.loadSession(sessionId);
        expect(canonicalizeJson(after?.entries.slice(0, before?.entries.length))).toBe(retained);
        expect(after?.entries.at(-1)?.body).toMatchObject({
          kind: "assistant_message",
          origin: target,
          content: [{ type: "text", text: "The verified evidence is 42." }],
        });
      } finally {
        await runtime.close();
        store.close();
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});
