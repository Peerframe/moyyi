import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DesktopBridge } from "./shared.ts";

const native = vi.hoisted(() => ({
  expose: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  path: vi.fn(),
}));
vi.mock("electron", () => ({
  contextBridge: { exposeInMainWorld: native.expose },
  ipcRenderer: { invoke: native.invoke, on: native.on, removeListener: native.removeListener },
  webUtils: { getPathForFile: native.path },
}));
let bridge: DesktopBridge;
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  native.invoke.mockResolvedValue(null);
  native.path.mockReturnValue("/native/source.md");
  await import("./preload.ts");
  expect(native.expose).toHaveBeenCalledExactlyOnceWith("moyyi", expect.any(Object));
  bridge = native.expose.mock.calls[0]?.[1] as DesktopBridge;
});

describe("feature-generated preload bridge", () => {
  it("exposes only the existing typed entries, without a generic channel or path escape", () => {
    expect(Object.keys(bridge).sort()).toEqual([
      "act",
      "configure",
      "configurePermissions",
      "configureWebAccess",
      "createBackup",
      "getState",
      "importFiles",
      "pasteImage",
      "restoreBackup",
      "revealArtifact",
      "rollbackApplication",
      "saveArtifact",
      "selectDocuments",
      "selectReportTarget",
      "selectWorkspace",
      "subscribe",
    ]);
  });
  it("keeps state and maintenance result checks on generated methods", async () => {
    await expect(bridge.getState()).rejects.toThrow("无效状态");
    expect(native.invoke).toHaveBeenLastCalledWith("moyyi:state");
    await expect(bridge.createBackup()).resolves.toBe(null);
    expect(native.invoke).toHaveBeenLastCalledWith("moyyi:backup");
    native.invoke.mockResolvedValueOnce({ kind: "rollback", path: "/forged" });
    await expect(bridge.rollbackApplication()).rejects.toThrow("无效结果");
    expect(native.invoke).toHaveBeenLastCalledWith("moyyi:rollback");
  });
  it("derives dropped paths only from native Files and refuses empty paths before invoking", async () => {
    const file = new File(["source"], "source.md");
    const options = { sessionId: "current", files: [file] };
    await expect(bridge.importFiles(options)).rejects.toThrow("无效状态");
    expect(native.path).toHaveBeenCalledExactlyOnceWith(file);
    expect(native.invoke).toHaveBeenCalledExactlyOnceWith("moyyi:import-files", {
      sessionId: "current",
      paths: ["/native/source.md"],
    });
    native.invoke.mockClear();
    native.path.mockReturnValueOnce("");
    await expect(bridge.importFiles(options)).rejects.toThrow("本机实际文件");
    await expect(bridge.importFiles({ ...options, files: [] })).rejects.toThrow("最多导入");
    expect(native.invoke).not.toHaveBeenCalled();
  });
  it("keeps state subscriptions bounded and removes exactly the installed listener", () => {
    const listener = vi.fn();
    const unsubscribe = bridge.subscribe(listener);
    expect(native.on).toHaveBeenCalledWith("moyyi:state", expect.any(Function));
    const handler = native.on.mock.calls[0]?.[1];
    handler({}, { status: "ready", arbitrary: "unvalidated" });
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
    expect(native.removeListener).toHaveBeenCalledExactlyOnceWith("moyyi:state", handler);
  });
});
