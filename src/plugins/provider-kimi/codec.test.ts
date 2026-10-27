import { describe, expect, it } from "vitest";
import {
  checkModelStream,
  type ModelMessage,
  type ModelRequest,
  type ModelStreamEvent,
  type ToolCallId,
  UNKNOWN_USAGE,
} from "../../contracts/index.ts";
import { buildKimiRequest } from "./codec.ts";
import { kimiFixture, kimiFixtureTransport } from "./fixtures.ts";
import { createKimiClient, kimiProfile } from "./index.ts";

const request: ModelRequest = {
  origin: kimiProfile.origin,
  system: [],
  messages: [{ role: "user", content: [{ type: "text", text: "Read." }] }],
  tools: [{ name: "read", description: "Read", inputSchema: { type: "object" } }],
  maxOutputTokens: 512,
};
type Event = Record<string, unknown>;
function at<T>(values: readonly T[], index: number): T {
  const value = values.at(index);
  if (value === undefined) throw Error("Missing synthetic fixture item");
  return value;
}
function choices(events: readonly Event[], index: number): Event[] {
  return at(events, index).choices as Event[];
}
function parse(stream: string): Event[] {
  return stream
    .split("\n\n")
    .filter((value) => value.startsWith("data: {"))
    .map((value) => JSON.parse(value.slice(6)) as Event);
}
function frame(events: readonly Event[], done = true) {
  return `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}${done ? "data: [DONE]\n\n" : ""}`;
}
async function output(stream: string, input = request) {
  const fixture = kimiFixtureTransport([stream]);
  const events: ModelStreamEvent[] = [];
  for await (const event of createKimiClient(fixture.transport).stream(
    input,
    new AbortController().signal,
  ))
    events.push(event);
  expect(checkModelStream(events)).toEqual([]);
  return events;
}
const tool = () =>
  kimiFixture({
    reasoning: "Need evidence.",
    calls: [{ id: "id1", name: "read", arguments: '{"path":"README.md"}' }],
  });
const last = (events: ModelStreamEvent[]) => events.at(-1);

