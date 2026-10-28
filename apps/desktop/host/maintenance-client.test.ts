import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MaintenanceProcess } from "./maintenance-client.ts";

const pipe = vi.hoisted(() => ({ fork: vi.fn(), remove: vi.fn(), copy: vi.fn() }));
vi.mock("node:child_process", () => ({ fork: pipe.fork }));
vi.mock("node:fs", () => ({
  constants: { COPYFILE_EXCL: 1 },
  copyFileSync: pipe.copy,
  rmSync: pipe.remove,
  mkdirSync: vi.fn(),
  mkdtempSync: () => "/private/staged-helper",
  lstatSync: () => ({
    isDirectory: () => true,
    isSymbolicLink: () => false,
    uid: process.getuid?.(),
    mode: 0o700,
  }),
}));
class Child extends EventEmitter {
  connected = true;
  channel = { unref: vi.fn() };
  unref = vi.fn();
  send = vi.fn((_value: unknown, done: (error: Error | null) => void) => done(null));
  disconnect = vi.fn(() => {
    this.connected = false;
  });
}
const result = {
  kind: "backup",
  path: "/chosen/backup",
  rescuePath: null,
  sessionCount: 2,
  schemaVersion: 2,
  persistedFormat: 1,
  targetRevision: null,
  settingsPreserved: true,
  workspacesUntouched: true,
  credentialsExported: false,
};
let child: Child;
beforeEach(() => {
  child = new Child();
  pipe.fork.mockReset().mockReturnValue(child);
  pipe.remove.mockClear();
  pipe.copy.mockClear();
});
afterEach(() => child.emit("exit", 0));
function start(rollback = false) {
  const helper = new MaintenanceProcess("/installed/app", "/installed/node", rollback);
  child.emit("message", { type: "ready" });
  return helper;
}
async function requested() {
  await vi.waitFor(() => expect(child.send).toHaveBeenCalled());
}
describe("desktop maintenance helper ownership", () => {
  it("does not resolve backup before the helper really exits", async () => {
    const helper = start();
    const pending = helper.run({ mode: "backup", destination: "/chosen/backup" });
    const done = vi.fn();
    void pending.then(done);
    await requested();
    child.emit("message", { type: "result", id: 1, result });
    await Promise.resolve();
    expect(done).not.toHaveBeenCalled();
    child.emit("exit", 0);
    expect(await pending).toEqual(result);
    const [entry, args, options] = pipe.fork.mock.calls[0] ?? [];
    expect(entry).toBe("/installed/app/maintenance-worker.mjs");
    expect(args).toEqual([]);
    expect(options.env.NODE_OPTIONS).toBeUndefined();
    expect(options.execArgv).toEqual([]);
    await expect(helper.run({ mode: "backup", destination: "/other" })).rejects.toThrow("重复");
  });
  it("stages fixed rollback bytes and keeps IPC connected after explicit arm", async () => {
    const helper = start(true);
    expect(pipe.copy).toHaveBeenCalledTimes(2);
    const pending = helper.run({ mode: "rollback", expectedCurrentRevision: "a".repeat(40) });
    await requested();
    child.emit("message", {
      type: "prepared",
      id: 1,
      result: { ...result, kind: "rollback", targetRevision: "b".repeat(40) },
    });
    await pending;
    const arm = helper.arm();
    await vi.waitFor(() => expect(child.send).toHaveBeenCalledTimes(2));
    expect(child.send.mock.calls[1]?.[0]).toEqual({ type: "arm", id: 1 });
    child.emit("message", { type: "armed", id: 1 });
    await arm;
    await helper.close();
    expect(child.disconnect).not.toHaveBeenCalled();
    expect(child.unref).toHaveBeenCalledOnce();
    expect(child.channel.unref).toHaveBeenCalledOnce();
    expect(pipe.remove).not.toHaveBeenCalled();
  });
  it("rejects invalid receipts and waits for unarmed cancellation exit", async () => {
    const helper = start();
    const pending = helper.run({ mode: "restore", backupPath: "/backup" });
    await requested();
    child.emit("message", {
      type: "result",
      id: 1,
      result: { ...result, credentialsExported: true },
    });
    await expect(pending).rejects.toThrow("无效结果");
    let closed = false;
    const close = helper.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    expect(child.disconnect).toHaveBeenCalledOnce();
    child.emit("exit", 0);
    await close;
  });
});
