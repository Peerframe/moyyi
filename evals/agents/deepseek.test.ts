import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ModelRequest, ModelStreamEvent } from "../../src/contracts/index.ts";
import {
  deepSeekFixtureSse,
  deepSeekTextFixture,
} from "../../src/plugins/provider-deepseek/fixtures.ts";
import { DEEPSEEK_RESPONSES_URL } from "../../src/runtime/deepseek-http.ts";
import { type DeepSeekEvalHostOptions, deepSeekEvalHost } from "./deepseek.ts";
import { createMoyyiEvalAgent } from "./moyyi.ts";

const answer = '{"status":"done","summary":"Synthetic answer."}';
function sendFixture() {
  return vi.fn<typeof fetch>(
    async () =>
      new Response(deepSeekFixtureSse(deepSeekTextFixture(answer)), {
        headers: { "content-type": "text/event-stream" },
      }),
  );
}

async function invoke(options: DeepSeekEvalHostOptions) {
  const host = deepSeekEvalHost(options);
  const request: ModelRequest = {
    origin: host.profile.origin,
    system: [],
    messages: [{ role: "user", content: [{ type: "text", text: "Answer briefly." }] }],
    tools: [],
    maxOutputTokens: 512,
  };
  const events: ModelStreamEvent[] = [];
  for await (const event of host.createClient().stream(request, new AbortController().signal))
    events.push(event);
  return { host, events };
}

describe("DeepSeek eval host reasoning configuration", () => {
  it.each(["none", "low", "high", "max"] as const)(
    "sends explicit %s through the Responses transport and exposes the matching profile",
    async (effort) => {
      const fetch = sendFixture();
      const { host, events } = await invoke({
        getApiKey: () => "synthetic-test-key",
        fetch,
        reasoningEffort: effort,
      });
      expect(host.profile.origin).toEqual({ provider: "deepseek", model: "deepseek-flash" });
      expect(host.reasoningEffort).toBe(effort);
      expect(host.apiProfile).toBe(
        `deepseek-responses-text-v1-2026-10-25${effort === "high" ? "" : `-reasoning-${effort}`}`,
      );
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0]?.[0]).toBe(DEEPSEEK_RESPONSES_URL);
      expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: "POST", redirect: "error" });
      expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
        model: "deepseek-flash",
        reasoning: { effort },
        stream: true,
      });
      expect(events.at(-1)).toMatchObject({ type: "completed", stopReason: "end_turn" });
    },
  );

  it("preserves high when no effort is supplied", async () => {
    const fetch = sendFixture();
    const { host } = await invoke({ getApiKey: () => "synthetic-test-key", fetch });
    expect(host.reasoningEffort).toBe("high");
    expect(host.apiProfile).toBe("deepseek-responses-text-v1-2026-10-25");
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)).reasoning).toEqual({
      effort: "high",
    });
  });

  it("captures configuration without reading credentials or sending during construction", async () => {
    const fetch = sendFixture();
    const getApiKey = vi.fn(() => "synthetic-test-key");
    const options = { getApiKey, fetch, reasoningEffort: "low" as const };
    const host = deepSeekEvalHost(options);
    const client = host.createClient();
    expect(getApiKey).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    Object.assign(options, {
      reasoningEffort: "max",
      getApiKey: () => {
        throw Error("Changed callback must not run");
      },
    });
    const request: ModelRequest = {
      origin: host.profile.origin,
      system: [],
      tools: [],
      maxOutputTokens: 512,
      messages: [{ role: "user", content: [{ type: "text", text: "Answer briefly." }] }],
    };
    for await (const _event of client.stream(request, new AbortController().signal)) {
      /* consume */
    }
    expect(getApiKey).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)).reasoning).toEqual({ effort: "low" });
    expect(host.reasoningEffort).toBe("low");
    expect(host.apiProfile).toContain("-reasoning-low");
  });

  it.each(["medium", null, 1, {}])(
    "rejects invalid effort %j before lazy clients or credentials",
    (value) => {
      const fetch = sendFixture();
      const getApiKey = vi.fn(() => "synthetic-test-key");
      expect(() => deepSeekEvalHost({ getApiKey, fetch, reasoningEffort: value as never })).toThrow(
        "DeepSeek reasoning effort must be none, low, high or max",
      );
      expect(getApiKey).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("does not retry a failed injected transport", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw Error("SYNTHETIC_PRIVATE_ERROR");
    });
    const { events } = await invoke({
      getApiKey: () => "synthetic-test-key",
      fetch,
      reasoningEffort: "low",
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(events).toMatchObject([{ type: "error", error: { kind: "network" } }]);
    expect(JSON.stringify(events)).not.toContain("SYNTHETIC_PRIVATE_ERROR");
  });

  it("keeps low through the actual eval runtime and its one-request final turn", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "moyyi-eval-effort-"));
    const fetch = sendFixture();
    const getApiKey = vi.fn(() => "synthetic-test-key");
    const host = deepSeekEvalHost({ getApiKey, fetch, reasoningEffort: "low" });
    const agent = createMoyyiEvalAgent({ ...host, allowLive: true, maxModelRequests: 1 });
    try {
      const result = await agent.run({
        sessionId: "synthetic-effort-trial",
        turnIndex: 0,
        priorInstructions: [],
        workspace,
        instruction: "Just answer briefly.",
        budget: { timeoutMs: 10_000, maxModelRequests: 1 },
        signal: new AbortController().signal,
      });
      expect(result).toMatchObject({
        modelRequests: 1,
        claimedSuccess: true,
        outcome: "completed",
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(getApiKey).toHaveBeenCalledTimes(1);
      expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
        model: "deepseek-flash",
        reasoning: { effort: "low" },
        tool_choice: "none",
      });
    } finally {
      await agent.close();
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
