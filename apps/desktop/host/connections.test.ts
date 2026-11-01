import assert from "node:assert/strict";
import {
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
import { afterEach, expect, it, vi } from "vitest";
import { isDesktopState } from "../wire.ts";
import type { CredentialRef, CredentialVault } from "./keychain.ts";
import { createDesktopHost } from "./service.ts";
import { createModelConfiguration } from "./settings.ts";

const homes: string[] = [];
afterEach(() => {
  for (const h of homes.splice(0)) rmSync(h, { recursive: true, force: true });
});
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "moyyi-d3-connections-"));
  homes.push(home);
  const keys = new Map<CredentialRef, string>([["legacy-flash", "synthetic-legacy"]]);
  const vault: CredentialVault = {
    status: vi.fn(async (r) => keys.has(r)),
    read: vi.fn(async (r) => {
      const key = keys.get(r);
      assert(key, "Expected a configured synthetic credential");
      return key;
    }),
    add: vi.fn(async (id, key) => {
      keys.set(`desktop:${id}`, key);
    }),
    remove: vi.fn(async (id) => {
      keys.delete(id.startsWith("legacy-") ? (id as CredentialRef) : `desktop:${id}`);
    }),
  };
  return { home, keys, vault, configuration: createModelConfiguration(home, vault) };
}
it("migrates format one in memory and backs up its exact bytes only on first save", async () => {
  const { home, vault } = fixture();
  const root = join(home, ".moyyi/desktop");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const original = JSON.stringify({
    format: 1,
    settings: { preset: "flash", maxRequests: 3, timeoutMs: 120000 },
    credentials: {},
  });
  writeFileSync(join(root, "settings.json"), original, { mode: 0o600 });
  const c = createModelConfiguration(home, vault);
  const first = await c.current();
  expect(first.connections).toHaveLength(1);
  expect(vault.read).not.toHaveBeenCalled();
  expect(readFileSync(join(root, "settings.json"), "utf8")).toBe(original);
  expect(existsSync(join(root, "settings.format1.json"))).toBe(false);
  await c.save(first.settings);
  expect(readFileSync(join(root, "settings.format1.json"), "utf8")).toBe(original);
  expect(JSON.parse(readFileSync(join(root, "settings.json"), "utf8")).format).toBe(2);
  await c.save({ ...first.settings, maxRequests: 4 });
  expect(readFileSync(join(root, "settings.format1.json"), "utf8")).toBe(original);
});
it("keeps named same-provider keys distinct, deletes only selected dormant key, and denies deleting active", async () => {
  const { configuration: c, vault } = fixture();
  const first = await c.current();
  await c.changeConnection({
    action: "add",
    name: "Second",
    provider: "deepseek",
    apiKey: "synthetic-second",
  });
  const second = (await c.current()).connections.find((x) => x.name === "Second");
  assert(second, "Expected the added connection");
  expect(second.configured).toBe(true);
  expect(second.credentialDeletion).toBe("delete");
  expect(vault.read).not.toHaveBeenCalled();
  await c.changeConnection({ action: "rename", id: second.id, name: "Backup" });
  const selected = await c.changeConnection({ action: "select", id: second.id });
  expect(selected.settings.preset).toBe("flash");
  expect(selected.activeConnectionId).toBe(second.id);
  await expect(c.changeConnection({ action: "delete", id: second.id })).rejects.toThrow("当前连接");
  await c.changeConnection({ action: "select", id: first.activeConnectionId });
  await c.changeConnection({ action: "delete", id: second.id });
  expect(vault.remove).toHaveBeenCalledWith(second.id);
  expect((await c.current()).connections).toHaveLength(1);
});
it.each(["flash", "kimi-cn", "kimi-global"] as const)(
  "unlinks the migrated %s connection while preserving the shared legacy credential",
  async (preset) => {
    const { home, vault, keys } = fixture();
    const root = join(home, ".moyyi/desktop");
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const ref = `legacy-${preset}` as CredentialRef;
    keys.set(ref, "shared-synthetic-key");
    const original = JSON.stringify({
      format: 1,
      settings: { preset, maxRequests: 3, timeoutMs: 120000 },
      credentials: {},
    });
    writeFileSync(join(root, "settings.json"), original, { mode: 0o600 });
    const c = createModelConfiguration(home, vault);
    const old = (await c.current()).connections[0];
    assert(old, "Expected the migrated connection");
    expect(old.credentialDeletion).toBe("retain-legacy");
    const added = await c.changeConnection({ action: "add", name: "Next", provider: "deepseek" });
    const next = added.connections.find((x) => x.name === "Next");
    assert(next, "Expected the replacement connection");
    await c.changeConnection({ action: "select", id: next.id });
    const removed = await c.changeConnection({ action: "delete", id: old.id });
    expect(removed.connections.map((x) => x.id)).toEqual([next.id]);
    expect(removed.searchConnectionId).toBeNull();
    expect(keys.get(ref)).toBe("shared-synthetic-key");
    expect(vault.remove).not.toHaveBeenCalled();
    expect(vault.read).not.toHaveBeenCalled();
    expect(readFileSync(join(root, "settings.format1.json"), "utf8")).toBe(original);
    expect((await createModelConfiguration(home, vault).current()).connections).toEqual(
      removed.connections,
    );
  },
);
it("uses the credential reference when a legacy connection has a new desktop-owned key", async () => {
  const { configuration: c, vault, keys } = fixture();
  const initial = await c.current();
  const saved = await c.save(initial.settings, "new-synthetic-key");
  expect(saved.activeConnectionId).toBe("legacy-flash");
  expect(saved.connections[0]?.credentialDeletion).toBe("delete");
  const keyId = vi.mocked(vault.add).mock.calls[0]?.[0];
  assert(keyId, "Expected the new credential identity");
  await c.changeConnection({ action: "add", name: "Next", provider: "deepseek" });
  const next = (await c.current()).connections.find((x) => x.name === "Next");
  assert(next, "Expected the replacement connection");
  await c.changeConnection({ action: "select", id: next.id });
  await c.changeConnection({ action: "delete", id: initial.activeConnectionId });
  expect(vault.remove).toHaveBeenCalledExactlyOnceWith(keyId);
  expect(keys.has(`desktop:${keyId}`)).toBe(false);
  expect(keys.get("legacy-flash")).toBe("synthetic-legacy");
});
it("retains a desktop credential still referenced by another connection", async () => {
  const { configuration: original, home, vault, keys } = fixture();
  await original.changeConnection({
    action: "add",
    name: "Shared",
    provider: "deepseek",
    apiKey: "shared-synthetic-key",
  });
  const path = join(home, ".moyyi/desktop/settings.json");
  const stored = JSON.parse(readFileSync(path, "utf8"));
  const shared = stored.connections.find((c: { name: string }) => c.name === "Shared");
  stored.connections.push({ ...shared, id: "another-reference", name: "Other" });
  writeFileSync(path, JSON.stringify(stored));
  const c = createModelConfiguration(home, vault);
  expect((await c.current()).connections.find((x) => x.id === shared.id)?.credentialDeletion).toBe(
    "retain-shared",
  );
  const result = await c.changeConnection({ action: "delete", id: shared.id });
  expect(result.connections.find((x) => x.id === "another-reference")?.credentialDeletion).toBe(
    "delete",
  );
  expect(keys.get(shared.credentialRef)).toBe("shared-synthetic-key");
  expect(vault.remove).not.toHaveBeenCalled();
  expect(JSON.stringify(result.connections)).not.toContain("credentialRef");
});
it("keeps backup symlinks and target data untouched", async () => {
  const { home, vault } = fixture();
  const root = join(home, ".moyyi/desktop");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const original = JSON.stringify({
    format: 1,
    settings: { preset: "flash", maxRequests: 3, timeoutMs: 120000 },
    credentials: {},
  });
  writeFileSync(join(root, "settings.json"), original, { mode: 0o600 });
  writeFileSync(join(home, "canary"), "unchanged", { mode: 0o600 });
  symlinkSync(join(home, "canary"), join(root, "settings.format1.json"));
  const c = createModelConfiguration(home, vault);
  await expect(c.save((await c.current()).settings)).rejects.toThrow();
  expect(readFileSync(join(root, "settings.json"), "utf8")).toBe(original);
  expect(readFileSync(join(home, "canary"), "utf8")).toBe("unchanged");
});
it("keeps committed deletion and search state when key cleanup cannot be confirmed", async () => {
  const { configuration: c, vault, home } = fixture();
  await c.changeConnection({
    action: "add",
    name: "Search",
    provider: "deepseek",
    apiKey: "synthetic",
  });
  const second = (await c.current()).connections.find((x) => x.name === "Search");
  assert(second, "Expected the search connection");
  await c.changeConnection({ action: "search", id: second.id });
  const initial = await c.current();
  const host = await createDesktopHost({
    ...initial,
    runtimeOptions: () => initial.runtimeOptions,
    changeConnection: c.changeConnection,
  });
  vi.mocked(vault.remove).mockRejectedValueOnce(Error("private OS diagnostic"));
  try {
    await expect(
      host.dispatch({ type: "connection.change", change: { action: "delete", id: second.id } }),
    ).rejects.toThrow("钥匙串密钥未能确认删除");
    const state = host.getState();
    expect(state.connections).toEqual((await c.current()).connections);
    expect(state.connections.some((x) => x.id === second.id)).toBe(false);
    expect(state.searchConnectionId).toBeNull();
    expect(state.error).toContain("钥匙串密钥未能确认删除");
    expect(JSON.stringify(state)).not.toContain("private OS diagnostic");
    expect((await createModelConfiguration(home, vault).current()).connections).toEqual(
      state.connections,
    );
    expect(state.connection.ready).toBe(true);
  } finally {
    await host.close();
  }
});
it("switches in the same idle session, resets grants and records a credential-free notice", async () => {
  const { home, configuration: c } = fixture();
  await c.changeConnection({ action: "add", name: "Second", provider: "deepseek" });
  const initial = await c.current();
  const host = await createDesktopHost({
    ...initial,
    runtimeOptions: () => initial.runtimeOptions,
    configure: c.save,
    changeConnection: c.changeConnection,
  });
  const workspace = join(home, "work");
  mkdirSync(workspace);
  try {
    await host.dispatch({ type: "create", workspaceRoot: workspace, askEachRead: false });
    const id = host.getState().activeSessionId;
    await host.dispatch({ type: "permissions", sessionId: id, writes: true, checks: false });
    const second = initial.connections.find((x) => x.name === "Second");
    assert(second, "Expected the added connection");
    await host.dispatch({ type: "connection.change", change: { action: "select", id: second.id } });
    const state = host.getState();
    expect(state.activeSessionId).toBe(id);
    expect(state.permissions).toEqual({ writes: false, checks: false });
    expect(state.messages.some((m) => m.role === "notice" && m.text.includes("Second"))).toBe(true);
    expect(JSON.stringify(state)).not.toContain("credentialRef");
    expect(isDesktopState(state)).toBe(true);
    for (const credentialDeletion of [undefined, "unknown", true])
      expect(
        isDesktopState({
          ...state,
          connections: state.connections.map((connection) => ({
            ...connection,
            credentialDeletion,
          })),
        }),
      ).toBe(false);
  } finally {
    await host.close();
  }
});
it.each([
  [402, "quota"],
  [429, "rate_limited"],
  [401, "auth"],
] as const)("projects HTTP %s as a safe connection-unavailable card", async (status, kind) => {
  const { home, configuration } = fixture();
  const initial = await configuration.current();
  const host = await createDesktopHost({
    ...initial,
    runtimeOptions: () => ({
      ...initial.runtimeOptions,
      deepseek: {
        getApiKey: async () => "synthetic-only",
        fetch: async () =>
          new Response('{"error":{"message":"never-display-private-raw-body"}}', { status }),
      },
    }),
  });
  const workspace = join(home, "work");
  mkdirSync(workspace);
  try {
    await host.dispatch({ type: "create", workspaceRoot: workspace, askEachRead: false });
    await host.dispatch({
      type: "start",
      sessionId: host.getState().activeSessionId,
      text: "Say hello",
    });
    await vi.waitFor(() => expect(host.getState().outcome?.kind).toBe("failed"));
    expect(host.getState().connectionFailure).toEqual({ name: "DeepSeek Flash", kind });
    expect(JSON.stringify(host.getState())).not.toContain("never-display-private-raw-body");
    expect(host.getState().messages.some((m) => m.role === "user")).toBe(true);
  } finally {
    await host.close();
  }
});
