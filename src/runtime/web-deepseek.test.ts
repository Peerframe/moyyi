import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import type {
  ActionDigest,
  EffectId,
  RunId,
  Timestamp,
  ToolCallId,
  ToolContext,
  WebRequest,
  WorkspaceWriteScope,
} from "../contracts/index.ts";
import { DEEPSEEK_SEARCH_URL, deepSeekSearchRequest } from "../plugins/web/deepseek-search.ts";
import { NodeWebAccess } from "./web.ts";
import { mapDeepSeekSearch, searchDeepSeek } from "./web-deepseek.ts";

const payload = () => ({
  content: [
    { type: "text", text: "Invented source https://invented.example.com and private key" },
    {
      type: "web_search_tool_result",
      content: [
        {
          type: "web_search_result",
          url: "https://docs.example.com/a",
          title: "Source",
          page_age: "2026-10-30",
          snippet: "Structured excerpt",
        },
        { type: "web_search_result", url: "https://docs.example.com/a", title: "Duplicate" },
        { type: "web_search_result", url: "https://docs.example.com/b" },
      ],
    },
  ],
  usage: {
    input_tokens: 120,
    output_tokens: 30,
    cache_read_input_tokens: 10,
    cache_creation_input_tokens: 0,
    server_tool_use: { tool_search: 2, web_search_requests: 3 },
  },
});
const response = (value: unknown = payload()) =>
  new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const limits = { timeoutMs: 1000, maxResponseBytes: 262144, maxOutputBytes: 8192 };
const request: WebRequest = { kind: "search", query: "public topic", count: 10 };
const context = (signal = new AbortController().signal): ToolContext => ({
  runId: "run_search" as RunId,
  workspaceRoot: "/unused",
  signal,
  limits: { maxOutputBytes: 8192 },
});
function scope(ctx: ToolContext, value = request): WorkspaceWriteScope {
  const digest = "sha256:synthetic" as ActionDigest;
  return {
    phase: "execute",
    action: { digest, summary: "Search", payload: value, preconditions: [] },
    effect: {
      id: "effect_search" as EffectId,
      runId: ctx.runId,
      callId: "call_search" as ToolCallId,
      tool: "web_search",
      profile: { class: "external", reversibility: "none", verification: "none" },
      digest,
      state: "started",
      updatedAt: "2026-10-30T00:00:00Z" as Timestamp,
    },
  };
}

