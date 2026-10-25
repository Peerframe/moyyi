import { describe, expect, it } from "vitest";
import { parseAnthropicSse } from "./sse.ts";

async function* chunks(text: string, size = 1) {
  const bytes = new TextEncoder().encode(text);
  for (let i = 0; i < bytes.length; i += size) yield bytes.slice(i, i + size);
}
async function collect(input: AsyncIterable<Uint8Array>, signal = new AbortController().signal) {
  const result: unknown[] = [];
  for await (const value of parseAnthropicSse(input, signal)) result.push(value);
  return result;
}
describe("Anthropic SSE framing", () => {
  it.each(["\n", "\r\n", "\r"])("handles chunked UTF-8, BOM, comments and %j lines", async (nl) => {
    const wire = [
      "\ufeff: keepalive",
      "retry: 0",
      "id: ignored",
      "event: x",
      'data: {"type":"x",',
      'data: "text":"中文😀"}',
      "",
      "",
    ].join(nl);
    expect(await collect(chunks(wire))).toEqual([{ type: "x", text: "中文😀" }]);
  });
  it("accepts unnamed events and trailing keepalive without reconnecting", async () => {
    expect(await collect(chunks('data: {"type":"x"}\n\n: idle'))).toEqual([{ type: "x" }]);
  });
  it.each([
    'event: other\ndata: {"type":"x"}\n\n',
    'data: {"type":"x","type":"y"}\n\n',
    'data: {"type":"x","value":1e999}\n\n',
    'data: {"type":"x","text":"\\ud800"}\n\n',
    "data: [DONE]\n\n",
  ])("rejects ambiguous or malformed payload %j", async (wire) => {
    await expect(collect(chunks(wire))).rejects.toMatchObject({ kind: "protocol" });
  });
  it.each(['data: {"type":"x"}', 'data: {"type":"x"}\n', "event: x\n"])(
    "never dispatches unfinished EOF data %j",
    async (wire) => {
      await expect(collect(chunks(wire))).rejects.toMatchObject({ kind: "stream_interrupted" });
    },
  );
  it("rejects malformed UTF-8", async () => {
    async function* invalid() {
      yield new Uint8Array([0xc3, 0x28]);
    }
    await expect(collect(invalid())).rejects.toMatchObject({ kind: "protocol" });
  });
  it("bounds an unbroken frame", async () => {
    await expect(collect(chunks(`data: ${"x".repeat(1024 * 1024)}`, 8192))).rejects.toMatchObject({
      kind: "protocol",
    });
  });
  it("bounds the whole stream including comments", async () => {
    async function* oversized() {
      yield new Uint8Array(8 * 1024 * 1024 + 1);
    }
    await expect(collect(oversized())).rejects.toMatchObject({ kind: "protocol" });
  });
  it("cancels a stalled producer and requests cleanup", async () => {
    let closed = false;
    const stalled: AsyncIterable<Uint8Array> = {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise(() => {}),
          return: async () => {
            closed = true;
            return { done: true, value: undefined };
          },
        };
      },
    };
    const controller = new AbortController();
    const pending = collect(stalled, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ kind: "cancelled" });
    expect(closed).toBe(true);
  });
});
