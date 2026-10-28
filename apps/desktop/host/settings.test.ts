import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RuntimeEvent, SessionId } from "moyyi/contracts";
import { createRuntime, type RuntimeOptions } from "moyyi/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isDesktopState } from "../wire.ts";
import type { CredentialRef, CredentialVault } from "./keychain.ts";
import { createDesktopHost } from "./service.ts";
import { createModelConfiguration } from "./settings.ts";
import { parseSettings, validateApiKey } from "./settings-schema.ts";

const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});
const settings = { preset: "flash" as const, maxRequests: 3, timeoutMs: 120_000 };
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "moyyi-desktop-settings-"));
  homes.push(home);
  const keys = new Map<CredentialRef, string>([["legacy-flash", "legacy-synthetic-secret"]]);
  const vault: CredentialVault = {
    status: vi.fn(async (ref) => keys.has(ref)),
    read: vi.fn(async (ref) => {
      const key = keys.get(ref);
      if (!key) throw Error("Unavailable secret");
      return key;
    }),
    add: vi.fn(async (id, key) => {
      keys.set(`desktop:${id}`, key);
    }),
    remove: vi.fn(async (id) => {
      keys.delete(`desktop:${id}`);
    }),
  };
  return { home, vault, keys, config: createModelConfiguration(home, vault) };
}

