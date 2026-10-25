import { describe, expect, it } from "vitest";
import {
  type ContentPart,
  checkModelStream,
  type ModelRequest,
  type ModelStreamEvent,
  type ToolCallId,
  UNKNOWN_USAGE,
} from "../../contracts/index.ts";
import {
  buildDeepSeekRequest,
  DEEPSEEK_API_PROFILE,
  decodeDeepSeekEvents,
  deepSeekProfile,
} from "./codec.ts";
import {
  deepSeekFixture,
  deepSeekFixtureSse,
  deepSeekTextFixture,
  deepSeekToolFixture,
} from "./fixtures.ts";

const defaultSignal = () => new AbortController().signal;
function request(overrides: Partial<ModelRequest> = {}): ModelRequest {
  return {
    origin: deepSeekProfile.origin,
    system: [{ type: "text", text: "Trusted instructions." }],
    messages: [{ role: "user", content: [{ type: "text", text: "Inspect the project." }] }],
    tools: [{ name: "read", description: "Read text", inputSchema: { type: "object" } }],
    maxOutputTokens: 512,
    ...overrides,
  };
}
async function* iterable(events: readonly unknown[]) {
  yield* events;
}
async function collect(events: AsyncIterable<ModelStreamEvent>): Promise<ModelStreamEvent[]> {
  const result: ModelStreamEvent[] = [];
  for await (const event of events) result.push(event);
  return result;
}
async function decode(
  events: readonly unknown[],
  signal = defaultSignal(),
): Promise<ModelStreamEvent[]> {
  const decoded = await collect(decodeDeepSeekEvents(iterable(events), signal));
  expect(checkModelStream(decoded)).toEqual([]);
  return decoded;
}
function at(events: Record<string, unknown>[], type: string): Record<string, unknown> {
  const found = events.find((event) => event.type === type);
  if (!found) throw new Error(`Fixture lacks ${type}`);
  return found;
}
function lastResponse(events: Record<string, unknown>[]): Record<string, unknown> {
  return events.at(-1)?.response as Record<string, unknown>;
}
function completedParts(events: ModelStreamEvent[]): ContentPart[] {
  return events
    .filter((event) => event.type === "part_completed")
    .sort((a, b) => a.index - b.index)
    .map((event) => event.part);
}
function expectError(events: ModelStreamEvent[], kind = "protocol", partial = true) {
  expect(events.at(-1)).toMatchObject({ type: "error", error: { kind, partialOutput: partial } });
  expect(
    events.filter((event) => event.type === "completed" || event.type === "error"),
  ).toHaveLength(1);
}

