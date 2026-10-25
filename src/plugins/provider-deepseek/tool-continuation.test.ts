import { describe, expect, it, vi } from "vitest";
import {
  type ContentPart,
  checkModelStream,
  type ModelMessage,
  type ModelRequest,
  type ModelStreamEvent,
  type StopReason,
} from "../../contracts/index.ts";
import { buildDeepSeekRequest, decodeDeepSeekEvents, deepSeekProfile } from "./codec.ts";
import { deepSeekFixture, deepSeekFixtureSse, type FixtureOptions } from "./fixtures.ts";
import { createDeepSeekClient, type DeepSeekTransport } from "./index.ts";

type WireEvent = Record<string, unknown>;
type Stage = "added" | "done" | "terminal";
const stages: readonly Stage[] = ["added", "done", "terminal"];
const before = "I will inspect the synthetic files. 世界 🙂";
const after = "The requested reads are queued.";
const reasoning = "Preserve this complete synthetic reasoning.\nExactly as emitted.";
const args = '{ "path": "README.md" }';

function request(messages: readonly ModelMessage[] = []): ModelRequest {
  return {
    origin: deepSeekProfile.origin,
    system: [],
    messages: [
      { role: "user", content: [{ type: "text", text: "Read the synthetic files." }] },
      ...messages,
    ],
    tools: [{ name: "read", description: "Read text", inputSchema: { type: "object" } }],
    maxOutputTokens: 512,
  };
}

function messagesAt(wire: WireEvent[], stage: Stage): WireEvent[] {
  const terminal = wire.at(-1);
  if (!terminal) throw Error("Fixture has no terminal");
  const items =
    stage === "terminal"
      ? ((terminal.response as WireEvent).output as WireEvent[])
      : wire
          .filter((event) => event.type === `response.output_item.${stage}`)
          .map((event) => event.item as WireEvent);
  return items.filter((item) => item.type === "message");
}

function messageAt(wire: WireEvent[], stage: Stage): WireEvent {
  const message = messagesAt(wire, stage)[0];
  if (!message) throw Error(`Fixture has no ${stage} message`);
  return message;
}

function setPhase(wire: WireEvent[], stage: Stage, phase: unknown): void {
  const message = messageAt(wire, stage);
  if (phase === undefined) delete message.phase;
  else message.phase = phase;
}

function toolTurn(withReasoning = false, options: FixtureOptions = {}): WireEvent[] {
  const wire = deepSeekFixture(
    [
      ...(withReasoning ? [{ type: "reasoning" as const, text: reasoning }] : []),
      { type: "message", text: before },
      { type: "function_call", callId: "synthetic_read_a", name: "read", arguments: args },
      {
        type: "function_call",
        callId: "synthetic_read_b",
        name: "read",
        arguments: '{"path":"src/main.ts"}',
      },
      { type: "message", text: after },
    ],
    options,
  );
  for (const stage of stages)
    for (const message of messagesAt(wire, stage))
      message.phase = stage === "added" ? "final_answer" : "commentary";
  return wire;
}

async function collect(events: AsyncIterable<ModelStreamEvent>): Promise<ModelStreamEvent[]> {
  const result: ModelStreamEvent[] = [];
  for await (const event of events) result.push(event);
  expect(checkModelStream(result)).toEqual([]);
  expect(
    result.filter((event) => event.type === "completed" || event.type === "error"),
  ).toHaveLength(1);
  return result;
}

async function decode(wire: WireEvent[]): Promise<ModelStreamEvent[]> {
  async function* source() {
    yield* wire;
  }
  return collect(decodeDeepSeekEvents(source(), new AbortController().signal));
}

function parts(events: ModelStreamEvent[]): ContentPart[] {
  return events
    .filter((event) => event.type === "part_completed")
    .sort((a, b) => a.index - b.index)
    .map((event) => event.part);
}

function history(content: readonly ContentPart[]): readonly ModelMessage[] {
  const calls = content.filter((part) => part.type === "tool_call");
  return [
    { role: "assistant", stopReason: "tool_use", content },
    {
      role: "user",
      content: [...calls].reverse().map((call) => ({
        type: "tool_result",
        callId: call.callId,
        status: "succeeded",
        content: [{ type: "text", text: `Synthetic result for ${call.providerCallId}.` }],
      })),
    },
  ];
}

function source(wire: WireEvent[]) {
  const close = vi.fn(async () => {});
  const transport = vi.fn<DeepSeekTransport>(async () => ({
    status: 200,
    contentType: "text/event-stream",
    retryAfter: null,
    close,
    body: {
      async *[Symbol.asyncIterator]() {
        const bytes = new TextEncoder().encode(deepSeekFixtureSse(wire));
        for (let index = 0; index < bytes.length; index += 7) yield bytes.slice(index, index + 7);
      },
    },
  }));
  return { transport, close };
}

function expectError(events: ModelStreamEvent[], kind = "protocol"): void {
  expect(events.at(-1)).toMatchObject({ type: "error", error: { kind } });
  expect(events.some((event) => event.type === "completed")).toBe(false);
}

