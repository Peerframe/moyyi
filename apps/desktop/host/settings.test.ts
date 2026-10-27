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
import type { RuntimeOptions } from "moyyi/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CredentialRef, CredentialVault } from "./keychain.ts";
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
    ])
      expect(() => parseSettings(v)).toThrow();
    expect(() =>
      parseSettings(Object.defineProperty({ ...settings }, "preset", { get: () => "flash" })),
    ).toThrow();
    for (const key of ["", "x\ny", "x".repeat(4097), 12])
      expect(() => validateApiKey(key)).toThrow();
  });
});
