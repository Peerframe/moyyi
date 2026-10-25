import { describe, expect, it, vi } from "vitest";
import {
  checkModelStream,
  type ModelMessage,
  type ModelRequest,
  type ModelStreamEvent,
  type PluginHost,
  type ToolCallId,
} from "../../contracts/index.ts";
import { anthropicProfile, buildAnthropicRequest } from "./codec.ts";
import { anthropicFixture, anthropicFixtureTransport } from "./fixtures.ts";
import { createAnthropicClient, createAnthropicPlugin } from "./index.ts";
import type { AnthropicTransport } from "./types.ts";

const options = { accountScope: "synthetic-account-a" };
const request = (
  messages: readonly ModelMessage[] = [
    { role: "user", content: [{ type: "text", text: "Read the fixture" }] },
  ],
): ModelRequest => ({
  origin: anthropicProfile.origin,
  system: [{ type: "text", text: "Synthetic instructions." }],
  tools: [{ name: "read", description: "Read a file", inputSchema: { type: "object" } }],
  messages,
  maxOutputTokens: 4096,
});
const thought = {
  type: "thinking",
  thinking: "Synthetic summary of reasoning",
  signature: "synthetic-signature",
} as const;
const textBlock = { type: "text", text: "Synthetic answer 中文😀" } as const;
async function all<T>(source: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of source) result.push(item);
  return result;
}
async function collect(raw: string, input = request()) {
  const fixture = anthropicFixtureTransport([raw]);
  const events = await all(
    createAnthropicClient(fixture.transport, options).stream(input, new AbortController().signal),
  );
  expect(checkModelStream(events)).toEqual([]);
  expect(fixture.closed()).toBe(1);
  return events;
}
function assistant(events: readonly ModelStreamEvent[]): ModelMessage {
  const terminal = events.at(-1);
  if (terminal?.type !== "completed") throw Error("No completed response");
  return {
    role: "assistant",
    content: events.flatMap((event) => (event.type === "part_completed" ? [event.part] : [])),
    stopReason: terminal.stopReason,
    ...(terminal.replay ? { replay: terminal.replay } : {}),
  };
}
function toolResult(message: ModelMessage): ModelMessage {
  const call = message.content.find((part) => part.type === "tool_call");
  if (call?.type !== "tool_call") throw Error("No call");
  return {
    role: "user",
    content: [
      {
        type: "tool_result",
        callId: call.callId,
        status: "succeeded",
        content: [{ type: "text", text: "observed fixture" }],
      },
    ],
  };
}

