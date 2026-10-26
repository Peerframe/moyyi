import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type ModelStreamEvent,
  type RuntimeEvent,
  type ToolCallId,
  UNKNOWN_USAGE,
} from "../contracts/index.ts";
import { scriptedProfile, scriptedProvider } from "../plugins/provider-scripted/index.ts";
import { ReadOnlyPolicy } from "../policy/index.ts";
import { configureCliHost, createCliRuntime } from "./cli-host.ts";
import type { RuntimeOptions } from "./index.ts";

const roots: string[] = [];
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-cli-grants-")));
  roots.push(root);
  const workspace = join(root, "workspace"),
    data = join(root, "data");
  mkdirSync(workspace);
  writeFileSync(join(workspace, "note.txt"), "source fact\n");
  return { root, workspace, data };
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const terminal: ModelStreamEvent = {
  type: "completed",
  stopReason: "end_turn",
  providerStopReason: null,
  usage: UNKNOWN_USAGE,
};
function call(name: string, args: object, id: string): ModelStreamEvent {
  return {
    type: "part_completed",
    index: 0,
    part: {
      type: "tool_call",
      name,
      rawArguments: JSON.stringify(args),
      callId: id as ToolCallId,
      providerCallId: id,
      providerItemId: null,
      argumentsSource: "verbatim",
    },
  };
}
describe("CLI host grants", () => {
  it("preserves host defaults and changes only an explicit request ceiling", async () => {
    const host: RuntimeOptions = {
      model: scriptedProfile.origin,
      limits: { maxModelRequests: 3, maxRetries: 0, timeoutMs: 120000 },
    };
    expect(await configureCliHost(host, undefined, false)).toEqual(host);
    const configured = await configureCliHost(
      host,
      { workspaceRoot: "/unused", maxRequests: 8 },
      false,
    );
    expect(configured.limits).toEqual({ maxModelRequests: 8, maxRetries: 0, timeoutMs: 120000 });
    expect(configured.workspaceWrites).toBeUndefined();
    expect(configured.workspaceProcesses).toBeUndefined();
    expect(configured.web).toBeUndefined();
    expect(host.limits?.maxModelRequests).toBe(3);
  });
  it("canonicalizes the one selected workspace and keeps file writes separate from read-only commands", async () => {
    const f = fixture(),
      alias = join(f.root, "alias");
    symlinkSync(f.workspace, alias);
    const configured = await configureCliHost(
      {},
      {
        workspaceRoot: alias,
        allowWrite: true,
        allowShell: true,
        webOrigins: ["https://example.com"],
        webDns: "cloudflare-doh",
      },
      false,
    );
    expect(configured.workspaceWrites).toEqual({ roots: [f.workspace], approval: "ask" });
    expect(configured.workspaceProcesses).toEqual({
      roots: [f.workspace],
      approval: "ask",
      workspaceAccess: "read-only",
    });
    expect(configured.web).toEqual({
      allowedOrigins: ["https://example.com"],
      dns: "cloudflare-doh",
      approval: "ask",
    });
  });
  it("refuses to replace custom policies or conflicting existing capability configuration", async () => {
    const policy = new ReadOnlyPolicy();
    for (const launch of [
      { workspaceRoot: "/unused", allowWrite: true },
      { workspaceRoot: "/unused", allowShell: true },
      { workspaceRoot: "/unused", webOrigins: ["https://example.com"] },
    ])
      await expect(configureCliHost({ policy }, launch, false)).rejects.toThrow(
        /custom host policy/,
      );
    await expect(configureCliHost({ policy }, undefined, true)).rejects.toThrow(
      /custom host policy/,
    );
    for (const [host, launch] of [
      [{ workspaceWrites: { roots: ["/unused"] } }, { workspaceRoot: "/unused", allowWrite: true }],
      [
        { workspaceProcesses: { roots: ["/unused"] } },
        { workspaceRoot: "/unused", allowShell: true },
      ],
      [
        { web: { allowedOrigins: [] } },
        { workspaceRoot: "/unused", webOrigins: ["https://example.com"] },
      ],
    ] as const)
      await expect(configureCliHost(host, launch, false)).rejects.toThrow(/conflicts/);
    expect(
      (await configureCliHost({ policy }, { workspaceRoot: "/unused", maxRequests: 4 }, false))
        .policy,
    ).toBe(policy);
  });
  it("asks for reads and writes together, confines actual effects and leaves outside files unchanged", async () => {
    const f = fixture();
    const model = scriptedProvider([
      [call("read", { path: "note.txt" }, "read"), { ...terminal, stopReason: "tool_use" }],
      [
        call("create", { path: "report.txt", text: "source fact\n" }, "create"),
        { ...terminal, stopReason: "tool_use" },
      ],
      [
        call("create", { path: "../escape.txt", text: "bad" }, "escape"),
        { ...terminal, stopReason: "tool_use" },
      ],
      [{ type: "part_completed", index: 0, part: { type: "text", text: "done" } }, terminal],
    ]);
    const runtime = await createCliRuntime({
      demo: false,
      dataDirectory: f.data,
      approveReads: true,
      host: {
        model: scriptedProfile.origin,
        plugins: [{ plugin: model.plugin }],
        limits: { maxRetries: 0 },
        projectInstructions: false,
      },
      launch: { workspaceRoot: f.workspace, allowWrite: true, maxRequests: 4 },
    });
    const events: RuntimeEvent[] = [];
    runtime.subscribe((e) => {
      events.push(e);
      if (e.type === "approval.requested")
        void runtime.send({
          type: "approval.respond",
          effectId: e.effectId,
          digest: e.digest,
          decision: "approve",
        });
    });
    try {
      await runtime.send({ type: "session.create", workspaceRoot: f.workspace });
      const ready = events.find((e) => e.type === "session.ready");
      if (ready?.type !== "session.ready") throw Error("No session");
      await runtime.send({
        type: "run.start",
        sessionId: ready.sessionId,
        input: [{ type: "text", text: "Read, write, verify the grant" }],
      });
      await runtime.idle();
      expect(events.filter((e) => e.type === "approval.requested")).toHaveLength(2);
      expect(readFileSync(join(f.workspace, "report.txt"), "utf8")).toBe("source fact\n");
      expect(existsSync(join(f.root, "escape.txt"))).toBe(false);
      expect(model.client.requests).toHaveLength(4);
      expect(model.client.requests[3]?.toolChoice).toBe("none");
      const results = events.flatMap((e) =>
        e.type === "entry.appended" && e.entry.body.kind === "tool_results"
          ? e.entry.body.results
          : [],
      );
      expect(results.find((r) => r.callId === "escape")?.status).not.toBe("succeeded");
    } finally {
      await runtime.close();
    }
  });
});