describe("DeepSeek commentary and complete tool history", () => {
  it.each([false, true])(
    "round-trips commentary and tool results with reasoning=%s",
    async (hasReasoning) => {
      const wire = toolTurn(hasReasoning);
      const { transport, close } = source(wire);
      const events = await collect(
        createDeepSeekClient(transport).stream(request(), new AbortController().signal),
      );
      expect(events.at(-1)).toMatchObject({ type: "completed", stopReason: "tool_use" });
      expect(transport).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
      const content = parts(events);
      expect(content.map((part) => part.type)).toEqual([
        ...(hasReasoning ? ["reasoning"] : []),
        "text",
        "tool_call",
        "tool_call",
        "text",
      ]);
      expect(content.filter((part) => part.type === "text")).toEqual([
        { type: "text", text: before },
        { type: "text", text: after },
      ]);
      const next = buildDeepSeekRequest(request(history(content)));
      const input = next.input as WireEvent[];
      expect(input.filter((item) => item.type === "reasoning")).toEqual(
        hasReasoning
          ? [{ type: "reasoning", content: [{ type: "reasoning_text", text: reasoning }] }]
          : [],
      );
      expect(input.filter((item) => item.type === "function_call")).toEqual([
        { type: "function_call", call_id: "synthetic_read_a", name: "read", arguments: args },
        {
          type: "function_call",
          call_id: "synthetic_read_b",
          name: "read",
          arguments: '{"path":"src/main.ts"}',
        },
      ]);
      expect(
        input.filter((item) => item.type === "function_call_output").map((item) => item.call_id),
      ).toEqual(["synthetic_read_b", "synthetic_read_a"]);
      expect(JSON.stringify({ events, next })).not.toContain('"phase"');
      expect(JSON.stringify(next)).not.toContain('"replay"');
    },
  );

  it("preserves output order when parallel calls finish in reverse order", async () => {
    const wire = toolTurn();
    const callEvents = wire.filter((event) => event.output_index === 1 || event.output_index === 2);
    const rest = wire.filter((event) => event.output_index !== 1 && event.output_index !== 2);
    const first = callEvents.filter((event) => event.output_index === 1);
    const second = callEvents.filter((event) => event.output_index === 2);
    const insertion = rest.findIndex((event) => event.output_index === 3);
    rest.splice(insertion, 0, first[0] as WireEvent, ...second, ...first.slice(1));
    rest.forEach((event, index) => {
      event.sequence_number = index;
    });
    const events = await decode(rest);
    expect(events.at(-1)).toMatchObject({ type: "completed", stopReason: "tool_use" });
    const emittedCallIndices = events.flatMap((event) =>
      event.type === "part_completed" && event.part.type === "tool_call" ? [event.index] : [],
    );
    expect(emittedCallIndices).toEqual([2048, 1024]);
    const next = buildDeepSeekRequest(request(history(parts(events))));
    expect(
      (next.input as WireEvent[])
        .filter((item) => item.type === "function_call")
        .map((item) => item.call_id),
    ).toEqual(["synthetic_read_a", "synthetic_read_b"]);
  });

  it("continues a complete ordinary answer without inventing reasoning", async () => {
    const events = await decode(
      deepSeekFixture([{ type: "message", text: "Synthetic final answer." }]),
    );
    expect(events.at(-1)).toMatchObject({ type: "completed", stopReason: "end_turn" });
    const next = buildDeepSeekRequest(
      request([
        { role: "assistant", stopReason: "end_turn", content: parts(events) },
        { role: "user", content: [{ type: "text", text: "Now read another file." }] },
      ]),
    );
    expect((next.input as WireEvent[]).some((item) => item.type === "reasoning")).toBe(false);
    expect(JSON.stringify(next)).toContain("Synthetic final answer.");
  });

  it("retains an explicitly empty visible reasoning part without using it as a proof", () => {
    const next = buildDeepSeekRequest(
      request([
        {
          role: "assistant",
          stopReason: "end_turn",
          content: [
            { type: "reasoning", kind: "visible", text: "" },
            { type: "text", text: "Done." },
          ],
        },
      ]),
    );
    expect((next.input as WireEvent[]).filter((item) => item.type === "reasoning")).toEqual([
      { type: "reasoning", content: [{ type: "reasoning_text", text: "" }] },
    ]);
  });

  it.each([undefined, "interrupted", "max_tokens", "refusal", "other", "synthetic_unknown"])(
    "rejects unproven history %s before HTTP with and without offered tools",
    async (stopReason) => {
      const content = parts(await decode(toolTurn()));
      const result = history(content)[1];
      for (const tools of [request().tools, []]) {
        const { transport } = source([]);
        const input = request([
          {
            role: "assistant",
            content,
            ...(stopReason === undefined ? {} : { stopReason: stopReason as StopReason }),
          },
          result as ModelMessage,
        ]);
        const events = await collect(
          createDeepSeekClient(transport).stream({ ...input, tools }, new AbortController().signal),
        );
        expectError(events, "invalid_request");
        expect(transport).not.toHaveBeenCalled();
      }
    },
  );

  it.each(["summary", "opaque"] as const)("rejects %s history before HTTP", async (kind) => {
    const content: ContentPart[] = [
      kind === "opaque"
        ? { type: "reasoning", kind }
        : { type: "reasoning", kind, text: "Summary" },
      { type: "text", text: "Answer" },
    ];
    const { transport } = source([]);
    const events = await collect(
      createDeepSeekClient(transport).stream(
        request([{ role: "assistant", stopReason: "end_turn", content }]),
        new AbortController().signal,
      ),
    );
    expectError(events, "invalid_request");
    expect(transport).not.toHaveBeenCalled();
  });

  it.each(["created call", "completed call"])(
    "does not complete an SSE prefix ending after %s",
    async (ending) => {
      const wire = toolTurn();
      const last = wire.findIndex(
        (event) =>
          event.output_index === 1 &&
          event.type === `response.output_item.${ending === "created call" ? "added" : "done"}`,
      );
      const { transport, close } = source(wire.slice(0, last + 1));
      const events = await collect(
        createDeepSeekClient(transport).stream(request(), new AbortController().signal),
      );
      expectError(events, "stream_interrupted");
      expect(parts(events)).toContainEqual({ type: "text", text: before });
      expect(events.at(-1)).toMatchObject({ error: { partialOutput: true } });
      expect(close).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["incomplete", "max_output_tokens", "max_tokens"],
    ["incomplete", "content_filter", "refusal"],
    ["failed", undefined, undefined],
  ] as const)(
    "preserves response %s/%s after commentary and completed calls",
    async (status, incompleteReason, stopReason) => {
      const events = await decode(
        toolTurn(false, { status, ...(incompleteReason ? { incompleteReason } : {}) }),
      );
      if (status === "failed") expectError(events, "overloaded");
      else expect(events.at(-1)).toMatchObject({ type: "completed", stopReason });
    },
  );
});

