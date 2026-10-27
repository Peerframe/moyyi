import { describe, expect, it } from "vitest";
import { parseKimiSse } from "./sse.ts";

async function decode(bytes: readonly Uint8Array[]) {
  const values: unknown[] = [];
  const input = {
    async *[Symbol.asyncIterator]() {
      yield* bytes;
    },
  };
  for await (const value of parseKimiSse(input, new AbortController().signal)) values.push(value);
  return values;
}
const enc = (value: string) => new TextEncoder().encode(value);
describe("Kimi bounded SSE framing", () => {
  it("decodes split multibyte UTF-8, CR/LF/CRLF and DONE", async () => {
    const bytes = enc(
      ': comment\r\nevent: message\r\ndata: {"text":"中文😀"}\r\n\r\ndata: [DONE]\r\r',
    );
    expect(await decode([...bytes].map((byte) => Uint8Array.of(byte)))).toEqual([
      { text: "中文😀" },
      "[DONE]",
    ]);
  });
  it("accepts multiline JSON data and ignores id/retry without reconnecting", async () => {
    expect(
      await decode([enc('id: x\nretry: 1\ndata: {\ndata: "x": 1}\n\ndata: [DONE]\n\n')]),
    ).toEqual([{ x: 1 }, "[DONE]"]);
  });
  it.each([
    'data: {"x":1,"x":2}\n\n',
    'data: {"x":"\\ud800"}\n\n',
    "data: NaN\n\n",
    "event: error\ndata: {}\n\n",
    `data: {"x":"${"a".repeat(1024 * 1024)}"}\n\n`,
  ])("rejects invalid or oversized JSON/frame", async (text) => {
    await expect(decode([enc(text)])).rejects.toMatchObject({ kind: "protocol" });
  });
  it("rejects invalid UTF-8 and unfinished events", async () => {
    await expect(decode([Uint8Array.of(0xff)])).rejects.toMatchObject({ kind: "protocol" });
    await expect(decode([enc('data: {"x":1}\n')])).rejects.toMatchObject({
      kind: "stream_interrupted",
    });
    await expect(decode([enc('data: {"x":1}')])).rejects.toMatchObject({
      kind: "stream_interrupted",
    });
  });
  it("bounds total bytes and total event count", async () => {
    await expect(
      decode(Array.from({ length: 9 }, () => enc(`${":a\n".repeat(350_000)}`))),
    ).rejects.toMatchObject({ kind: "protocol" });
    await expect(decode([enc("data: {}\n\n".repeat(100_001))])).rejects.toMatchObject({
      kind: "protocol",
    });
  });
});