describe("Anthropic Messages provider", () => {
  it("streams text, summarized/redacted reasoning and honest cumulative usage", async () => {
    const events = await collect(
      anthropicFixture([
        thought,
        { type: "redacted_thinking", data: "synthetic-encrypted" },
        textBlock,
      ]),
    );
    expect(events).toContainEqual({
      type: "reasoning_delta",
      index: 0,
      kind: "summary",
      text: thought.thinking,
    });
    expect(assistant(events).content).toEqual([
      { type: "reasoning", kind: "summary", text: thought.thinking },
      { type: "reasoning", kind: "opaque" },
      { type: "text", text: textBlock.text },
    ]);
    expect(events.at(-1)).toMatchObject({
      usage: {
        status: "final",
        inputTokens: 17,
        outputTokens: 7,
        cacheReadTokens: 3,
        cacheWriteTokens: 2,
        reasoningTokens: null,
      },
    });
    expect(assistant(events).replay?.payload).toContain("synthetic-signature");
  });
  it("keeps missing counters unknown instead of assuming zero", async () => {
    expect((await collect(anthropicFixture([textBlock], { usage: null }))).at(-1)).toMatchObject({
      usage: { status: "unknown", inputTokens: null, outputTokens: null },
    });
    expect(
      (
        await collect(
          anthropicFixture([textBlock], { usage: { input_tokens: 12, output_tokens: 1 } }),
        )
      ).at(-1),
    ).toMatchObject({
      usage: { status: "final", inputTokens: null, outputTokens: 7, cacheReadTokens: null },
    });
  });
  it("preserves raw tool JSON and bound thinking through repeated tool rounds", async () => {
    const initial = request();
    const first = assistant(
      await collect(
        anthropicFixture(
          [
            thought,
            { type: "tool_use", id: "tool_1", name: "read", rawArguments: ' { "path": "a.txt" } ' },
          ],
          { responseId: "msg_first" },
        ),
        initial,
      ),
    );
    expect(first.content.at(-1)).toMatchObject({
      rawArguments: ' { "path": "a.txt" } ',
      argumentsSource: "verbatim",
    });
    const secondRequest = request([...initial.messages, first, toolResult(first)]);
    const wire = buildAnthropicRequest(secondRequest, options);
    expect(JSON.stringify(wire.body)).toContain("synthetic-signature");
    const second = assistant(
      await collect(
        anthropicFixture(
          [
            thought,
            { type: "tool_use", id: "tool_2", name: "read", rawArguments: '{"path":"b.txt"}' },
          ],
          { responseId: "msg_second" },
        ),
        secondRequest,
      ),
    );
    expect(second.content.at(-1)).toMatchObject({ callId: "anthropic:msg_second:tool_2" });
    const third = buildAnthropicRequest(
      request([...secondRequest.messages, second, toolResult(second)]),
      options,
    );
    expect(JSON.stringify(third.body).match(/synthetic-signature/g)).toHaveLength(2);
    expect(third.invalidated).toEqual([]);
  });
  it("strips stale reasoning after compaction, but preserves fresh subsequent reasoning", async () => {
    const first = assistant(
      await collect(anthropicFixture([thought, textBlock], { responseId: "before" })),
    );
    const edited = request([
      { role: "user", content: [{ type: "text", text: "A new summary of older history" }] },
      first,
      { role: "user", content: [{ type: "text", text: "Continue" }] },
    ]);
    expect(JSON.stringify(buildAnthropicRequest(edited, options).body)).not.toContain(
      "synthetic-signature",
    );
    const fresh = assistant(
      await collect(
        anthropicFixture([{ ...thought, signature: "fresh-signature" }, textBlock], {
          responseId: "after",
        }),
        edited,
      ),
    );
    const again = buildAnthropicRequest(
      request([
        ...edited.messages,
        fresh,
        { role: "user", content: [{ type: "text", text: "Next" }] },
      ]),
      options,
    );
    expect(JSON.stringify(again.body)).toContain("fresh-signature");
    expect(JSON.stringify(again.body)).not.toContain("synthetic-signature");
  });
  it("records invalidations so restoring old bytes never resurrects removed reasoning", async () => {
    const first = assistant(
      await collect(anthropicFixture([thought, textBlock], { responseId: "first" })),
    );
    const modified = {
      ...request([
        ...request().messages,
        first,
        { role: "user", content: [{ type: "text", text: "Next" }] },
      ]),
      system: [{ type: "text" as const, text: "Changed system" }],
    };
    const fresh = assistant(
      await collect(anthropicFixture([thought, textBlock], { responseId: "second" }), modified),
    );
    const restored = request([
      ...modified.messages,
      fresh,
      { role: "user", content: [{ type: "text", text: "Restore original system" }] },
    ]);
    expect(JSON.stringify(buildAnthropicRequest(restored, options).body)).not.toContain(
      "synthetic-signature",
    );
  });
  it.each(["refusal", "max_tokens", "interrupted", "empty-interrupted"] as const)(
    "does not resurrect earlier thinking after a durable %s, even in a fresh client",
    async (mode) => {
      const initial = request();
      const old = assistant(
        await collect(
          anthropicFixture(
            [
              thought,
              { type: "tool_use", id: "old_tool", name: "read", rawArguments: '{"path":"a.txt"}' },
            ],
            { responseId: "before_failure" },
          ),
          initial,
        ),
      );
      const changed: ModelRequest = {
        ...initial,
        system: [{ type: "text", text: "Changed system" }],
        messages: [...initial.messages, old, toolResult(old)],
      };
      expect(JSON.stringify(buildAnthropicRequest(changed, options).body)).not.toContain(
        thought.signature,
      );
      const interrupted = mode === "interrupted" || mode === "empty-interrupted";
      let raw = anthropicFixture(mode === "empty-interrupted" ? [] : [textBlock], {
        responseId: "failed_response",
        ...(interrupted ? {} : { stopReason: mode }),
      });
      if (interrupted) raw = raw.replace(/event: message_delta[\s\S]*$/, "");
      const events = await collect(raw, changed);
      const failure: ModelMessage =
        mode === "empty-interrupted"
          ? // This is the existing ContextBuilder representation of an empty persisted interruption.
            // Its words are deliberately arbitrary: the adapter must not parse runtime notice text.
            {
              role: "user",
              content: [{ type: "text", text: "An interrupted attempt without output" }],
            }
          : interrupted
            ? {
                role: "assistant",
                content: events.flatMap((event) =>
                  event.type === "part_completed" ? [event.part] : [],
                ),
                stopReason: "interrupted",
              }
            : assistant(events);
      expect(failure.replay).toBeUndefined();
      expect(events.at(-1)?.type).toBe(interrupted ? "error" : "completed");
      // Persist/reload JSON and instantiate a new client. No process-local invalidation survives.
      const restored = JSON.parse(
        JSON.stringify(
          request([
            ...changed.messages,
            failure,
            { role: "user", content: [{ type: "text", text: "Continue with original system" }] },
          ]),
        ),
      ) as ModelRequest;
      const wire = JSON.stringify(buildAnthropicRequest(restored, options).body);
      expect(wire).not.toContain(thought.signature);
      expect(wire).toContain('"id":"old_tool"');
      expect(wire).toContain('"tool_use_id":"old_tool"');
      const transport = anthropicFixtureTransport([
        anthropicFixture([{ ...thought, signature: "fresh-after-failure" }, textBlock], {
          responseId: "after_failure",
        }),
      ]);
      const fresh = assistant(
        await all(
          createAnthropicClient(transport.transport, options).stream(
            restored,
            new AbortController().signal,
          ),
        ),
      );
      expect(JSON.stringify(transport.requests)).not.toContain(thought.signature);
      const next = JSON.parse(
        JSON.stringify(
          request([
            ...restored.messages,
            fresh,
            { role: "user", content: [{ type: "text", text: "Another turn" }] },
          ]),
        ),
      ) as ModelRequest;
      const continued = JSON.stringify(buildAnthropicRequest(next, options).body);
      expect(continued).not.toContain(thought.signature);
      expect(continued).toContain("fresh-after-failure");
    },
  );
  it("uses text/tool fallback on account, content or tool-schema changes", async () => {
    const first = assistant(await collect(anthropicFixture([thought, textBlock])));
    const history = request([
      ...request().messages,
      first,
      { role: "user", content: [{ type: "text", text: "Continue" }] },
    ]);
    expect(
      JSON.stringify(buildAnthropicRequest(history, { accountScope: "account-b" }).body),
    ).not.toContain("synthetic-signature");
    expect(
      JSON.stringify(buildAnthropicRequest({ ...history, tools: [] }, options).body),
    ).not.toContain("synthetic-signature");
    expect(
      JSON.stringify(
        buildAnthropicRequest(
          request([
            ...request().messages,
            { ...first, content: [{ type: "text", text: "Edited answer" }] },
            { role: "user", content: [{ type: "text", text: "Continue" }] },
          ]),
          options,
        ).body,
      ),
    ).not.toContain("synthetic-signature");
  });
  it("normalizes refusal details without replaying or retrying it", async () => {
    const events = await collect(
      anthropicFixture([textBlock], {
        stopReason: "refusal",
        stopDetails: { type: "refusal", explanation: "Synthetic refusal detail" },
      }),
    );
    expect(events).toContainEqual({
      type: "part_completed",
      index: 1,
      part: { type: "refusal", text: "Synthetic refusal detail" },
    });
    expect(events.at(-1)).toMatchObject({ type: "completed", stopReason: "refusal" });
    expect(assistant(events).replay).toBeUndefined();
  });
  it.each(["max_tokens", "pause_turn", "stop_sequence"])(
    "preserves %s termination provenance",
    async (stopReason) => {
      expect((await collect(anthropicFixture([textBlock], { stopReason }))).at(-1)).toMatchObject({
        type: "completed",
        providerStopReason: { reason: stopReason },
      });
    },
  );
  it.each([
    "duplicate-start",
    "wrong-index",
    "duplicate-json",
    "missing-signature",
    "missing-stop",
    "post-stop",
    "wrong-model",
    "bad-usage",
    "unpaired-stop",
  ])("rejects malformed %s without successful completion", async (mode) => {
    let raw = anthropicFixture([thought, textBlock]);
    if (mode === "duplicate-start") raw = raw.slice(0, raw.indexOf("\n\n") + 2) + raw;
    if (mode === "wrong-index") raw = raw.replace('"index":0', '"index":1');
    if (mode === "duplicate-json")
      raw = raw.replace('"type":"message_start"', '"type":"message_start","type":"ping"');
    if (mode === "missing-signature")
      raw = raw.replace('"signature":"synthetic-signature"', '"signature":""');
    if (mode === "missing-stop") raw = raw.replace(/event: message_stop[\s\S]*$/, "");
    if (mode === "post-stop") raw += 'event: message_delta\ndata: {"type":"message_delta"}\n\n';
    if (mode === "wrong-model") raw = raw.replace("claude-sonnet-5-5", "different-model");
    if (mode === "bad-usage") raw = raw.replace('"output_tokens":7', '"output_tokens":-1');
    if (mode === "unpaired-stop")
      raw = raw.replace('"stop_reason":"end_turn"', '"stop_reason":"tool_use"');
    const events = await collect(raw);
    expect(events.at(-1)?.type).toBe("error");
    expect(events.some((event) => event.type === "completed")).toBe(false);
  });
  it("retains partial text and usage on a stream failure", async () => {
    const raw = anthropicFixture([textBlock]).replace(
      /event: message_delta[\s\S]*$/,
      'event: error\ndata: {"type":"error","error":{"type":"overloaded_error","message":"private diagnostic"}}\n\n',
    );
    const events = await collect(raw);
    expect(events.at(-1)).toMatchObject({
      type: "error",
      error: {
        kind: "overloaded",
        partialOutput: true,
        usage: { status: "partial", inputTokens: 17 },
      },
    });
    expect(JSON.stringify(events)).not.toContain("private diagnostic");
  });
  it.each(['{"path":"a","path":"b"}', '{"n":1e999}', '{"path":'])(
    "rejects malformed streamed tool JSON as a protocol failure: %s",
    async (rawArguments) => {
      const events = await collect(
        anthropicFixture([{ type: "tool_use", id: "tool_bad", name: "read", rawArguments }]),
      );
      expect(events.at(-1)).toMatchObject({
        type: "error",
        error: { kind: "protocol", partialOutput: true },
      });
      expect(events.some((event) => event.type === "part_completed")).toBe(false);
    },
  );
  it("keeps partial content on a network interruption and closes the attempt", async () => {
    const prefix = anthropicFixture([textBlock]).split("event: message_delta")[0] ?? "";
    const close = vi.fn(async () => {});
    const transport = vi.fn<AnthropicTransport>().mockResolvedValue({
      status: 200,
      contentType: "text/event-stream",
      retryAfter: null,
      body: {
        async *[Symbol.asyncIterator]() {
          yield new TextEncoder().encode(prefix);
          throw Error("private network diagnostic");
        },
      },
      close,
    });
    const events = await all(
      createAnthropicClient(transport, options).stream(request(), new AbortController().signal),
    );
    expect(events.at(-1)).toMatchObject({
      type: "error",
      error: { kind: "network", partialOutput: true, usage: { status: "partial" } },
    });
    expect(JSON.stringify(events)).not.toContain("private network diagnostic");
    expect(transport).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
  it.each([401, 403, 429, 500, 529, 400, 302])(
    "maps HTTP %s once and closes without reading error bodies",
    async (status) => {
      const close = vi.fn(async () => {}),
        transport = vi.fn<AnthropicTransport>().mockResolvedValue({
          status,
          contentType: "application/json",
          retryAfter: "2",
          body: {
            [Symbol.asyncIterator]() {
              throw Error("private response must not be read");
            },
          },
          close,
        });
      const events = await all(
        createAnthropicClient(transport, options).stream(request(), new AbortController().signal),
      );
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "error",
        error: { partialOutput: false, retryAfterMs: 2000 },
      });
      expect(transport).toHaveBeenCalledOnce();
      expect(close).toHaveBeenCalledOnce();
    },
  );
  it("cancels pending body iteration and never sends an already cancelled request", async () => {
    const controller = new AbortController(),
      close = vi.fn(async () => {}),
      entered = Promise.withResolvers<void>();
    const transport = vi.fn<AnthropicTransport>().mockResolvedValue({
      status: 200,
      contentType: "text/event-stream",
      retryAfter: null,
      body: {
        [Symbol.asyncIterator]() {
          return {
            next() {
              entered.resolve();
              return new Promise<IteratorResult<Uint8Array>>(() => {});
            },
          };
        },
      },
      close,
    });
    const pending = all(
      createAnthropicClient(transport, options).stream(request(), controller.signal),
    );
    await entered.promise;
    controller.abort();
    expect((await pending).at(-1)).toMatchObject({ type: "error", error: { kind: "cancelled" } });
    expect(close).toHaveBeenCalledOnce();
    await all(createAnthropicClient(transport, options).stream(request(), controller.signal));
    expect(transport).toHaveBeenCalledOnce();
  });
  it("refuses unsupported content and unpaired tools before transport", async () => {
    const transport = vi.fn<AnthropicTransport>();
    const invalid = request([
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            callId: "missing" as ToolCallId,
            status: "succeeded",
            content: [],
          },
        ],
      },
    ]);
    expect(
      (
        await all(
          createAnthropicClient(transport, options).stream(invalid, new AbortController().signal),
        )
      ).at(-1),
    ).toMatchObject({ type: "error", error: { kind: "invalid_request" } });
    expect(transport).not.toHaveBeenCalled();
  });
  it("registers only the pinned model and rejects plugin wire configuration", () => {
    const register = vi.fn();
    const plugin = createAnthropicPlugin(vi.fn(), options);
    plugin.setup({ config: undefined, registerModelProvider: register } as unknown as PluginHost);
    expect(register).toHaveBeenCalledOnce();
    expect(register.mock.calls[0]?.[0].models).toEqual([anthropicProfile]);
    expect(() => register.mock.calls[0]?.[0].createClient("other")).toThrow();
    expect(() =>
      plugin.setup({ config: { url: "https://example.test" } } as unknown as PluginHost),
    ).toThrow();
  });
});