describe("Kimi stream semantics", () => {
  it("keeps unknown usage unknown and missing counts null", async () => {
    expect(last(await output(kimiFixture({ text: "ok", usage: null })))).toMatchObject({
      type: "completed",
      usage: UNKNOWN_USAGE,
    });
    expect(
      last(await output(kimiFixture({ text: "ok", usage: { completion_tokens: 2 } }))),
    ).toMatchObject({
      type: "completed",
      usage: {
        status: "final",
        inputTokens: null,
        outputTokens: 2,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        reasoningTokens: null,
      },
    });
  });
  it("preserves partial usage after EOF and distinguishes the missing usage tail", async () => {
    const raw = parse(tool());
    const events = await output(frame(raw.slice(0, -1), false));
    expect(last(events)).toMatchObject({
      type: "error",
      error: {
        kind: "stream_interrupted",
        partialOutput: true,
        usage: { status: "partial", inputTokens: 20, cacheWriteTokens: 2 },
      },
    });
    expect(
      events.some((event) => event.type === "part_completed" && event.part.type === "tool_call"),
    ).toBe(false);
    expect(last(await output(frame(raw.slice(0, -1))))).toMatchObject({
      type: "error",
      error: { kind: "protocol" },
    });
  });
  it.each([
    [
      "identity changed",
      (events: Event[]) => {
        events[1] = { ...events[1], id: "different" };
      },
    ],
    [
      "model changed",
      (events: Event[]) => {
        events[1] = { ...events[1], model: "other" };
      },
    ],
    [
      "wrong object",
      (events: Event[]) => {
        events[1] = { ...events[1], object: "chat.completion" };
      },
    ],
    [
      "wrong choice",
      (events: Event[]) => {
        at(choices(events, 1), 0).index = 1;
      },
    ],
    [
      "extra choice",
      (events: Event[]) => {
        choices(events, 1).push({ ...at(choices(events, 1), 0) });
      },
    ],
    [
      "missing role",
      (events: Event[]) => {
        at(choices(events, 0), 0).delta = {};
      },
    ],
    [
      "wrong role",
      (events: Event[]) => {
        at(choices(events, 0), 0).delta = { role: "user" };
      },
    ],
    [
      "unknown semantic field",
      (events: Event[]) => {
        at(choices(events, 1), 0).delta = { reasoning_summary: "not full reasoning" };
      },
    ],
    [
      "unknown finish",
      (events: Event[]) => {
        at(choices(events, -2), 0).finish_reason = "function_call";
      },
    ],
    [
      "negative usage",
      (events: Event[]) => {
        at(events, -1).usage = { prompt_tokens: -1 };
      },
    ],
    [
      "inconsistent usage",
      (events: Event[]) => {
        at(events, -1).usage = { prompt_tokens: 20, completion_tokens: 8, total_tokens: 999 };
      },
    ],
    [
      "overlapping cache totals",
      (events: Event[]) => {
        at(events, -1).usage = {
          prompt_tokens: 20,
          prompt_tokens_details: { cached_tokens: 19, cache_write_tokens: 2 },
        };
      },
    ],
    [
      "excess reasoning",
      (events: Event[]) => {
        at(events, -1).usage = {
          completion_tokens: 8,
          completion_tokens_details: { reasoning_tokens: 9 },
        };
      },
    ],
    [
      "usage decreased",
      (events: Event[]) => {
        at(events, -1).usage = { prompt_tokens: 19 };
      },
    ],
    [
      "content after finish",
      (events: Event[]) => {
        events.splice(-1, 0, structuredClone(at(events, 1)));
      },
    ],
    [
      "duplicate tail",
      (events: Event[]) => {
        events.push(structuredClone(at(events, -1)));
      },
    ],
  ] as const)("rejects %s without completing calls", async (_label, mutate) => {
    const events = parse(tool());
    mutate(events);
    const result = await output(frame(events));
    expect(last(result)).toMatchObject({ type: "error", error: { kind: "protocol" } });
    expect(
      result.some((event) => event.type === "part_completed" && event.part.type === "tool_call"),
    ).toBe(false);
  });
  it("requires terminal framing and rejects extra semantic events after DONE", async () => {
    expect(last(await output(frame(parse(tool()), false)))).toMatchObject({
      type: "error",
      error: { kind: "stream_interrupted" },
    });
    expect(last(await output(`${tool()}data: [DONE]\n\n`))).toMatchObject({
      type: "error",
      error: { kind: "protocol" },
    });
    expect(last(await output(`${tool()}data: {}\n\n`))).toMatchObject({
      type: "error",
      error: { kind: "protocol" },
    });
  });
  it("does not accept calls in final-none or a stop without call completion", async () => {
    expect(last(await output(tool(), { ...request, toolChoice: "none" }))).toMatchObject({
      type: "error",
      error: { kind: "protocol" },
    });
    expect(
      last(await output(kimiFixture({ finishReason: "tool_calls", text: "no calls" }))),
    ).toMatchObject({ type: "error", error: { kind: "protocol" } });
    expect(
      last(await output(tool().replace('"finish_reason":"tool_calls"', '"finish_reason":"stop"'))),
    ).toMatchObject({ type: "error", error: { kind: "protocol" } });
  });
  it("retains refusal and truncation outcomes without claiming tool_use", async () => {
    expect(
      last(await output(kimiFixture({ text: "partial", finishReason: "length" }))),
    ).toMatchObject({ type: "completed", stopReason: "max_tokens" });
    const filtered = await output(
      kimiFixture({ refusal: "Cannot provide that.", finishReason: "content_filter" }),
    );
    expect(filtered).toContainEqual({
      type: "part_completed",
      index: 2,
      part: { type: "refusal", text: "Cannot provide that." },
    });
    expect(last(filtered)).toMatchObject({ type: "completed", stopReason: "refusal" });
    expect(await output(kimiFixture({ finishReason: "content_filter" }))).toContainEqual({
      type: "part_completed",
      index: 2,
      part: { type: "refusal", text: "Kimi stopped this response with content_filter." },
    });
    expect(
      last(await output(kimiFixture({ refusal: "Cannot.", finishReason: "stop" }))),
    ).toMatchObject({ type: "completed", stopReason: "refusal" });
    for (const finishReason of ["length", "content_filter"]) {
      const events = await output(
        kimiFixture({ calls: [{ id: "c", name: "read", arguments: '{"path":' }], finishReason }),
      );
      expect(last(events)).toMatchObject({
        type: "completed",
        stopReason: finishReason === "length" ? "max_tokens" : "refusal",
      });
      expect(
        events.some((event) => event.type === "completed" && event.stopReason === "tool_use"),
      ).toBe(false);
    }
  });
  it("keeps malformed argument JSON verbatim for common schema validation", async () => {
    const events = await output(
      kimiFixture({ calls: [{ id: "c", name: "read", arguments: '{"path":' }] }),
    );
    expect(
      events.find((event) => event.type === "part_completed" && event.part.type === "tool_call"),
    ).toMatchObject({ part: { rawArguments: '{"path":', argumentsSource: "verbatim" } });
  });
  it("rejects missing, changing, duplicate, or noncontiguous call identities", async () => {
    const variants = [
      (c: Event) => {
        delete c.id;
      },
      (c: Event) => {
        c.index = 1;
      },
      (c: Event) => {
        c.type = "server_tool";
      },
      (c: Event) => {
        (c.function as Event).name = "";
      },
    ];
    for (const mutate of variants) {
      const events = parse(tool());
      const calls = events.flatMap((event) =>
        (event.choices as Event[]).flatMap(
          (choice) => ((choice.delta as Event)?.tool_calls as Event[] | undefined) ?? [],
        ),
      );
      mutate(at(calls, 0));
      expect(last(await output(frame(events)))).toMatchObject({
        type: "error",
        error: { kind: "protocol" },
      });
    }
    const events = parse(tool());
    const callChunks = events.flatMap((event) =>
      (event.choices as Event[]).flatMap(
        (choice) => ((choice.delta as Event)?.tool_calls as Event[] | undefined) ?? [],
      ),
    );
    at(callChunks, 1).id = "other";
    expect(last(await output(frame(events)))).toMatchObject({
      type: "error",
      error: { kind: "protocol" },
    });
    expect(
      last(
        await output(
          kimiFixture({
            calls: [
              { id: "same", name: "read", arguments: "{}" },
              { id: "same", name: "read", arguments: "{}" },
            ],
          }),
        ),
      ),
    ).toMatchObject({ type: "error", error: { kind: "protocol" } });
  });
  it("distinguishes reused provider IDs by response ID and supports parallel calls", async () => {
    const get = async (responseId: string) =>
      (
        await output(
          kimiFixture({
            responseId,
            calls: [
              { id: "same", name: "read", arguments: "{}" },
              { id: "second", name: "read", arguments: "{}" },
            ],
          }),
        )
      ).flatMap((event) =>
        event.type === "part_completed" && event.part.type === "tool_call" ? [event.part] : [],
      );
    const a = await get("r1"),
      b = await get("r2");
    expect(a).toHaveLength(2);
    expect(a[0]?.callId).not.toBe(b[0]?.callId);
    expect(a[0]?.providerCallId).toBe(b[0]?.providerCallId);
  });
});

