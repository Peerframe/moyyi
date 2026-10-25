import { describe, expect, it } from "vitest";
import type { ModelRequest, ModelStreamEvent } from "../../contracts/index.ts";
import { checkModelStream, UNKNOWN_USAGE } from "../../contracts/index.ts";
import { ScriptedModelClient } from "./client.ts";

const request: ModelRequest = {
  origin: { provider: "scripted", model: "test" },
  system: [],
  messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
  tools: [],
  maxOutputTokens: 100,
};

async function collect(stream: AsyncIterable<ModelStreamEvent>): Promise<ModelStreamEvent[]> {
  const out: ModelStreamEvent[] = [];
  for await (const event of stream) out.push(event);
  return out;
}

function cancelled(partialOutput: boolean): ModelStreamEvent {
  return {
    type: "error",
    error: { kind: "cancelled", message: "aborted", partialOutput, usage: UNKNOWN_USAGE },
  };
}

const done: ModelStreamEvent = {
  type: "completed",
  stopReason: "end_turn",
  providerStopReason: null,
  usage: UNKNOWN_USAGE,
};

describe("ScriptedModelClient", () => {
  it("replays responses in order and records requests", async () => {
    const client = new ScriptedModelClient([
      [{ type: "text_delta", index: 0, text: "a" }],
      [{ type: "text_delta", index: 0, text: "b" }],
    ]);
    const first = await collect(client.stream(request, new AbortController().signal));
    const second = await collect(client.stream(request, new AbortController().signal));
    expect(first).toEqual([{ type: "text_delta", index: 0, text: "a" }]);
    expect(second).toEqual([{ type: "text_delta", index: 0, text: "b" }]);
    expect(client.requests).toHaveLength(2);
    expect(client.remaining).toBe(0);
  });

  it("stops with a cancelled error once aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const client = new ScriptedModelClient([[{ type: "text_delta", index: 0, text: "a" }]]);
    const events = await collect(client.stream(request, controller.signal));
    expect(events).toEqual([cancelled(false)]);
    expect(checkModelStream(events)).toEqual([]);
  });

  it("reports cancellation even for an empty aborted script", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await collect(new ScriptedModelClient([[]]).stream(request, controller.signal))).toEqual(
      [cancelled(false)],
    );
  });

  it("does not emit an event cancelled while awaiting its next yield", async () => {
    const controller = new AbortController();
    const client = new ScriptedModelClient([
      [{ type: "text_delta", index: 0, text: "late" }, done],
    ]);
    const iterator = client.stream(request, controller.signal)[Symbol.asyncIterator]();
    const pending = iterator.next();
    controller.abort();
    expect(await pending).toEqual({ value: cancelled(false), done: false });
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
  });

  it.each([
    { type: "text_delta", index: 0, text: "partial" },
    { type: "refusal_delta", index: 0, text: "Cannot" },
    { type: "reasoning_delta", index: 0, kind: "summary", text: "thinking" },
    { type: "tool_call_delta", index: 0, argumentsDelta: '{"path":' },
    { type: "part_completed", index: 0, part: { type: "text", text: "done" } },
  ] satisfies ModelStreamEvent[])(
    "reports partial output after $type cancellation",
    async (output) => {
      const controller = new AbortController();
      const client = new ScriptedModelClient([[output, done]]);
      const iterator = client.stream(request, controller.signal)[Symbol.asyncIterator]();
      expect(await iterator.next()).toEqual({ value: output, done: false });
      controller.abort();
      expect(await iterator.next()).toEqual({ value: cancelled(true), done: false });
      expect(await iterator.next()).toEqual({ value: undefined, done: true });
      expect(checkModelStream([output, cancelled(true)])).toEqual([]);
    },
  );

  it("retains partial-output cancellation when no scripted event remains", async () => {
    const controller = new AbortController();
    const output = { type: "text_delta", index: 0, text: "partial" } as const;
    const client = new ScriptedModelClient([[output]]);
    const iterator = client.stream(request, controller.signal)[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ value: output, done: false });
    controller.abort();
    expect(await iterator.next()).toEqual({ value: cancelled(true), done: false });
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
  });

  it.each([done, cancelled(false)])(
    "does not append cancellation after a $type terminal",
    async (terminal) => {
      const controller = new AbortController();
      const client = new ScriptedModelClient([[terminal]]);
      const iterator = client.stream(request, controller.signal)[Symbol.asyncIterator]();
      expect(await iterator.next()).toEqual({ value: terminal, done: false });
      controller.abort();
      expect(await iterator.next()).toEqual({ value: undefined, done: true });
    },
  );

  it("preserves malformed scripted streams for fault injection", async () => {
    const malformed = [
      done,
      { type: "text_delta", index: 0, text: "late" } satisfies ModelStreamEvent,
    ];
    const client = new ScriptedModelClient([malformed]);
    const events = await collect(client.stream(request, new AbortController().signal));
    expect(events).toEqual(malformed);
    expect(checkModelStream(events)).toEqual(["events after the terminal event at position 0"]);
  });

  it("fails loudly when the script is exhausted", async () => {
    const client = new ScriptedModelClient([]);
    await expect(collect(client.stream(request, new AbortController().signal))).rejects.toThrow(
      /no scripted response/,
    );
  });
});
