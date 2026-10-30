import { describe, expect, it, vi } from "vitest";
import {
  checkModelStream,
  type ModelRequest,
  type ModelStreamEvent,
} from "../../contracts/index.ts";
import { deepSeekFixtureSse, deepSeekTextFixture, deepSeekToolFixture } from "./fixtures.ts";
import { createDeepSeekClient, type DeepSeekTransport, deepSeekProfile } from "./index.ts";

const request: ModelRequest = {
  origin: deepSeekProfile.origin,
  system: [],
  messages: [{ role: "user", content: [{ type: "text", text: "Read README.md" }] }],
  tools: [{ name: "read", description: "Read", inputSchema: { type: "object" } }],
  maxOutputTokens: 512,
};
async function collect(
  transport: DeepSeekTransport,
  input = request,
  signal = new AbortController().signal,
) {
  const events: ModelStreamEvent[] = [];
  for await (const event of createDeepSeekClient(transport).stream(input, signal))
    events.push(event);
  expect(checkModelStream(events)).toEqual([]);
  return events;
}
function wire(
  text: string,
  status = 200,
  contentType = "text/event-stream",
  retryAfter: string | null = null,
) {
  const close = vi.fn(async () => {});
  const transport = vi.fn<DeepSeekTransport>(async () => ({
    status,
    contentType,
    retryAfter,
    close,
    body: {
      async *[Symbol.asyncIterator]() {
        yield new TextEncoder().encode(text);
      },
    },
  }));
  return { transport, close };
}
describe("DeepSeek provider", () => {
  it.each([{ fixture: deepSeekTextFixture() }, { fixture: deepSeekToolFixture() }])(
    "decodes a complete synthetic wire response",
    async ({ fixture }) => {
      const { transport, close } = wire(deepSeekFixtureSse(fixture));
      const events = await collect(transport);
      expect(events.at(-1)?.type).toBe("completed");
      expect(transport).toHaveBeenCalledTimes(1);
      expect(close).toHaveBeenCalledTimes(1);
      expect(JSON.parse(transport.mock.calls[0]?.[0] ?? "")).toMatchObject({
        model: "deepseek-flash",
        stream: true,
      });
    },
  );
  it.each([
    [400, "invalid_request"],
    [401, "auth"],
    [402, "quota"],
    [403, "auth"],
    [422, "invalid_request"],
    [429, "rate_limited"],
    [500, "overloaded"],
    [502, "overloaded"],
    [503, "overloaded"],
    [504, "overloaded"],
    [599, "overloaded"],
    [600, "protocol"],
    [302, "protocol"],
  ] as const)("classifies HTTP %i without retries or echoing its body", async (status, kind) => {
    const { transport, close } = wire(
      "secret-bearing server diagnostic",
      status,
      "application/json",
      "120",
    );
    const events = await collect(transport);
    expect(events).toMatchObject([
      { type: "error", error: { kind, partialOutput: false, retryAfterMs: 30000 } },
    ]);
    expect(JSON.stringify(events)).not.toContain("secret-bearing");
    expect(transport).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("rejects wrong content type and malformed framing", async () => {
    for (const { transport } of [wire("{}", 200, "application/json"), wire("data: [DONE]\n\n")]) {
      expect(await collect(transport)).toMatchObject([
        { type: "error", error: { kind: "protocol" } },
      ]);
    }
  });
  it("preserves partial output at EOF without retrying", async () => {
    const fixture = deepSeekTextFixture();
    const { transport } = wire(deepSeekFixtureSse(fixture.slice(0, -1)));
    const events = await collect(transport);
    expect(events.at(-1)).toMatchObject({
      type: "error",
      error: { kind: "stream_interrupted", partialOutput: true },
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("rejects unsupported model before transport", async () => {
    const { transport } = wire("");
    expect(
      await collect(transport, { ...request, origin: { ...request.origin, model: "other" } }),
    ).toMatchObject([{ type: "error", error: { kind: "invalid_request" } }]);
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([null, "auto", "required", false, { type: "none" }])(
    "rejects unsupported common tool choice %j before transport",
    async (toolChoice) => {
      const { transport } = wire("");
      expect(
        await collect(transport, { ...request, toolChoice } as unknown as ModelRequest),
      ).toMatchObject([{ type: "error", error: { kind: "invalid_request" } }]);
      expect(transport).not.toHaveBeenCalled();
    },
  );
  it("cancels before transport", async () => {
    const controller = new AbortController();
    controller.abort();
    const { transport } = wire("");
    expect(await collect(transport, request, controller.signal)).toMatchObject([
      { type: "error", error: { kind: "cancelled" } },
    ]);
    expect(transport).not.toHaveBeenCalled();
  });
  it("does not leak host errors or double-complete after cleanup failure", async () => {
    const fail = vi.fn<DeepSeekTransport>(async () => {
      throw Error("Bearer secret");
    });
    const events = await collect(fail);
    expect(events).toMatchObject([{ type: "error", error: { kind: "network" } }]);
    expect(JSON.stringify(events)).not.toContain("secret");
    const { transport, close } = wire(deepSeekFixtureSse(deepSeekTextFixture()));
    close.mockRejectedValue(Error("secret"));
    expect(
      (await collect(transport)).filter((e) => e.type === "completed" || e.type === "error"),
    ).toHaveLength(1);
  });
});