describe("DeepSeek request codec", () => {
  it("selects only the supported documented request controls", () => {
    expect(DEEPSEEK_API_PROFILE).toBe("deepseek-responses-text-v1-2026-10-25");
    expect(deepSeekProfile).toMatchObject({
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 8192,
      reasoning: "visible",
      parallelToolCalls: true,
    });
    expect(buildDeepSeekRequest(request())).toEqual({
      model: "deepseek-flash",
      stream: true,
      reasoning: { effort: "high" },
      max_output_tokens: 512,
      instructions: "Trusted instructions.",
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Inspect the project." }],
        },
      ],
      tools: [
        {
          type: "function",
          name: "read",
          description: "Read text",
          parameters: { type: "object" },
        },
      ],
      tool_choice: "auto",
    });
  });
  it("reconstructs full reasoning in all completed turns and preserves tool arguments/results", () => {
    const callId = "local_1" as ToolCallId;
    const built = buildDeepSeekRequest(
      request({
        messages: [
          {
            role: "assistant",
            stopReason: "end_turn",
            content: [
              {
                type: "reasoning",
                kind: "visible",
                text: "Earlier full reasoning.\nEven without a call.",
              },
              { type: "text", text: "Earlier answer." },
            ],
          },
          { role: "user", content: [{ type: "text", text: "Continue." }] },
          {
            role: "assistant",
            stopReason: "tool_use",
            content: [
              { type: "reasoning", kind: "visible", text: "Now inspect." },
              {
                type: "tool_call",
                callId,
                providerCallId: "wire_1",
                providerItemId: "item_1",
                name: "read",
                rawArguments: '{ "path": ',
                argumentsSource: "verbatim",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "tool_result",
                callId,
                status: "unknown",
                content: [{ type: "text", text: "Verify before retrying." }],
              },
            ],
          },
        ],
      }),
    );
    expect(built.input).toEqual([
      {
        type: "reasoning",
        content: [
          { type: "reasoning_text", text: "Earlier full reasoning.\nEven without a call." },
        ],
      },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Earlier answer." }],
      },
      { type: "message", role: "user", content: [{ type: "input_text", text: "Continue." }] },
      { type: "reasoning", content: [{ type: "reasoning_text", text: "Now inspect." }] },
      { type: "function_call", call_id: "wire_1", name: "read", arguments: '{ "path": ' },
      {
        type: "function_call_output",
        call_id: "wire_1",
        output: '{"content":["Verify before retrying."],"status":"unknown"}',
      },
    ]);
  });
  it("does not parse or depend on stale, malformed opaque replay payloads", () => {
    const history = request({
      messages: [
        {
          role: "assistant",
          stopReason: "end_turn",
          content: [
            { type: "reasoning", kind: "visible", text: "Full current reasoning." },
            { type: "text", text: "Answer." },
          ],
          replay: {
            version: 1,
            payloadVersion: 99,
            origin: { provider: "other", model: "other", modelRevision: null, apiProfile: "stale" },
            contentHash: "not-current",
            payload: "not JSON",
          },
        },
      ],
    });
    const built = buildDeepSeekRequest(history);
    expect(JSON.stringify(built)).not.toContain("not JSON");
    expect(JSON.stringify(built)).toContain("Full current reasoning.");
  });
  it.each([undefined, "interrupted", "max_tokens", "refusal", "other"] as const)(
    "rejects assistant history without proved complete stop reason %s",
    (stopReason) => {
      expect(() =>
        buildDeepSeekRequest(
          request({
            messages: [
              {
                role: "assistant",
                ...(stopReason ? { stopReason } : {}),
                content: [
                  { type: "reasoning", kind: "visible", text: "Potential fragment" },
                  { type: "text", text: "Answer" },
                ],
              },
            ],
          }),
        ),
      ).toThrow("unproven");
    },
  );
  it.each([
    { type: "text", text: "No reasoning" },
    { type: "reasoning", kind: "summary", text: "Only summary" },
    { type: "reasoning", kind: "opaque" },
    { type: "image", mediaType: "image/png", blob: "sha256:synthetic" },
    { type: "refusal", text: "Unsupported refusal representation" },
  ])("rejects unsupported or incomplete history %j", (part) => {
    expect(() =>
      buildDeepSeekRequest(
        request({
          messages: [{ role: "assistant", stopReason: "end_turn", content: [part as ContentPart] }],
        }),
      ),
    ).toThrow();
  });
  it("rejects images in user/system and tool output instead of dropping them", () => {
    const image = {
      type: "image",
      mediaType: "image/png",
      blob: "sha256:synthetic",
    } as ContentPart;
    expect(() => buildDeepSeekRequest(request({ system: [image] }))).toThrow();
    expect(() =>
      buildDeepSeekRequest(request({ messages: [{ role: "user", content: [image] }] })),
    ).toThrow();
  });
  it("rejects orphaned and duplicate calls/results", () => {
    const callId = "local" as ToolCallId;
    const call: ContentPart = {
      type: "tool_call",
      callId,
      providerCallId: "wire",
      providerItemId: "item",
      name: "read",
      rawArguments: "{}",
      argumentsSource: "verbatim",
    };
    const reasoning: ContentPart = { type: "reasoning", kind: "visible", text: "Inspect" };
    const result: ContentPart = { type: "tool_result", callId, status: "failed", content: [] };
    expect(() =>
      buildDeepSeekRequest(
        request({
          messages: [{ role: "assistant", stopReason: "tool_use", content: [reasoning, call] }],
        }),
      ),
    ).toThrow("needs a result");
    expect(() =>
      buildDeepSeekRequest(
        request({
          messages: [
            { role: "assistant", stopReason: "tool_use", content: [reasoning, call, call] },
          ],
        }),
      ),
    ).toThrow("Duplicate");
    expect(() =>
      buildDeepSeekRequest(request({ messages: [{ role: "user", content: [result] }] })),
    ).toThrow("Unpaired");
    expect(() =>
      buildDeepSeekRequest(
        request({
          messages: [
            { role: "assistant", stopReason: "tool_use", content: [reasoning, call] },
            { role: "user", content: [result, result] },
          ],
        }),
      ),
    ).toThrow("duplicate");
  });
  it("rejects invalid limits/model/tool names and never mutates the request", () => {
    expect(() => buildDeepSeekRequest(request({ maxOutputTokens: 8193 }))).toThrow();
    expect(() =>
      buildDeepSeekRequest(request({ origin: { provider: "other", model: "deepseek-flash" } })),
    ).toThrow();
    expect(() =>
      buildDeepSeekRequest(
        request({ tools: [{ name: "bad/name", description: "", inputSchema: {} }] }),
      ),
    ).toThrow();
    const original = request();
    const before = JSON.stringify(original);
    buildDeepSeekRequest(original);
    expect(JSON.stringify(original)).toBe(before);
  });
  it("rejects unsupported fields instead of silently forwarding or dropping them", () => {
    expect(() =>
      buildDeepSeekRequest({ ...request(), previous_response_id: "unavailable" } as ModelRequest),
    ).toThrow("Unsupported request field");
    expect(() =>
      buildDeepSeekRequest(
        request({
          messages: [
            { role: "user", content: [{ type: "text", text: 123 } as unknown as ContentPart] },
          ],
        }),
      ),
    ).toThrow("valid text");
    expect(() =>
      buildDeepSeekRequest(
        request({
          messages: [
            {
              role: "user",
              content: [{ type: "text", text: "text", annotations: [] } as ContentPart],
            },
          ],
        }),
      ),
    ).toThrow("Unsupported request field");
  });
});