describe("DeepSeek native search projection", () => {
  it("uses only structured sources, deduplicates and preserves reported usage", () => {
    const result = mapDeepSeekSearch(payload(), "public topic", 10, 8192);
    expect(JSON.parse(result.text)).toEqual({
      results: [
        {
          url: "https://docs.example.com/a",
          title: "Source",
          content: "Structured excerpt",
          publishedAt: "2026-10-30",
        },
        { url: "https://docs.example.com/b", title: "", content: "", publishedAt: null },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("Invented source");
    expect(result.search?.usage).toEqual({
      successfulSearches: 2,
      attemptedSearches: 3,
      inputTokens: 120,
      outputTokens: 30,
      cacheReadInputTokens: 10,
      cacheCreationInputTokens: 0,
    });
  });
  it("reports absent/invalid counters as unknown and never infers a search count", () => {
    const value = {
      ...payload(),
      usage: { input_tokens: -1, output_tokens: "30", server_tool_use: { tool_search: 1.2 } },
    };
    expect(mapDeepSeekSearch(value, "q", 10, 8192).search?.usage).toEqual({
      successfulSearches: null,
      attemptedSearches: null,
      inputTokens: null,
      outputTokens: null,
      cacheReadInputTokens: null,
      cacheCreationInputTokens: null,
    });
  });
  it("records provider usage with a failure instead of falling back to prose", () => {
    const result = mapDeepSeekSearch(
      { ...payload(), content: [{ type: "text", text: "https://made-up.example.com" }] },
      "q",
      10,
      8192,
    );
    expect(result.search?.error).toBe("no_structured_results");
    expect(result.search?.usage.successfulSearches).toBe(2);
    expect(JSON.parse(result.text)).toEqual({ results: [] });
    const failed = mapDeepSeekSearch(
      {
        content: [
          {
            type: "web_search_tool_result",
            content: { type: "web_search_tool_result_error", error_code: "max_uses_exceeded" },
          },
        ],
      },
      "q",
      10,
      8192,
    );
    expect(failed.search?.error).toBe("native_search_failed");
  });
  it("bounds results, rejects malformed records and never authorizes unsafe URLs", () => {
    expect(JSON.parse(mapDeepSeekSearch(payload(), "q", 1, 8192).text).results).toHaveLength(1);
    expect(mapDeepSeekSearch(payload(), "q", 1, 8192).truncated).toBe(true);
    const value = {
      content: [
        {
          type: "web_search_tool_result",
          content: [{ type: "web_search_result", url: "https://127.0.0.1/private" }],
        },
      ],
    };
    expect(JSON.parse(mapDeepSeekSearch(value, "q", 10, 8192).text).results).toEqual([]);
    expect(() =>
      mapDeepSeekSearch(
        { content: [{ type: "web_search_tool_result", content: [{}] }] },
        "q",
        10,
        8192,
      ),
    ).toThrow("Malformed");
    const bounded = mapDeepSeekSearch(payload(), "q", 10, 500);
    expect(bounded.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(bounded)) + 55).toBeLessThanOrEqual(500);
  });
});

describe("DeepSeek native search confinement", () => {
  it("prepares without credential I/O and executes one approved request with no history", async () => {
    const send = vi.fn<typeof fetch>(async () => response());
    const getApiKey = vi.fn(() => "synthetic-secret");
    const factory = new NodeWebAccess({
      allowedOrigins: [],
      search: { backend: "deepseek", getApiKey, fetch: send },
    });
    const ctx = context();
    await expect(
      factory.create(ctx, () => {}, { phase: "prepare" }).prepare(request),
    ).resolves.toEqual(request);
    expect(getApiKey).not.toHaveBeenCalled();
    const cap = factory.create(ctx, () => {}, scope(ctx));
    const result = await cap.execute();
    expect(send).toHaveBeenCalledExactlyOnceWith(
      DEEPSEEK_SEARCH_URL,
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        cache: "no-store",
        body: JSON.stringify(deepSeekSearchRequest("public topic")),
      }),
    );
    expect(JSON.stringify(result)).not.toContain("synthetic-secret");
    await expect(cap.execute()).rejects.toThrow("single approved");
    await expect(
      factory
        .create(ctx, () => {}, { phase: "prepare" })
        .prepare({ kind: "fetch", url: "https://docs.example.com/a" }),
    ).rejects.toThrow("outside");
  });
  it("denies expired grants and invalid effect bindings before reading credentials", async () => {
    const getApiKey = vi.fn(() => "synthetic");
    const factory = new NodeWebAccess({
      allowedOrigins: [],
      search: { backend: "deepseek", getApiKey },
    });
    const ctx = context();
    await expect(
      factory
        .create(
          ctx,
          () => {
            throw Error("denied");
          },
          scope(ctx),
        )
        .execute(),
    ).rejects.toThrow("denied");
    await expect(
      factory.create(ctx, () => {}, { ...scope(ctx), phase: "prepare" }).execute(),
    ).rejects.toThrow("durable started");
    expect(getApiKey).not.toHaveBeenCalled();
  });
  it("counts failed attempts and enforces five calls independently for each run", async () => {
    const send = vi.fn<typeof fetch>(async () => new Response("secret raw error", { status: 402 }));
    const factory = new NodeWebAccess({
      allowedOrigins: [],
      search: { backend: "deepseek", getApiKey: () => "synthetic", fetch: send },
    });
    const ctx = context();
    for (let i = 0; i < 5; i++)
      await expect(factory.create(ctx, () => {}, scope(ctx)).execute()).rejects.toThrow("HTTP 402");
    await expect(factory.create(ctx, () => {}, scope(ctx)).execute()).rejects.toThrow("at most 5");
    expect(send).toHaveBeenCalledTimes(5);
    const other = { ...ctx, runId: "run_other" as RunId };
    await expect(factory.create(other, () => {}, scope(other)).execute()).rejects.toThrow(
      "HTTP 402",
    );
    factory.releaseRun(ctx.runId);
    expect(send).toHaveBeenCalledTimes(6);
  });
  it("cancels while credentials are pending and never dispatches the late credential", async () => {
    const key = Promise.withResolvers<string>();
    const send = vi.fn<typeof fetch>();
    const abort = new AbortController();
    const pending = searchDeepSeek(
      { backend: "deepseek", getApiKey: () => key.promise, fetch: send },
      "q",
      10,
      abort.signal,
      () => {},
      limits,
    );
    abort.abort();
    await expect(pending).rejects.toThrow("cancelled");
    key.resolve("synthetic");
    await delay(0);
    expect(send).not.toHaveBeenCalled();
  });
  it("revokes during a response, stops the stream and does not retry", async () => {
    let authorized = true;
    const cancelled = vi.fn();
    const send = vi.fn<typeof fetch>(
      async () =>
        new Response(new ReadableStream({ cancel: cancelled }), {
          headers: { "content-type": "application/json" },
        }),
    );
    const pending = searchDeepSeek(
      { backend: "deepseek", getApiKey: () => "synthetic", fetch: send },
      "q",
      10,
      new AbortController().signal,
      () => {
        if (!authorized) throw Error("revoked");
      },
      limits,
    );
    await delay(0);
    authorized = false;
    await expect(pending).rejects.toThrow("revoked");
    expect(send).toHaveBeenCalledTimes(1);
    expect(cancelled).toHaveBeenCalledOnce();
  });
  it.each([
    ["redirect", () => new Response(null, { status: 307 }), "HTTP 307"],
    ["HTTP", () => new Response("secret raw provider error", { status: 429 }), "HTTP 429"],
    [
      "oversized",
      () => new Response(" ".repeat(2000), { headers: { "content-type": "application/json" } }),
      "byte limit",
    ],
    [
      "malformed",
      () => new Response("{", { headers: { "content-type": "application/json" } }),
      "valid JSON",
    ],
    [
      "content type",
      () => new Response("<p>body</p>", { headers: { "content-type": "text/html" } }),
      "JSON response",
    ],
  ] as const)(
    "fails closed for %s without raw diagnostics or retries",
    async (_name, make, message) => {
      const send = vi.fn<typeof fetch>(async () => make());
      await expect(
        searchDeepSeek(
          { backend: "deepseek", getApiKey: () => "synthetic", fetch: send },
          "q",
          10,
          new AbortController().signal,
          () => {},
          { ...limits, maxResponseBytes: 1024 },
        ),
      ).rejects.toThrow(message);
      expect(send).toHaveBeenCalledTimes(1);
    },
  );
  it("bounds a hung credential lookup with the same total deadline", async () => {
    const send = vi.fn<typeof fetch>();
    await expect(
      searchDeepSeek(
        { backend: "deepseek", getApiKey: () => new Promise(() => {}), fetch: send },
        "q",
        10,
        new AbortController().signal,
        () => {},
        { ...limits, timeoutMs: 10 },
      ),
    ).rejects.toThrow("timed out");
    expect(send).not.toHaveBeenCalled();
  });
  it("redacts a transport failure or interrupted response and never replays it", async () => {
    const secret = "synthetic-key-that-must-not-escape";
    const send = vi.fn<typeof fetch>(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(Error(secret));
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    const operation = searchDeepSeek(
      { backend: "deepseek", getApiKey: () => secret, fetch: send },
      "q",
      10,
      new AbortController().signal,
      () => {},
      limits,
    );
    await expect(operation).rejects.toThrow("response interrupted");
    expect(send).toHaveBeenCalledTimes(1);
    const rejected = vi.fn<typeof fetch>(async () => {
      throw Error(secret);
    });
    await expect(
      searchDeepSeek(
        { backend: "deepseek", getApiKey: () => secret, fetch: rejected },
        "q",
        10,
        new AbortController().signal,
        () => {},
        limits,
      ),
    ).rejects.toThrow("transport unavailable");
    expect(rejected).toHaveBeenCalledTimes(1);
  });
});
