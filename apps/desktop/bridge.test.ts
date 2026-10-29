import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopProcess } from "./bridge.ts";
import { desktopStateSchema } from "./native/state-schema.ts";
import type { DesktopState } from "./shared.ts";

const pipe = vi.hoisted(() => ({ fork: vi.fn() }));
vi.mock("node:child_process", () => ({ fork: pipe.fork }));

class ChildPipe extends EventEmitter {
  connected = true;
  exitCode: number | null = null;
  signalCode: string | null = null;
  send = vi.fn((_message: unknown, done: (error: Error | null) => void) => done(null));
  disconnect = vi.fn(() => {
    this.connected = false;
    this.emit("disconnect");
  });
  exit(code = 0) {
    this.exitCode = code;
    this.connected = false;
    this.emit("exit", code, null);
  }
}

const initial: DesktopState = {
  ...desktopStateSchema.initialize({ options: {}, display: {} }),
  status: "ready",
  connection: { ready: true },
  settings: { preset: "flash", maxRequests: 3, timeoutMs: 120_000 },
  materials: [],
  reportTarget: null,
  permissions: { writes: false, checks: false },
  webAccess: { allowedOrigins: [], dns: "system" },
  sources: { items: [], truncated: false },
  openedHistory: false,
  effects: { items: [], offset: 0, hasMore: false },
  effectInspection: null,
  artifacts: { items: [], offset: 0, hasMore: false },
  artifactPreview: null,
  sessions: { items: [], offset: 0, hasMore: false },
  activeSessionId: null,
  workspaceRoot: null,
  model: { provider: "fixture", model: "scripted" },
  budgets: { maxRequests: 3, timeoutMs: 120_000, maxOutputTokens: 8192 },
  askEachRead: false,
  messages: [],
  historyTruncated: false,
  streamText: "",
  run: null,
  outcome: null,
  pendingApproval: null,
  error: null,
};

let child: ChildPipe;
beforeEach(() => {
  child = new ChildPipe();
  pipe.fork.mockReset().mockReturnValue(child);
});
afterEach(() => {
  child.exit();
  vi.useRealTimers();
});

function start() {
  const onState = vi.fn();
  const process = new DesktopProcess("/installed/app", "/installed/node/bin/node", onState);
  child.emit("message", { type: "state", state: structuredClone(initial) });
  return { process, onState };
}

async function sentCommand() {
  await vi.waitFor(() => expect(child.send).toHaveBeenCalledTimes(1));
  return child.send.mock.calls[0]?.[0] as { id: number; command: { type: string } };
}

describe("desktop inherited process pipe", () => {
  it("round-trips web grants and revokes them on process failure without replaying sources", async () => {
    const { process, onState } = start();
    const granted = {
      ...initial,
      webAccess: { allowedOrigins: ["https://example.com"], dns: "cloudflare-doh" as const },
    };
    const saving = process.send({
      type: "web.permissions",
      sessionId: "session_current",
      ...granted.webAccess,
    });
    const sent = await sentCommand();
    expect(sent.command.type).toBe("web.permissions");
    child.emit("message", { type: "state", state: structuredClone(granted) });
    child.emit("message", { type: "ack", id: sent.id });
    expect((await saving).webAccess).toEqual(granted.webAccess);
    child.emit("message", { type: "fatal", message: "Local worker stopped" });
    expect(onState.mock.lastCall?.[0].webAccess).toEqual(initial.webAccess);
    expect(child.send).toHaveBeenCalledOnce();
    child.exit();
    await process.close();
  });
  it.each(["kimi-cn", "kimi-global"] as const)(
    "accepts existing %s high settings in startup and configure state",
    async (preset) => {
      const onState = vi.fn();
      const process = new DesktopProcess("/installed/app", "/installed/node/bin/node", onState);
      const high: DesktopState = {
        ...initial,
        settings: {
          preset,
          kimiReasoningEffort: "high",
          maxRequests: 8,
          timeoutMs: 300_000,
        },
      };
      child.emit("message", { type: "state", state: structuredClone(high) });
      expect((await process.getState()).settings).toEqual(high.settings);
      const saving = process.send({ type: "configure", settings: high.settings });
      const sent = await sentCommand();
      child.emit("message", { type: "state", state: structuredClone(high) });
      child.emit("message", { type: "ack", id: sent.id });
      expect((await saving).settings).toEqual(high.settings);
      expect(child.disconnect).not.toHaveBeenCalled();
      child.exit();
      await process.close();
    },
  );

  it.each(["unsupported", null, 1])(
    "disconnects a state with invalid preset=%s",
    async (preset) => {
      const { process } = start();
      child.emit("message", {
        type: "state",
        state: { ...initial, settings: { ...initial.settings, maxRequests: 8, preset } },
      });
      expect(child.disconnect).toHaveBeenCalledOnce();
      await expect(process.getState()).rejects.toThrow("无效数据");
      child.exit();
      await process.close();
    },
  );

  it("uses the packaged Node and fixed worker without inherited Node injection options", async () => {
    const { process } = start();
    const [module, args, options] = pipe.fork.mock.calls[0] as [
      string,
      string[],
      Record<string, unknown>,
    ];
    expect(module).toBe("/installed/app/worker.mjs");
    expect(args).toEqual([]);
    expect(options.execPath).toBe("/installed/node/bin/node");
    expect(options.execArgv).toEqual([]);
    expect(options.stdio).toEqual(["ignore", "ignore", "ignore", "ipc"]);
    expect(options.env).not.toHaveProperty("NODE_OPTIONS");
    expect(options.env).not.toHaveProperty("NODE_PATH");
    child.exit();
    await process.close();
  });

  it("waits for the actual child exit even when the close acknowledgement fails", async () => {
    const { process } = start();
    const settled = vi.fn();
    const closing = process.close().then(settled);
    const sent = await sentCommand();
    expect(sent.command.type).toBe("close");
    child.emit("message", { type: "ack", id: sent.id, error: "close ACK lost" });
    await vi.waitFor(() => expect(child.disconnect).toHaveBeenCalledOnce());
    expect(settled).not.toHaveBeenCalled();
    child.exit();
    await closing;
    expect(settled).toHaveBeenCalledOnce();
  });

  it("shares normal close, disconnects only after ACK and still waits for process exit", async () => {
    const { process } = start();
    const first = process.close();
    expect(process.close()).toBe(first);
    const settled = vi.fn();
    void first.then(settled);
    const sent = await sentCommand();
    expect(child.disconnect).not.toHaveBeenCalled();
    child.emit("message", { type: "ack", id: sent.id });
    await vi.waitFor(() => expect(child.disconnect).toHaveBeenCalledOnce());
    expect(settled).not.toHaveBeenCalled();
    child.exit();
    await first;
    expect(settled).toHaveBeenCalledOnce();
  });

  it("does not restore a ready view from a late state after a fatal failure", async () => {
    const { process, onState } = start();
    child.emit("message", { type: "fatal", message: "Terminal failure" });
    expect(child.disconnect).toHaveBeenCalledOnce();
    const published = onState.mock.calls.length;
    expect(onState.mock.lastCall?.[0].connection.ready).toBe(false);
    child.emit("message", { type: "state", state: structuredClone(initial) });
    expect(onState).toHaveBeenCalledTimes(published);
    await expect(process.getState()).rejects.toThrow("Terminal failure");
    const closing = process.close();
    expect(child.send).not.toHaveBeenCalled();
    child.exit();
    await closing;
  });
});