describe("Kimi history", () => {
  const call = {
    type: "tool_call",
    callId: "local1" as ToolCallId,
    providerCallId: "provider1",
    providerItemId: null,
    name: "read",
    rawArguments: '{ "x": 1 }',
    argumentsSource: "verbatim",
  } as const;
  const assistant: ModelMessage = {
    role: "assistant",
    stopReason: "tool_use",
    content: [{ type: "reasoning", kind: "visible", text: "full reasoning" }, call],
  };
  const result: ModelMessage = {
    role: "user",
    content: [
      {
        type: "tool_result",
        callId: call.callId,
        status: "succeeded",
        content: [
          { type: "text", text: "one" },
          { type: "text", text: "two" },
        ],
      },
    ],
  };
  it.each(["max_tokens", "cancelled", "error", undefined] as const)(
    "rejects interrupted/unproven stop %s",
    (stopReason) => {
      const altered = { ...assistant, stopReason } as unknown as ModelMessage;
      expect(() => buildKimiRequest({ ...request, messages: [altered, result] })).toThrow();
    },
  );
  it("rejects summaries, opaque reasoning, unfinished pairs and duplicate results", () => {
    for (const content of [
      [{ type: "reasoning", kind: "summary", text: "summary" }, call],
      [{ type: "reasoning", kind: "opaque" }, call],
    ])
      expect(() =>
        buildKimiRequest({
          ...request,
          messages: [{ ...assistant, content } as ModelMessage, result],
        }),
      ).toThrow();
    for (const messages of [
      [assistant],
      [result],
      [assistant, result, result],
      [assistant, at(request.messages, 0), result],
      [assistant, assistant, result],
    ])
      expect(() => buildKimiRequest({ ...request, messages })).toThrow();
  });
  it("preserves refusal text without sending an undocumented refusal input field", () => {
    const body = buildKimiRequest({
      ...request,
      messages: [
        {
          role: "assistant",
          stopReason: "refusal",
          content: [
            { type: "text", text: "I cannot. " },
            { type: "refusal", text: "Provider refused." },
          ],
        },
        request.messages[0] as ModelMessage,
      ],
    });
    expect((body.messages as Event[])[0]).toEqual({
      role: "assistant",
      content: "I cannot. \n\nProvider refused.",
    });
  });
  it("preserves semantic boundaries between separate assistant text parts", () => {
    const body = buildKimiRequest({
      ...request,
      messages: [
        {
          role: "assistant",
          stopReason: "end_turn",
          content: [
            { type: "text", text: "First paragraph." },
            { type: "text", text: "Second paragraph." },
          ],
        },
        request.messages[0] as ModelMessage,
      ],
    });
    expect((body.messages as Event[])[0]?.content).toBe("First paragraph.\n\nSecond paragraph.");
  });
  it("preserves text boundaries and result statuses, permits reused provider IDs in separate turns", () => {
    const next = { ...assistant, content: [{ ...call, callId: "local2" as ToolCallId }] };
    const nextResult: ModelMessage = {
      role: "user",
      content: [
        {
          type: "tool_result",
          callId: "local2" as ToolCallId,
          status: "unknown",
          content: [{ type: "text", text: "check before retrying" }],
        },
      ],
    };
    const body = buildKimiRequest({
      ...request,
      messages: [assistant, result, next, nextResult],
      toolChoice: "none",
    });
    expect(body).toMatchObject({
      tool_choice: "none",
      messages: [
        { role: "assistant", reasoning_content: "full reasoning" },
        {
          role: "tool",
          tool_call_id: "provider1",
          content: "Tool result status: succeeded\n\none\n\ntwo",
        },
        {
          role: "assistant",
          tool_calls: [{ id: "provider1", function: { arguments: '{ "x": 1 }' } }],
        },
        { role: "tool", content: "Tool result status: unknown\n\ncheck before retrying" },
      ],
    });
  });
});