describe("DeepSeek commentary lifecycle validation", () => {
  it.each([undefined, null, "final_answer", "commentary"])(
    "accepts provisional added phase %s",
    async (phase) => {
      const wire = toolTurn();
      setPhase(wire, "added", phase);
      expect((await decode(wire)).at(-1)).toMatchObject({
        type: "completed",
        stopReason: "tool_use",
      });
    },
  );

  it("allows the terminal to finalize commentary when item.done was omitted", async () => {
    const wire = toolTurn().filter((event) => event.type !== "response.output_item.done");
    expect((await decode(wire)).at(-1)).toMatchObject({
      type: "completed",
      stopReason: "tool_use",
    });
  });

  it.each([undefined, null])(
    "accepts omitted phase %s after completed commentary",
    async (phase) => {
      const wire = toolTurn();
      setPhase(wire, "terminal", phase);
      expect((await decode(wire)).at(-1)).toMatchObject({
        type: "completed",
        stopReason: "tool_use",
      });
    },
  );

  it.each([undefined, null])(
    "accepts terminal commentary after an unannotated %s item",
    async (phase) => {
      const wire = toolTurn();
      setPhase(wire, "done", phase);
      expect((await decode(wire)).at(-1)).toMatchObject({
        type: "completed",
        stopReason: "tool_use",
      });
    },
  );

  it.each([
    ["commentary", "final_answer"],
    ["final_answer", "commentary"],
  ])("rejects explicit completed phase changing from %s to %s", async (done, terminal) => {
    const wire = toolTurn();
    messageAt(wire, "done").phase = done;
    messageAt(wire, "terminal").phase = terminal;
    expectError(await decode(wire));
  });

  describe.each(stages)("validates %s snapshots", (stage) => {
    it.each(["synthetic_unknown", "", 1, false, ["commentary"], { phase: "commentary" }])(
      "rejects invalid phase %j",
      async (phase) => {
        const wire = toolTurn();
        messageAt(wire, stage).phase = phase;
        expectError(await decode(wire));
      },
    );
  });

  describe.each(["done", "terminal"] as const)("preserves tamper guards at %s", (stage) => {
    it.each(["id", "text", "role", "status"])("rejects changed %s", async (field) => {
      const wire = toolTurn();
      const item = messageAt(wire, stage);
      if (field === "id") item.id = "synthetic_changed_id";
      if (field === "text")
        item.content = [{ type: "output_text", text: "Changed synthetic text." }];
      if (field === "role") item.role = "user";
      if (field === "status") item.status = "in_progress";
      expectError(await decode(wire));
    });
  });

  it("rejects terminal loss of observed reasoning instead of treating it as absent", async () => {
    const wire = toolTurn(true);
    const terminal = wire.at(-1)?.response as WireEvent;
    (terminal.output as WireEvent[]).shift();
    expectError(await decode(wire));
  });
});