const readKey = (options: RuntimeOptions) => {
  if (!options.deepseek || !("getApiKey" in options.deepseek))
    throw Error("Expected HTTP connection");
  return options.deepseek.getApiKey();
};
describe("desktop data-only model configuration", () => {
  it("persists explicit evidence review within the unchanged cap and removes disabled settings", async () => {
    const { config, home, vault } = fixture();
    const reviewed = { ...settings, maxRequests: 8, answerReview: true };
    const saved = await config.save(reviewed);
    expect(saved.runtimeOptions.answerReview).toBe(true);
    expect(saved.runtimeOptions.deepseekReasoningEffort).toBe("low");
    expect(saved.runtimeOptions.limits).toMatchObject({ maxModelRequests: 8, maxRetries: 0 });
    expect((await createModelConfiguration(home, vault).current()).settings).toEqual(reviewed);
    for (const bad of [
      { ...reviewed, maxRequests: 3 },
      { ...reviewed, answerReview: "true" },
      { ...reviewed, answerReview: undefined },
      Object.defineProperty({ ...reviewed }, "answerReview", { get: () => true }),
    ])
      expect(() => parseSettings(bad)).toThrow();
    const disabled = await config.save({ ...settings, answerReview: false });
    expect(disabled.settings).toEqual(settings);
    expect(disabled.runtimeOptions.answerReview).toBeUndefined();
    expect(vault.read).not.toHaveBeenCalled();
    expect(vault.add).not.toHaveBeenCalled();
    expect(vault.remove).not.toHaveBeenCalled();
  });
  it("preserves legacy low settings, persists explicit Kimi high, and restores the old three-field format", async () => {
    const { config, home, vault } = fixture();
    const low = { ...settings, preset: "kimi-cn" as const };
    const path = join(home, ".moyyi/desktop/settings.json");
    const first = await config.save(low);
    expect(first.runtimeOptions.kimiReasoningEffort).toBe("low");
    const bytes = readFileSync(path, "utf8");
    expect((await createModelConfiguration(home, vault).current()).settings).toEqual(low);
    expect(readFileSync(path, "utf8")).toBe(bytes);
    const high = { ...low, kimiReasoningEffort: "high" as const };
    await config.save(high);
    const reopened = await createModelConfiguration(home, vault).current();
    expect(reopened.settings).toEqual(high);
    expect(reopened.runtimeOptions.kimiReasoningEffort).toBe("high");
    expect(JSON.parse(readFileSync(path, "utf8")).settings).toEqual(high);
    for (const next of [low, settings]) {
      const saved = await config.save({ ...next, kimiReasoningEffort: "low" });
      expect(saved.settings).toEqual(next);
      expect(JSON.parse(readFileSync(path, "utf8")).settings).toEqual(next);
      expect(Object.keys(saved.settings).sort()).toEqual(["maxRequests", "preset", "timeoutMs"]);
    }
    expect((await config.current()).runtimeOptions.deepseekReasoningEffort).toBe("low");
    expect(vault.read).not.toHaveBeenCalled();
    expect(vault.add).not.toHaveBeenCalled();
    expect(vault.remove).not.toHaveBeenCalled();
  });

  it("sends high on the real Kimi codec/HTTP path with the eight-request limit and lazy synthetic credentials", async () => {
    const { config, home, vault, keys } = fixture();
    keys.set("legacy-kimi-cn", "synthetic-kimi-secret");
    const current = await config.save({
      preset: "kimi-cn",
      kimiReasoningEffort: "high",
      maxRequests: 8,
      timeoutMs: 300_000,
    });
    expect(current.runtimeOptions.limits).toMatchObject({
      maxModelRequests: 8,
      timeoutMs: 300_000,
      maxRetries: 0,
    });
    const connection = current.runtimeOptions.kimi;
    if (!connection || !("getApiKey" in connection)) throw Error("Expected Kimi HTTP options");
    const requests: Record<string, unknown>[] = [];
    const fetch: typeof globalThis.fetch = async (url, init) => {
      expect(url).toBe("https://api.moonshot.cn/v1/chat/completions");
      expect(init?.redirect).toBe("error");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(body);
      expect(requests.length).toBeLessThanOrEqual(8);
      const last = requests.length === 8;
      const envelope = {
        id: `synthetic-${requests.length}`,
        object: "chat.completion.chunk",
        created: 1,
        model: "kimi-k3.1-pro",
      };
      const delta = last
        ? { content: "Synthetic complete" }
        : {
            tool_calls: [
              {
                index: 0,
                id: `read-${requests.length}`,
                type: "function",
                function: { name: "read", arguments: JSON.stringify({ path: "note.txt" }) },
              },
            ],
          };
      const usage = { prompt_tokens: 20, completion_tokens: 8, total_tokens: 28 };
      const events = [
        {
          ...envelope,
          choices: [{ index: 0, delta: { role: "assistant", ...delta }, finish_reason: null }],
        },
        {
          ...envelope,
          choices: [{ index: 0, delta: {}, finish_reason: last ? "stop" : "tool_calls", usage }],
        },
        { ...envelope, choices: [], usage },
      ];
      return new Response(
        `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`,
        {
          headers: { "content-type": "text/event-stream" },
        },
      );
    };
    const workspace = join(home, "workspace");
    mkdirSync(workspace);
    writeFileSync(join(workspace, "note.txt"), "Synthetic source");
    const runtime = await createRuntime({
      ...current.runtimeOptions,
      kimi: { ...connection, fetch },
    });
    const events: RuntimeEvent[] = [];
    let sessionId: SessionId | undefined;
    runtime.subscribe((event) => {
      events.push(event);
      if (event.type === "session.ready") sessionId = event.sessionId;
    });
    try {
      expect(vault.read).not.toHaveBeenCalled();
      await runtime.send({ type: "session.create", workspaceRoot: workspace });
      if (!sessionId) throw Error("Expected session");
      await runtime.send({
        type: "run.start",
        sessionId,
        input: [{ type: "text", text: "Read the synthetic fixture" }],
      });
      await runtime.idle();
      const finished = events.findLast((event) => event.type === "run.finished");
      expect(finished, JSON.stringify(finished)).toMatchObject({
        outcome: { kind: "completed" },
      });
      expect(requests).toHaveLength(8);
      expect(
        requests.every(
          (request) =>
            request.reasoning_effort === "high" && request.max_completion_tokens === 8192,
        ),
      ).toBe(true);
      expect(requests.slice(0, 7).every((request) => request.tool_choice === "auto")).toBe(true);
      expect(requests[7]?.tool_choice).toBe("none");
      expect(vault.read).toHaveBeenCalledTimes(1);
    } finally {
      await runtime.close();
    }
    const low = await config.save({ preset: "kimi-cn", maxRequests: 8, timeoutMs: 300_000 });
    expect(low.runtimeOptions.kimiReasoningEffort).toBe("low");
    const next = low.runtimeOptions.kimi;
    if (!next || !("getApiKey" in next)) throw Error("Expected Kimi HTTP options");
    expect(vault.read).toHaveBeenCalledTimes(1);
    await next.getApiKey();
    await next.getApiKey();
    expect(vault.read).toHaveBeenCalledTimes(2);
  });

  it("reconfigures effort through the desktop host, revokes grants, and validates the projected setting", async () => {
    const { config, home, vault } = fixture();
    const initial = await config.current();
    const host = await createDesktopHost({
      runtimeOptions: () => initial.runtimeOptions,
      settings: initial.settings,
      connection: initial.connection,
      configure: config.save,
    });
    const workspace = join(home, "workspace");
    mkdirSync(workspace);
    try {
      await host.dispatch({ type: "create", workspaceRoot: workspace, askEachRead: false });
      const sessionId = host.getState().activeSessionId;
      await host.dispatch({ type: "permissions", sessionId, writes: true, checks: false });
      const high = {
        preset: "kimi-cn",
        maxRequests: 8,
        timeoutMs: 300_000,
        kimiReasoningEffort: "high",
      };
      await host.dispatch({ type: "configure", settings: high });
      const state = host.getState();
      expect(state.settings).toEqual(high);
      expect(state.permissions).toEqual({ writes: false, checks: false });
      expect(state.activeSessionId).toBe(sessionId);
      expect(state.pendingApproval).toBeNull();
      expect(state.messages).toEqual([]);
      expect(isDesktopState(state)).toBe(true);
      for (const invalid of [
        { ...high, preset: "flash" },
        { ...high, kimiReasoningEffort: "max" },
      ])
        expect(isDesktopState({ ...state, settings: invalid })).toBe(false);
      await host.dispatch({ type: "report.target", sessionId, path: "report.json" });
      await host.dispatch({ type: "configure", settings });
      expect(host.getState().reportTarget).toBeNull();
      expect(host.getState().settings).toEqual(settings);
      expect(vault.read).not.toHaveBeenCalled();
      expect(vault.add).not.toHaveBeenCalled();
    } finally {
      await host.close();
    }
  });

  it("starts Flash low with original limits and metadata only, without writing settings or reading a key", async () => {
    const { config, home, vault } = fixture();
    const current = await config.current();
    expect(current.settings).toEqual(settings);
    expect(current.connection.ready).toBe(true);
    expect(current.runtimeOptions.model).toEqual({ provider: "deepseek", model: "deepseek-flash" });
    expect(current.runtimeOptions.deepseekReasoningEffort).toBe("low");
    expect(current.runtimeOptions.limits).toMatchObject({
      maxModelRequests: 3,
      maxRetries: 0,
      timeoutMs: 120_000,
    });
    expect(vault.read).not.toHaveBeenCalled();
    expect(existsSync(join(home, ".moyyi"))).toBe(false);
  });
  it("saves/reopens data settings without credentials/network and never silently falls back on an unconfigured preset", async () => {
    const { config, home, vault } = fixture();
    const next = { preset: "kimi-global" as const, maxRequests: 4, timeoutMs: 120_000 };
    const current = await config.save(next);
    expect(current.settings).toEqual(next);
    expect(current.connection.ready).toBe(false);
    expect(current.runtimeOptions.kimi).toMatchObject({ region: "global" });
    expect(current.runtimeOptions.model?.provider).toBe("kimi");
    expect((await createModelConfiguration(home, vault).current()).settings).toEqual(next);
    expect(vault.add).not.toHaveBeenCalled();
    expect(vault.read).not.toHaveBeenCalled();
  });
  it("writes new immutable credential identities, preserves old keys and uses a new lazy key cache", async () => {
    const { config, home, vault, keys } = fixture();
    const before = await config.current();
    expect(await readKey(before.runtimeOptions)).toBe("legacy-synthetic-secret");
    const first = await config.save(settings, "new-synthetic-secret");
    expect(keys.get("legacy-flash")).toBe("legacy-synthetic-secret");
    expect(JSON.stringify(first)).not.toContain("synthetic-secret");
    expect(readFileSync(join(home, ".moyyi/desktop/settings.json"), "utf8")).not.toContain(
      "synthetic-secret",
    );
    expect(await readKey(first.runtimeOptions)).toBe("new-synthetic-secret");
    const second = await config.save(settings, "second-synthetic-secret");
    expect(await readKey(second.runtimeOptions)).toBe("second-synthetic-secret");
    expect(keys.size).toBe(3);
    expect(vault.remove).not.toHaveBeenCalled();
  });
  it("preserves settings and old keys when saving is denied; errors cannot leak input", async () => {
    const { config, home, vault } = fixture();
    await config.save(settings);
    const path = join(home, ".moyyi/desktop/settings.json");
    const before = readFileSync(path, "utf8");
    vi.mocked(vault.add).mockRejectedValue(Error("private-input-secret"));
    await expect(
      config.save({ ...settings, maxRequests: 4 }, "private-input-secret"),
    ).rejects.toThrow("原有凭据和会话未删除");
    expect(readFileSync(path, "utf8")).toBe(before);
    expect((await config.current()).settings).toEqual(settings);
  });
  it("refuses unsafe settings links and leaves their target untouched", async () => {
    const { config, home } = fixture();
    const outside = join(home, "outside");
    writeFileSync(outside, "canary", { mode: 0o600 });
    mkdirSync(join(home, ".moyyi/desktop"), { recursive: true, mode: 0o700 });
    symlinkSync(outside, join(home, ".moyyi/desktop/settings.json"));
    await expect(config.save(settings)).rejects.toThrow("未能确认保存");
    expect(readFileSync(outside, "utf8")).toBe("canary");
  });
  it("keeps malformed or overly-permissive existing data unavailable without a startup fallback or rewrite", async () => {
    const { home, vault } = fixture();
    mkdirSync(join(home, ".moyyi/desktop"), { recursive: true, mode: 0o700 });
    const path = join(home, ".moyyi/desktop/settings.json");
    writeFileSync(path, '{"format":99}', { mode: 0o600 });
    expect((await createModelConfiguration(home, vault).current()).connection.ready).toBe(false);
    expect(readFileSync(path, "utf8")).toBe('{"format":99}');
    expect(vault.status).not.toHaveBeenCalled();
    writeFileSync(path, JSON.stringify({ format: 1, settings, credentials: {} }));
    chmodSync(path, 0o644);
    expect((await createModelConfiguration(home, vault).current()).connection.ready).toBe(false);
  });
  it("rejects executable/arbitrary endpoint options, invalid budgets and secret-bearing wrong shapes", () => {
    for (const v of [
      { ...settings, baseUrl: "https://bad.example" },
      { ...settings, getApiKey: "code" },
      { ...settings, maxRequests: 9 },
      { ...settings, timeoutMs: 300_001 },
      { ...settings, preset: "auto" },
      { ...settings, maxRequests: 0 },
      { ...settings, kimiReasoningEffort: "high" },
      { ...settings, preset: "kimi-cn", kimiReasoningEffort: "max" },
      { ...settings, preset: "kimi-cn", kimiReasoningEffort: undefined },
      Object.defineProperty({ ...settings }, "kimiReasoningEffort", { get: () => "high" }),
    ])
      expect(() => parseSettings(v)).toThrow();
    expect(() =>
      parseSettings(Object.defineProperty({ ...settings }, "preset", { get: () => "flash" })),
    ).toThrow();
    for (const key of ["", "x\ny", "x".repeat(4097), 12])
      expect(() => validateApiKey(key)).toThrow();
  });
});
