import { describe, expect, it } from "vitest";
import type { Plugin, PolicyRequest, ToolDefinition } from "../contracts/index.ts";
import { PluginRegistry } from "./plugins.ts";

function tool(name: string): ToolDefinition {
  return {
    name,
    description: name,
    inputSchema: { type: "object" },
    effect: { class: "read", reversibility: "not_applicable", verification: "not_applicable" },
    prepare: async () => {
      throw new Error("unused");
    },
    execute: async () => {
      throw new Error("unused");
    },
  };
}

function plugin(name: string, setup: Plugin["setup"]): Plugin {
  return { name, apiVersion: 1, setup };
}

const request: PolicyRequest = {
  tool: "read",
  profile: { class: "read", reversibility: "not_applicable", verification: "not_applicable" },
  phase: "prepare",
  args: {},
};

describe("PluginRegistry", () => {
  it("loads a plugin and exposes its registrations", async () => {
    const registry = new PluginRegistry();
    const status = await registry.load({
      plugin: plugin("fs", (h) => h.registerTool(tool("read"))),
    });
    expect(status).toEqual({ name: "fs", state: "loaded" });
    expect(registry.tools.map((t) => t.name)).toEqual(["read"]);
  });

  it("leaves nothing behind when setup fails, and runs cleanups", async () => {
    const registry = new PluginRegistry();
    let cleaned = false;
    const status = await registry.load({
      plugin: plugin("broken", (h) => {
        h.registerTool(tool("read"));
        h.onDispose(() => {
          cleaned = true;
        });
        throw new Error("boom");
      }),
    });
    expect(status).toEqual({ name: "broken", state: "failed", error: "boom" });
    expect(registry.tools).toEqual([]);
    expect(cleaned).toBe(true);
  });

  it("rejects a plugin whose tool name another plugin owns", async () => {
    const registry = new PluginRegistry();
    await registry.load({ plugin: plugin("a", (h) => h.registerTool(tool("read"))) });
    const status = await registry.load({
      plugin: plugin("b", (h) => {
        h.registerTool(tool("write"));
        h.registerTool(tool("read"));
      }),
    });
    expect(status).toMatchObject({
      state: "failed",
      error: 'tool "read" is already registered by "a"',
    });
    expect(registry.tools.map((t) => t.name)).toEqual(["read"]);
  });

  it("rejects invalid names, duplicate plugins and unknown API versions", async () => {
    const registry = new PluginRegistry();
    await registry.load({ plugin: plugin("fs", () => {}) });
    expect(await registry.load({ plugin: plugin("fs", () => {}) })).toMatchObject({
      state: "failed",
    });
    expect(await registry.load({ plugin: plugin("Bad Name", () => {}) })).toMatchObject({
      state: "failed",
    });
    const future = { name: "future", apiVersion: 2, setup() {} } as unknown as Plugin;
    expect(await registry.load({ plugin: future })).toMatchObject({ state: "failed" });
    const badTool = plugin("x", (h) => h.registerTool(tool("Read-File")));
    expect(await registry.load({ plugin: badTool })).toMatchObject({ state: "failed" });
  });

  it("refuses registrations after setup has finished", async () => {
    const registry = new PluginRegistry();
    let late: (() => void) | undefined;
    await registry.load({
      plugin: plugin("lazy", (h) => {
        late = () => h.registerTool(tool("later"));
      }),
    });
    expect(() => late?.()).toThrow(/after setup finished/);
    expect(registry.tools).toEqual([]);
  });

  it("removes everything on unload", async () => {
    const registry = new PluginRegistry();
    let disposed = 0;
    await registry.load({
      plugin: plugin("fs", (h) => {
        h.registerTool(tool("read"));
        h.onDispose(() => {
          disposed++;
        });
      }),
    });
    await registry.unload("fs");
    expect(registry.tools).toEqual([]);
    expect(disposed).toBe(1);
  });

  it("lets plugin rules restrict but never allow", async () => {
    const registry = new PluginRegistry();
    await registry.load({
      plugin: plugin("rules", (h) => {
        h.registerPolicyRule({ id: "ask", evaluate: () => ({ kind: "ask" }) });
        // A JavaScript plugin can bypass the type; the registry must still refuse.
        h.registerPolicyRule({ id: "sneaky", evaluate: () => ({ kind: "allow" }) as never });
      }),
    });
    expect(registry.evaluatePolicy(request)).toEqual({
      kind: "deny",
      reason: "policy rule rules/sneaky returned allow",
    });
  });

  it("denies when a policy rule throws", async () => {
    const registry = new PluginRegistry();
    await registry.load({
      plugin: plugin("rules", (h) =>
        h.registerPolicyRule({
          id: "broken",
          evaluate: () => {
            throw new Error("bug");
          },
        }),
      ),
    });
    expect(registry.evaluatePolicy(request)).toMatchObject({ kind: "deny" });
  });

  it("isolates a throwing observer", async () => {
    const registry = new PluginRegistry();
    const seen: string[] = [];
    await registry.load({
      plugin: plugin("noisy", (h) =>
        h.onEvent(() => {
          throw new Error("bad observer");
        }),
      ),
    });
    await registry.load({ plugin: plugin("quiet", (h) => h.onEvent((e) => seen.push(e.type))) });
    registry.emit({ type: "command.rejected", command: "x", reason: "y" });
    expect(seen).toEqual(["command.rejected"]);
    expect(registry.diagnostics).toHaveLength(1);
  });
});
