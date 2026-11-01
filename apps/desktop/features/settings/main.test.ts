import assert from "node:assert/strict";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NativeContext } from "../../native/context.ts";
import type { DesktopConnection } from "./contract.ts";
import { nativeFeature } from "./main.ts";

const native = vi.hoisted(() => ({ confirm: vi.fn() }));
vi.mock("electron", () => ({ dialog: { showMessageBox: native.confirm } }));
beforeEach(() => native.confirm.mockReset().mockResolvedValue({ response: 1 }));

function fixture(credentialDeletion: DesktopConnection["credentialDeletion"] = "delete") {
  const state = {
    status: "ready",
    run: null as null | { id: string },
    activeConnectionId: "active",
    searchConnectionId: null as string | null,
    connections: [
      {
        id: "dormant",
        name: "My backup",
        provider: "deepseek",
        reasoningEffort: "low",
        configured: true,
        credentialDeletion,
      },
    ],
  };
  const host = {
    getState: vi.fn(async () => structuredClone(state)),
    send: vi.fn(async () => structuredClone(state)),
    hasPendingCommands: vi.fn(() => false),
  };
  const context = {
    selecting: false,
    quitting: false,
    host,
    window: {},
  } as unknown as NativeContext;
  const remove = () =>
    nativeFeature.handlers.changeConnection(context, { action: "delete", id: "dormant" });
  return { state, host, context, remove };
}

describe("native connection deletion confirmation", () => {
  it.each([
    ["delete", "同时删除此连接专用的钥匙串密钥"],
    ["retain-legacy", "旧版共享密钥仍保留在系统钥匙串中"],
    ["retain-shared", "密钥仍被其他连接使用"],
  ] as const)(
    "shows the connection name and %s consequence before deletion",
    async (mode, copy) => {
      const { host, context, remove } = fixture(mode);
      native.confirm.mockImplementationOnce(async (_window, options) => {
        expect(context.selecting).toBe(true);
        expect(host.send).not.toHaveBeenCalled();
        expect(options).toMatchObject({
          message: "删除连接“My backup”？",
          defaultId: 0,
          cancelId: 0,
          buttons: ["取消", "删除连接"],
        });
        expect(options.detail).toContain(copy);
        return { response: 1 };
      });
      await remove();
      expect(host.send).toHaveBeenCalledExactlyOnceWith({
        type: "connection.change",
        change: { action: "delete", id: "dormant" },
      });
      expect(context.selecting).toBe(false);
    },
  );

  it("cancels without sending a mutation and releases the selection gate", async () => {
    const { host, context, state, remove } = fixture();
    native.confirm.mockResolvedValueOnce({ response: 0 });
    expect(await remove()).toEqual(state);
    expect(host.send).not.toHaveBeenCalled();
    expect(context.selecting).toBe(false);
  });

  it("explains that deleting the search connection also clears search selection", async () => {
    const { state, remove } = fixture("retain-legacy");
    state.searchConnectionId = "dormant";
    await remove();
    expect(native.confirm.mock.calls[0]?.[1].detail).toContain("网页搜索设置也将清除");
  });

  it.each(["name", "ownership", "active", "search", "running", "pending", "quitting"])(
    "refuses stale confirmation after %s changes",
    async (change) => {
      const { state, host, context, remove } = fixture();
      native.confirm.mockImplementationOnce(async () => {
        const selected = state.connections[0];
        assert(selected, "Expected the confirmation's selected connection");
        if (change === "name") selected.name = "Changed";
        if (change === "ownership") selected.credentialDeletion = "retain-legacy";
        if (change === "active") state.activeConnectionId = "dormant";
        if (change === "search") state.searchConnectionId = "dormant";
        if (change === "running") state.run = { id: "new-run" };
        if (change === "pending") host.hasPendingCommands.mockReturnValue(true);
        if (change === "quitting") Object.assign(context, { quitting: true });
        return { response: 1 };
      });
      await expect(remove()).rejects.toThrow("状态已变化");
      expect(host.send).not.toHaveBeenCalled();
      expect(context.selecting).toBe(false);
    },
  );

  it("rejects active connection deletion before showing a dialog", async () => {
    const { state, host, remove } = fixture();
    state.activeConnectionId = "dormant";
    await expect(remove()).rejects.toThrow("不能删除当前连接");
    expect(host.send).not.toHaveBeenCalled();
    expect(native.confirm).not.toHaveBeenCalled();
  });

  it("blocks concurrent mutations while confirming and releases its gate after a dialog error", async () => {
    const { context, host, remove } = fixture();
    native.confirm.mockImplementationOnce(async () => {
      await expect(
        nativeFeature.handlers.changeConnection(context, {
          action: "rename",
          id: "dormant",
          name: "Changed",
        }),
      ).rejects.toThrow("当前选择");
      throw Error("Synthetic dialog error");
    });
    await expect(remove()).rejects.toThrow("Synthetic dialog error");
    expect(host.send).not.toHaveBeenCalled();
    expect(context.selecting).toBe(false);
  });
});
