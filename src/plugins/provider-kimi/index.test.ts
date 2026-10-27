import { describe, expect, it, vi } from "vitest";
import {
  checkModelStream,
  type ModelRequest,
  type ModelStreamEvent,
  UNKNOWN_USAGE,
} from "../../contracts/index.ts";
import { kimiFixture, kimiFixtureTransport } from "./fixtures.ts";
import {
  createKimiClient,
  createKimiPlugin,
  type KimiTransport,
  kimiApiProfile,
  kimiProfile,
  resolveKimiReasoningEffort,
} from "./index.ts";

const request: ModelRequest = {
  origin: kimiProfile.origin,
  system: [],
  messages: [{ role: "user", content: [{ type: "text", text: "Read README.md" }] }],
  tools: [{ name: "read", description: "Read a file", inputSchema: { type: "object" } }],
  maxOutputTokens: 512,
};

async function collect(
  transport: KimiTransport,
  input = request,
  signal = new AbortController().signal,
) {
  const events: ModelStreamEvent[] = [];
  for await (const event of createKimiClient(transport).stream(input, signal)) events.push(event);
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
  const transport = vi.fn<KimiTransport>(async () => ({
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

describe("Kimi provider transport", () => {
  it.each([
    { text: "Synthetic answer.", reasoning: "Check the evidence." },
    {
      reasoning: "Read the file.",
      calls: [{ id: "call1", name: "read", arguments: '{ "path": "README.md" }' }],
    },
  ])("conforms to the common stream contract for %j", async (fixture) => {
    const { transport, close } = wire(kimiFixture(fixture));
    const events = await collect(transport);
    expect(events.at(-1)).toMatchObject({
      type: "completed",
      usage: {
        status: "final",
        inputTokens: 20,
        outputTokens: 8,
        cacheReadTokens: 3,
        cacheWriteTokens: 2,
        reasoningTokens: 4,
      },
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(JSON.parse(transport.mock.calls[0]?.[0] ?? "")).toMatchObject({
      model: "kimi-k3.1-pro",
      stream: true,
      n: 1,
      max_completion_tokens: 512,
      reasoning_effort: "low",
      stream_options: { include_usage: true },
    });
  });
  it.each([
    [400, "invalid_request"],
    [401, "auth"],
    [402, "auth"],
    [403, "auth"],
    [404, "invalid_request"],
    [413, "invalid_request"],
    [422, "invalid_request"],
    [429, "rate_limited"],
    [500, "overloaded"],
    [503, "overloaded"],
    [302, "protocol"],
  ] as const)("classifies HTTP %i without a retry or diagnostic leak", async (status, kind) => {
    const { transport, close } = wire("Bearer secret response", status, "application/json", "120");
    const events = await collect(transport);
    expect(events).toMatchObject([
      {
        type: "error",
        error: { kind, partialOutput: false, retryAfterMs: 30_000, usage: UNKNOWN_USAGE },
      },
    ]);
    expect(JSON.stringify(events)).not.toContain("secret");
    expect(transport).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("rejects unsupported inputs before transport", async () => {
    const invalid = [
      { ...request, origin: { provider: "kimi", model: "kimi-k3.1-pro-highspeed" } },
      { ...request, origin: { provider: "deepseek", model: "kimi-k3.1-pro" } },
      { ...request, maxOutputTokens: 8193 },
      { ...request, maxOutputTokens: 0 },
      { ...request, maxOutputTokens: 1.1 },
      { ...request, toolChoice: "required" },
      { ...request, toolChoice: null },
      { ...request, messages: [], system: [] },
      {
        ...request,
        messages: [
          { role: "user", content: [{ type: "image", mediaType: "image/png", blob: "x" }] },
        ],
      },
      { ...request, tools: [...request.tools, ...request.tools] },
    ];
    for (const input of invalid) {
      const { transport } = wire("");
      expect(await collect(transport, input as ModelRequest)).toMatchObject([
        { type: "error", error: { kind: "invalid_request" } },
      ]);
      expect(transport).not.toHaveBeenCalled();
    }
  });
  it("fails closed for non-SSE or oversized requests", async () => {
    expect(await collect(wire("{}", 200, "application/json").transport)).toMatchObject([
      { type: "error", error: { kind: "protocol" } },
    ]);
    const { transport } = wire("");
    expect(
      await collect(transport, {
        ...request,
        system: [{ type: "text", text: "x".repeat(4 * 1024 * 1024) }],
      }),
    ).toMatchObject([{ type: "error", error: { kind: "invalid_request" } }]);
    expect(transport).not.toHaveBeenCalled();
  });
  it("cancels before transport and while waiting for a body chunk", async () => {
    const controller = new AbortController();
    controller.abort();
    const { transport } = wire("");
    expect(await collect(transport, request, controller.signal)).toMatchObject([
      { type: "error", error: { kind: "cancelled" } },
    ]);
    expect(transport).not.toHaveBeenCalled();
    const waiting = new AbortController(),
      close = vi.fn(async () => {});
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const pending: KimiTransport = async () => ({
      status: 200,
      contentType: "text/event-stream",
      retryAfter: null,
      close,
      body: {
        [Symbol.asyncIterator]() {
          return {
            next: async () => {
              started();
              return new Promise<IteratorResult<Uint8Array>>(() => {});
            },
          };
        },
      },
    });
    const output = collect(pending, request, waiting.signal);
    await ready;
    waiting.abort();
    expect(await output).toMatchObject([{ type: "error", error: { kind: "cancelled" } }]);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("redacts transport failures and does not double-complete on cleanup failure", async () => {
    const failure: KimiTransport = async () => {
      throw Error("Bearer private-key");
    };
    const output = await collect(failure);
    expect(output).toMatchObject([{ type: "error", error: { kind: "network" } }]);
    expect(JSON.stringify(output)).not.toContain("private-key");
    const { transport, close } = wire(kimiFixture({ text: "ok" }));
    close.mockRejectedValue(Error("private-key"));
    expect(
      (await collect(transport)).filter(
        (event) => event.type === "error" || event.type === "completed",
      ),
    ).toHaveLength(1);
  });
  it("has stable effort-specific replay profiles and rejects unsupported effort", () => {
    expect(resolveKimiReasoningEffort(undefined)).toBe("low");
    for (const effort of ["low", "high", "max"] as const)
      expect(kimiApiProfile(effort)).toContain(`reasoning-${effort}`);
    for (const effort of ["none", "medium", "LOW", null, {}, 1])
      expect(() => resolveKimiReasoningEffort(effort)).toThrow("low, high or max");
    expect(() =>
      createKimiClient(wire("").transport, { reasoningEffort: "none" as "low" }),
    ).toThrow();
  });
  it("registers only the supported model during setup", () => {
    const registerModelProvider = vi.fn();
    const plugin = createKimiPlugin(wire("").transport);
    plugin.setup({ config: undefined, registerModelProvider } as unknown as Parameters<
      typeof plugin.setup
    >[0]);
    expect(registerModelProvider).toHaveBeenCalledTimes(1);
    const provider = registerModelProvider.mock.calls[0]?.[0];
    expect(provider).toMatchObject({ id: "kimi", models: [kimiProfile] });
    expect(() => provider.createClient("other")).toThrow();
    expect(() => plugin.setup({ config: {} } as Parameters<typeof plugin.setup>[0])).toThrow();
  });
  it("retains definitions and exact reasoning/status/arguments during continuation", async () => {
    const first = kimiFixture({
      reasoning: "Preserve me exactly.\n",
      calls: [{ id: "reused-id", name: "read", arguments: '{ "path": "README.md" }' }],
      responseId: "r1",
    });
    const fixture = kimiFixtureTransport([first, kimiFixture({ text: "Done", responseId: "r2" })]);
    const initial = await collect(fixture.transport);
    const content = initial.flatMap((event) =>
      event.type === "part_completed" ? [event.part] : [],
    );
    const call = content.find((part) => part.type === "tool_call");
    expect(call?.type).toBe("tool_call");
    if (call?.type !== "tool_call") throw Error("Expected call");
    expect(call.rawArguments).toBe('{ "path": "README.md" }');
    const next: ModelRequest = {
      ...request,
      toolChoice: "none",
      messages: [
        ...request.messages,
        { role: "assistant", stopReason: "tool_use", content },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              callId: call.callId,
              status: "denied",
              content: [{ type: "text", text: "Read was denied.\nKeep lines." }],
            },
          ],
        },
      ],
    };
    expect((await collect(fixture.transport, next)).at(-1)).toMatchObject({
      type: "completed",
      stopReason: "end_turn",
    });
    expect(fixture.requests[1]).toMatchObject({
      tool_choice: "none",
      tools: [{ type: "function", function: { name: "read" } }],
      messages: [
        { role: "user" },
        {
          role: "assistant",
          content: null,
          reasoning_content: "Preserve me exactly.\n",
          tool_calls: [{ id: "reused-id", function: { arguments: '{ "path": "README.md" }' } }],
        },
        {
          role: "tool",
          tool_call_id: "reused-id",
          content: "Tool result status: denied\n\nRead was denied.\nKeep lines.",
        },
      ],
    });
  });
});