describe("DeepSeek semantic stream codec", () => {
  it("assembles visible reasoning/text and counts usage once without inventing cache writes", async () => {
    const events = await decode(deepSeekTextFixture("你好 😀"));
    expect(completedParts(events)).toEqual([
      { type: "reasoning", kind: "visible", text: "Review the supplied facts." },
      { type: "text", text: "你好 😀" },
    ]);
    expect(events.at(-1)).toEqual({
      type: "completed",
      stopReason: "end_turn",
      providerStopReason: {
        status: "completed",
        incompleteReason: null,
        model: "deepseek-flash",
        responseId: "fixture_response_1",
      },
      usage: {
        status: "final",
        inputTokens: 20,
        outputTokens: 8,
        cacheReadTokens: 4,
        cacheWriteTokens: null,
        reasoningTokens: 3,
      },
    });
    expect(events.filter((event) => event.type === "reasoning_delta")).toHaveLength(2);
  });
  it("keeps verbatim invalid arguments and distinct stable call/item IDs", async () => {
    const wire = deepSeekToolFixture("read", '{ "path": ');
    const first = await decode(wire),
      second = await decode(wire);
    expect(first).toEqual(second);
    const call = completedParts(first).find((part) => part.type === "tool_call");
    expect(call).toMatchObject({
      type: "tool_call",
      providerCallId: "fixture_call_1",
      providerItemId: "fixture_response_1_item_1",
      rawArguments: '{ "path": ',
      argumentsSource: "verbatim",
    });
    expect(call?.callId).not.toBe(call?.providerCallId);
    expect(call?.callId.length).toBeLessThanOrEqual(512);
    expect(first.at(-1)).toMatchObject({ type: "completed", stopReason: "tool_use" });
  });
  it("can finalize streamed parts from the complete terminal snapshot exactly once", async () => {
    const wire = deepSeekToolFixture().filter(
      (event) =>
        event.type !== "response.output_item.done" && event.type !== "response.content_part.done",
    );
    const events = await decode(wire);
    expect(completedParts(events)).toHaveLength(2);
    expect(events.at(-1)).toMatchObject({ type: "completed", stopReason: "tool_use" });
  });
  it("handles interleaved calls and reverse completion without changing canonical order", async () => {
    const wire = deepSeekFixture([
      { type: "function_call", callId: "call_a", name: "read", arguments: '{"path":"a"}' },
      { type: "function_call", callId: "call_b", name: "list", arguments: "{}" },
    ]);
    const first = wire.filter((event) => event.output_index === 0);
    const second = wire.filter((event) => event.output_index === 1);
    const reordered = [
      wire[0],
      wire[1],
      first[0],
      second[0],
      first[1],
      second[1],
      second[2],
      second[3],
      second[4],
      first[2],
      first[3],
      first[4],
      wire.at(-1),
    ].map((event, index) => ({ ...event, sequence_number: index * 3 }));
    const events = await decode(reordered);
    expect(
      completedParts(events).map((part) =>
        part.type === "tool_call" ? part.providerCallId : "unexpected",
      ),
    ).toEqual(["call_a", "call_b"]);
  });
  it.each([
    ["max_output_tokens", "max_tokens"],
    ["content_filter", "refusal"],
  ])("maps incomplete %s without granting tool execution", async (incompleteReason, stopReason) => {
    const events = await decode(
      deepSeekToolFixture("read", "{}", { status: "incomplete", incompleteReason }),
    );
    expect(events.at(-1)).toMatchObject({ type: "completed", stopReason });
  });
  it("retains failure usage as partial and suppresses remote error text", async () => {
    const events = await decode(
      deepSeekTextFixture("Partial", {
        status: "failed",
        error: { code: "server_error", message: "Bearer synthetic-secret" },
      }),
    );
    expectError(events, "overloaded");
    expect(events.at(-1)).toMatchObject({
      error: { usage: { status: "partial", inputTokens: 20 } },
    });
    expect(JSON.stringify(events)).not.toContain("synthetic-secret");
  });
  it("returns a failed response before content with genuinely unknown usage", async () => {
    const events = await decode(deepSeekFixture([], { status: "failed", usage: null }));
    expectError(events, "overloaded", false);
    expect(events.at(-1)).toMatchObject({ error: { usage: UNKNOWN_USAGE } });
  });
  it.each([null, {}])("keeps unavailable usage unknown: %j", async (usage) => {
    const events = await decode(deepSeekTextFixture("Answer", { usage }));
    expect(events.at(-1)).toMatchObject({ type: "completed", usage: UNKNOWN_USAGE });
  });
  it("keeps missing individual counters null", async () => {
    const events = await decode(deepSeekTextFixture("Answer", { usage: { input_tokens: 0 } }));
    expect(events.at(-1)).toMatchObject({
      usage: {
        status: "final",
        inputTokens: 0,
        outputTokens: null,
        cacheReadTokens: null,
        reasoningTokens: null,
      },
    });
  });
  it.each([
    { input_tokens: -1 },
    { output_tokens: 1.5 },
    { input_tokens: 3, input_tokens_details: { cached_tokens: 4 } },
    { output_tokens: 2, output_tokens_details: { reasoning_tokens: 3 } },
    { input_tokens: 2, output_tokens: 3, total_tokens: 99 },
  ])("rejects malformed usage %j", async (usage) =>
    expectError(await decode(deepSeekTextFixture("Answer", { usage }))),
  );
  it("rejects EOF before any content, and partial EOF after a delta", async () => {
    expectError(await decode([]), "stream_interrupted", false);
    const wire = deepSeekTextFixture();
    const index = wire.findIndex((event) => event.type === "response.reasoning_text.delta");
    expectError(await decode(wire.slice(0, index + 1)), "stream_interrupted");
  });
  it("returns cancellation before pulling input", async () => {
    const controller = new AbortController();
    controller.abort();
    let pulled = false;
    async function* source() {
      pulled = true;
      yield* deepSeekTextFixture();
    }
    const events = await collect(decodeDeepSeekEvents(source(), controller.signal));
    expect(pulled).toBe(false);
    expectError(events, "cancelled", false);
  });
  it("returns partial cancellation after a delta and closes input", async () => {
    const controller = new AbortController();
    let closed = false;
    async function* source() {
      try {
        for (const event of deepSeekTextFixture()) {
          yield event;
          if (event.type === "response.reasoning_text.delta") controller.abort();
        }
      } finally {
        closed = true;
      }
    }
    const events = await collect(decodeDeepSeekEvents(source(), controller.signal));
    expect(checkModelStream(events)).toEqual([]);
    expectError(events, "cancelled");
    expect(closed).toBe(true);
  });
  it("returns cancellation after completed content without a second terminal", async () => {
    const controller = new AbortController();
    const iterator = decodeDeepSeekEvents(iterable(deepSeekTextFixture()), controller.signal)[
      Symbol.asyncIterator
    ]();
    const events: ModelStreamEvent[] = [];
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      events.push(next.value);
      if (next.value.type === "part_completed") controller.abort();
    }
    expect(checkModelStream(events)).toEqual([]);
    expectError(events, "cancelled");
  });
  it("does not wait for an unresponsive event source after cancellation", async () => {
    const controller = new AbortController();
    let pulled = false;
    let closed = false;
    const source: AsyncIterable<unknown> = {
      [Symbol.asyncIterator]: () => ({
        next: () => {
          pulled = true;
          return new Promise<IteratorResult<unknown>>(() => {});
        },
        return: async () => {
          closed = true;
          return { done: true, value: undefined };
        },
      }),
    };
    const pending = collect(decodeDeepSeekEvents(source, controller.signal));
    await Promise.resolve();
    controller.abort();
    const events = await pending;
    expect(pulled).toBe(true);
    expect(closed).toBe(true);
    expectError(events, "cancelled", false);
  });
  it("does not append a second terminal when transport cleanup throws", async () => {
    const fixture = deepSeekTextFixture();
    const source: AsyncIterable<unknown> = {
      [Symbol.asyncIterator]: () => {
        let offset = 0;
        return {
          next: async () =>
            offset < fixture.length
              ? { done: false, value: fixture[offset++] }
              : { done: true, value: undefined },
          return: async () => {
            throw new Error("Synthetic cleanup failure");
          },
        };
      },
    };
    const events = await collect(decodeDeepSeekEvents(source, defaultSignal()));
    expect(checkModelStream(events)).toEqual([]);
    expect(events.at(-1)).toMatchObject({ type: "completed" });
  });
  it("stops reading immediately after a validated terminal", async () => {
    let beyondTerminal = false;
    async function* source() {
      yield* deepSeekTextFixture();
      beyondTerminal = true;
      throw new Error("Should not pull");
    }
    const events = await collect(decodeDeepSeekEvents(source(), defaultSignal()));
    expect(events.at(-1)).toMatchObject({ type: "completed" });
    expect(beyondTerminal).toBe(false);
  });
  it("preserves typed transport failures without echoing their messages", async () => {
    async function* source() {
      yield deepSeekTextFixture()[0];
      throw Object.assign(new Error("Bearer synthetic-key"), {
        kind: "protocol",
        retryAfterMs: 250,
      });
    }
    const events = await collect(decodeDeepSeekEvents(source(), defaultSignal()));
    expectError(events, "protocol", false);
    expect(events.at(-1)).toMatchObject({ error: { retryAfterMs: 250 } });
    expect(JSON.stringify(events)).not.toContain("synthetic-key");
  });
  it.each(["summary", "invalid_encrypted", "annotation", "phase", "unknown"])(
    "rejects unsupported semantic output %s",
    async (variant) => {
      const wire = deepSeekTextFixture();
      const item = at(wire, "response.output_item.added").item as Record<string, unknown>;
      if (variant === "summary") item.summary = [{ type: "summary_text", text: "Not full" }];
      if (variant === "invalid_encrypted") item.encrypted_content = { ciphertext: "opaque" };
      if (variant === "unknown") item.type = "web_search_call";
      if (variant === "phase") {
        item.type = "message";
        item.role = "assistant";
        item.phase = "commentary";
      }
      if (variant === "annotation")
        (at(wire, "response.content_part.added").part as Record<string, unknown>).annotations = [
          { type: "url_citation" },
        ];
      expectError(await decode(wire), "protocol", false);
    },
  );
  it.each([
    "sequence",
    "item_id",
    "delta_kind",
    "text_done",
    "terminal_text",
    "terminal_count",
    "terminal_id",
    "terminal_model",
    "terminal_status",
    "unknown_event",
  ])("rejects inconsistent streams: %s", async (variant) => {
    const wire = deepSeekTextFixture("Original answer");
    const delta = at(wire, "response.output_text.delta");
    if (variant === "sequence") delta.sequence_number = 0;
    if (variant === "item_id") delta.item_id = "different_item";
    if (variant === "delta_kind") delta.type = "response.reasoning_text.delta";
    if (variant === "text_done") at(wire, "response.output_text.done").text = "Changed answer";
    if (variant === "terminal_text") {
      const item = (lastResponse(wire).output as Record<string, unknown>[])[1] as Record<
        string,
        unknown
      >;
      const part = (item.content as Record<string, unknown>[])[0] as Record<string, unknown>;
      part.text = "Changed late";
    }
    if (variant === "terminal_count") lastResponse(wire).output = [];
    if (variant === "terminal_id") lastResponse(wire).id = "different_response";
    if (variant === "terminal_model") lastResponse(wire).model = "different_model";
    if (variant === "terminal_status") lastResponse(wire).status = "in_progress";
    if (variant === "unknown_event") delta.type = "response.unknown_event";
    const events = await decode(wire);
    expectError(events);
    expect(completedParts(events)).not.toContainEqual({ type: "text", text: "Changed late" });
  });
  it("rejects a completed part being mutated by a later delta", async () => {
    const wire = deepSeekTextFixture();
    const i = wire.findIndex((event) => event.type === "response.content_part.done");
    wire.splice(i + 1, 0, {
      type: "response.reasoning_text.delta",
      output_index: 0,
      content_index: 0,
      item_id: "fixture_response_1_item_0",
      delta: "late",
    });
    wire.forEach((event, index) => {
      event.sequence_number = index;
    });
    const events = await decode(wire);
    expectError(events);
    expect(completedParts(events)[0]).toEqual({
      type: "reasoning",
      kind: "visible",
      text: "Review the supplied facts.",
    });
  });
  it("rejects duplicate starts before any content and malformed Unicode", async () => {
    const wire = deepSeekTextFixture();
    const index = wire.findIndex((event) => event.type === "response.content_part.added");
    wire.splice(index + 1, 0, { ...wire[index] });
    wire.forEach((event, index) => {
      event.sequence_number = index;
    });
    expectError(await decode(wire), "protocol", false);
    const malformed = deepSeekTextFixture();
    at(malformed, "response.reasoning_text.delta").delta = "bad\ud800";
    expectError(await decode(malformed), "protocol", false);
  });
  it("rejects duplicate call identity and function arguments that change at terminal", async () => {
    const wire = deepSeekToolFixture();
    const full = (lastResponse(wire).output as Record<string, unknown>[])[1] as Record<
      string,
      unknown
    >;
    full.arguments = "different";
    expectError(await decode(wire));
    const duplicate = deepSeekFixture([
      { type: "function_call", callId: "duplicate", name: "read", arguments: "{}" },
      { type: "function_call", callId: "duplicate", name: "list", arguments: "{}" },
    ]);
    expectError(await decode(duplicate));
  });
  it("does not accept a data DONE marker as a Responses terminal", async () => {
    expectError(await decode(["[DONE]"]), "protocol", false);
    expect(deepSeekFixtureSse(deepSeekTextFixture())).toContain("event: response.completed\ndata:");
    expect(deepSeekFixtureSse(deepSeekTextFixture())).not.toContain("[DONE]");
  });
});
