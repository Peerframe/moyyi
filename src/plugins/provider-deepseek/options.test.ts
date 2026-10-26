import { describe, expect, it, vi } from "vitest";
import type { ModelProvider, ModelRequest, PluginHost } from "../../contracts/index.ts";
import { buildDeepSeekRequest } from "./codec.ts";
import { deepSeekFixtureSse, deepSeekTextFixture } from "./fixtures.ts";
import { createDeepSeekClient, createDeepSeekPlugin, type DeepSeekTransport } from "./index.ts";
import {
  DEEPSEEK_API_PROFILE,
  type DeepSeekOptions,
  type DeepSeekReasoningEffort,
  deepSeekApiProfile,
} from "./options.ts";

const request: ModelRequest = {
  origin: { provider: "deepseek", model: "deepseek-flash" },
  system: [{ type: "text", text: "Preserve the user's evidence." }],
  messages: [{ role: "user", content: [{ type: "text", text: "Answer from the source." }] }],
  tools: [{ name: "read", description: "Read", inputSchema: { type: "object" } }],
  toolChoice: "none",
  maxOutputTokens: 8192,
};
function wire() {
  return vi.fn<DeepSeekTransport>(async () => ({
    status: 200,
    contentType: "text/event-stream",
    retryAfter: null,
    body: {
      async *[Symbol.asyncIterator]() {
        yield new TextEncoder().encode(deepSeekFixtureSse(deepSeekTextFixture()));
      },
    },
    async close() {},
  }));
}

describe("DeepSeek host reasoning options", () => {
  it.each(["none", "low", "high", "max"] as const)(
    "%s changes only the wire effort and preserves output/tool limits",
    (reasoningEffort) => {
      expect(buildDeepSeekRequest(request, { reasoningEffort })).toEqual({
        ...buildDeepSeekRequest(request),
        reasoning: { effort: reasoningEffort },
      });
    },
  );
  it("retains the legacy high profile and separates other recording identities", () => {
    expect(deepSeekApiProfile()).toBe(DEEPSEEK_API_PROFILE);
    expect(deepSeekApiProfile("high")).toBe(DEEPSEEK_API_PROFILE);
    expect(
      new Set(
        ["none", "low", "high", "max"].map((value) =>
          deepSeekApiProfile(value as DeepSeekReasoningEffort),
        ),
      ).size,
    ).toBe(4);
  });
  it.each([null, "", "medium", "xhigh", "LOW", 1, false, {}, "PRIVATE_SENTINEL"])(
    "rejects invalid effort %j before creating a usable client",
    (reasoningEffort) => {
      const options = { reasoningEffort } as DeepSeekOptions;
      const transport = wire();
      for (const create of [
        () => buildDeepSeekRequest(request, options),
        () => createDeepSeekClient(transport, options),
        () => createDeepSeekPlugin(transport, options),
        () => deepSeekApiProfile(reasoningEffort as DeepSeekReasoningEffort),
      ])
        expect(create).toThrow("DeepSeek reasoning effort must be none, low, high or max");
      expect(transport).not.toHaveBeenCalled();
    },
  );
  it("captures effort before caller mutation, at both client and plugin creation", async () => {
    const transport = wire();
    const options = { reasoningEffort: "low" as DeepSeekReasoningEffort };
    const client = createDeepSeekClient(transport, options);
    const plugin = createDeepSeekPlugin(transport, options);
    options.reasoningEffort = "max";
    let provider: ModelProvider | undefined;
    await plugin.setup({
      config: undefined,
      registerModelProvider(value: ModelProvider) {
        provider = value;
      },
    } as PluginHost);
    for (const current of [client, provider?.createClient("deepseek-flash")]) {
      if (!current) throw Error("Plugin did not register its provider");
      for (let i = 0; i < 2; i++) {
        let completed = false;
        for await (const event of current.stream(request, new AbortController().signal))
          completed ||= event.type === "completed";
        expect(completed).toBe(true);
      }
    }
    expect(transport).toHaveBeenCalledTimes(4);
    expect(
      transport.mock.calls.every(([body]) => JSON.parse(body).reasoning.effort === "low"),
    ).toBe(true);
  });
});
