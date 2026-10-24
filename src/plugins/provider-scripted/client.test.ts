import { describe, expect, it } from "vitest";
import type { ModelRequest, ModelStreamEvent } from "../../contracts/index.ts";
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
    expect(events).toEqual([
      { type: "error", error: { kind: "cancelled", message: "aborted", partialOutput: false } },
    ]);
  });

  it("fails loudly when the script is exhausted", async () => {
    const client = new ScriptedModelClient([]);
    await expect(collect(client.stream(request, new AbortController().signal))).rejects.toThrow(
      /no scripted response/,
    );
  });
});
