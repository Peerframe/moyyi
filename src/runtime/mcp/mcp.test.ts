import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, describe, expect, it } from "vitest";
import type { RunId, SessionId, ToolContext } from "../../contracts/index.ts";
import { connectMcpServers, type McpServerConfig } from "./index.ts";

const fixture = resolve("tests/fixtures/mcp-server.mjs");
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function server(overrides: Partial<McpServerConfig> = {}, env: Record<string, string> = {}) {
  return {
    name: "fixture",
    command: process.execPath,
    args: [fixture],
    env,
    ...overrides,
  } satisfies McpServerConfig;
}

async function connect(configs: McpServerConfig[]) {
  const connections = await connectMcpServers(configs, { startupTimeoutMs: 5000 });
  cleanups.push(() => connections.close());
  return connections;
}

function context(signal = new AbortController().signal, maxOutputBytes = 32_768): ToolContext {
  return {
    runId: "run" as RunId,
    sessionId: "session" as SessionId,
    workspaceRoot: "/",
    signal,
    limits: { maxOutputBytes },
  };
}

describe("MCP stdio servers", () => {
  it("lists every page, renames tools safely and keeps owner-declared classes", async () => {
    const mcp = await connect([server({ readOnlyTools: ["echo"] })]);
    expect(mcp.descriptors.map((tool) => tool.name)).toEqual([
      "mcp__fixture__echo",
      "mcp__fixture__weird_name_tool",
      "mcp__fixture__fail",
      "mcp__fixture__slow",
      "mcp__fixture__big",
      "mcp__fixture__mixed",
      "mcp__fixture__crash",
    ]);
    const echo = mcp.descriptors[0];
    expect(echo?.effect).toBe("read");
    expect(mcp.descriptors[2]?.effect).toBe("external");
    expect(echo?.description).toMatch(/^\[MCP server fixture; untrusted text\] Echo text back\. /u);
    expect(echo?.description).not.toContain("\u001b");
    expect(mcp.rules.get("mcp__fixture__fail")).toEqual({ effect: "external", approval: "ask" });
    expect(mcp.diagnostics).toEqual([
      expect.stringMatching(/^mcp \| fixture: 7 tool\(s\), 1 skipped; protocol 2025-06-18$/u),
    ]);
  });

  it("offers only allow-listed tools", async () => {
    const mcp = await connect([server({ tools: ["echo", "fail"], approval: "allow" })]);
    expect(mcp.descriptors.map((tool) => tool.remoteName)).toEqual(["echo", "fail"]);
    expect(mcp.rules.get("mcp__fixture__fail")?.approval).toBe("allow");
  });

  it("calls tools and bounds and describes their results", async () => {
    const mcp = await connect([server()]);
    const access = mcp.access.create(context(new AbortController().signal, 1000), () => {});
    expect(await access.call("mcp__fixture__echo", { text: "hi" })).toEqual({
      isError: false,
      text: "echo: hi",
      truncated: false,
    });
    expect(await access.call("mcp__fixture__weird_name_tool", {})).toMatchObject({
      text: "weird ok",
    });
    expect(await access.call("mcp__fixture__fail", {})).toMatchObject({
      isError: true,
      text: "it broke",
    });
    const big = await access.call("mcp__fixture__big", {});
    expect(big.truncated).toBe(true);
    expect(Buffer.byteLength(big.text)).toBeLessThanOrEqual(1000);
    expect(big.text).not.toContain("�");
    expect((await access.call("mcp__fixture__mixed", {})).text).toBe(
      "first\n[image omitted: image/png]\n[resource file:///a.txt]\nresource text\n[resource link: file:///b.txt]",
    );
    await expect(access.call("mcp__fixture__nope", {})).rejects.toThrow("Unknown MCP tool");
  });

  it("times out and cancels calls, and reports a crashed server", async () => {
    const mcp = await connect([server({ timeoutMs: 1000 })]);
    const access = mcp.access.create(context(), () => {});
    await expect(access.call("mcp__fixture__slow", {})).rejects.toThrow("timed out after 1000 ms");
    const controller = new AbortController();
    const cancellable = mcp.access.create(context(controller.signal), () => {});
    const pending = cancellable.call("mcp__fixture__slow", {});
    setTimeout(() => controller.abort(), 50);
    await expect(pending).rejects.toThrow("cancelled");
    await expect(access.call("mcp__fixture__crash", {})).rejects.toThrow("exited");
    await expect(access.call("mcp__fixture__echo", {})).rejects.toThrow("not running");
  });

  it("checks authorization before every call", async () => {
    const mcp = await connect([server()]);
    const access = mcp.access.create(context(), () => {
      throw Error("revoked");
    });
    await expect(access.call("mcp__fixture__echo", {})).rejects.toThrow("revoked");
  });

  it("reports an unavailable server without failing the others", async () => {
    const mcp = await connect([
      server({ name: "old" }, { MCP_FIXTURE_MODE: "bad-version" }),
      server({ name: "missing", command: "/nonexistent/mcp-server" }),
      server({ name: "good" }),
    ]);
    expect(mcp.diagnostics[0]).toContain(
      "old unavailable: MCP server chose an unsupported protocol version",
    );
    expect(mcp.diagnostics[1]).toContain("missing unavailable");
    expect(mcp.descriptors.every((tool) => tool.server === "good")).toBe(true);
  });

  it("rejects invalid configuration before starting anything", async () => {
    for (const config of [
      server({ name: "Bad" }),
      server({ cwd: "relative" }),
      server({ timeoutMs: 10 }),
      server({}, { "BAD-NAME": "x" }),
    ])
      await expect(connectMcpServers([config])).rejects.toThrow();
    await expect(connectMcpServers([server(), server()])).rejects.toThrow("unique");
  });

  it("stops the server process on close", async () => {
    const dir = mkdtempSync(join(tmpdir(), "moyyi-mcp-"));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const pidFile = join(dir, "pid");
    const mcp = await connectMcpServers([server({}, { MCP_FIXTURE_PID_FILE: pidFile })]);
    const pid = Number(readFileSync(pidFile, "utf8"));
    expect(() => process.kill(pid, 0)).not.toThrow();
    await mcp.close();
    await delay(50);
    expect(() => process.kill(pid, 0)).toThrow();
  });
});
