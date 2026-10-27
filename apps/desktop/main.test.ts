import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => {
  const contents = {
    mainFrame: {},
    setWindowOpenHandler: vi.fn(),
    on: vi.fn(),
    send: vi.fn(),
  };
  return {
    contents,
    handlers: new Map<string, (event: unknown, value?: unknown) => Promise<unknown>>(),
    state: {
      status: "ready",
      activeSessionId: "session_current",
      workspaceRoot: "/selected/workspace",
      run: null as null | { id: string },
    },
    confirm: vi.fn(),
    send: vi.fn(),
    error: vi.fn(),
    close: vi.fn(),
    pending: false,
    picker: vi.fn(),
    maintenance: vi.fn(),
    maintenanceClose: vi.fn(),
  };
});
vi.mock("electron", () => ({
  app: {
    setName: vi.fn(),
    enableSandbox: vi.fn(),
    requestSingleInstanceLock: () => true,
    on: vi.fn(),
    whenReady: () => Promise.resolve(),
    getAppPath: () => "/installed/app",
    quit: vi.fn(),
  },
  BrowserWindow: class {
    webContents = native.contents;
    isDestroyed() {
      return false;
    }
    on() {}
    loadURL() {
      return Promise.resolve();
    }
  },
  dialog: {
    showMessageBox: native.confirm,
    showErrorBox: native.error,
    showSaveDialog: native.picker,
    showOpenDialog: native.picker,
  },
  ipcMain: {
    handle: (name: string, handler: (event: unknown, value?: unknown) => Promise<unknown>) =>
      native.handlers.set(name, handler),
  },
  Menu: { buildFromTemplate: () => ({}), setApplicationMenu: vi.fn() },
  session: {
    defaultSession: {
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      webRequest: { onBeforeRequest: vi.fn() },
    },
  },
  shell: { showItemInFolder: vi.fn() },
}));
vi.mock("./bridge.ts", () => ({
  DesktopProcess: class {
    getState() {
      return Promise.resolve(structuredClone(native.state));
    }
    send = native.send;
    close = native.close;
    hasPendingCommands() {
      return native.pending;
    }
  },
}));
vi.mock("./host/maintenance-client.ts", () => ({
  MaintenanceProcess: class {
    run = native.maintenance;
    close = native.maintenanceClose;
  },
}));

const request = { sessionId: "session_current", writes: true, checks: false };
function event() {
  return {
    sender: native.contents,
    senderFrame: Object.assign(native.contents.mainFrame, {
      url: "file:///installed/app/index.html",
    }),
  };
}
function call(name: string, value: unknown, sender: unknown = event()) {
  const handler = native.handlers.get(name);
  if (!handler) throw Error(`Missing IPC ${name}`);
  return handler(sender, value);
}

beforeEach(async () => {
  vi.resetModules();
  native.handlers.clear();
  native.state = {
    status: "ready",
    activeSessionId: "session_current",
    workspaceRoot: "/selected/workspace",
    run: null,
  };
  native.confirm.mockReset().mockResolvedValue({ response: 1 });
  native.send.mockReset().mockImplementation(async () => structuredClone(native.state));
  native.error.mockReset();
  native.close.mockReset().mockResolvedValue(undefined);
  native.pending = false;
  native.picker.mockReset().mockResolvedValue({
    canceled: false,
    filePath: "/selected/backup",
    filePaths: ["/selected/backup"],
  });
  native.maintenance.mockReset().mockResolvedValue({ kind: "backup", path: "/selected/backup" });
  native.maintenanceClose.mockReset().mockResolvedValue(undefined);
  await import("./main.ts");
  await vi.waitFor(() => expect(native.handlers.has("moyyi:permissions")).toBe(true));
  expect(native.error).not.toHaveBeenCalled();
});

describe("native maintenance entry", () => {
  it("rejects forged paths, active tasks and queued commands before showing a picker", async () => {
    await expect(call("moyyi:backup", { destination: "/" })).rejects.toThrow("自定义");
    native.pending = true;
    await expect(call("moyyi:backup", undefined)).rejects.toThrow("当前操作");
    native.pending = false;
    native.state.run = { id: "run_live" };
    await expect(call("moyyi:restore", undefined)).rejects.toThrow("结束当前任务");
    expect(native.picker).not.toHaveBeenCalled();
    expect(native.close).not.toHaveBeenCalled();
  });
  it("holds the mutation gate and starts maintenance only after the actual worker closes", async () => {
    let finish: (() => void) | undefined;
    native.close.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = call("moyyi:backup", undefined);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    await expect(call("moyyi:act", { type: "list", offset: 0 })).rejects.toThrow("当前选择");
    await expect(
      call("moyyi:configure", { settings: { preset: "flash", maxRequests: 3, timeoutMs: 120000 } }),
    ).rejects.toThrow("当前选择");
    expect(native.maintenance).not.toHaveBeenCalled();
    finish?.();
    await pending;
    expect(native.maintenance).toHaveBeenCalledWith({
      mode: "backup",
      destination: "/selected/backup",
    });
    expect(native.maintenanceClose).toHaveBeenCalledOnce();
    await call("moyyi:act", { type: "list", offset: 0 });
  });
  it("does nothing after picker/restore confirmation cancellation and recovers after helper failure", async () => {
    native.picker.mockResolvedValueOnce({ canceled: true });
    expect(await call("moyyi:backup", undefined)).toBeNull();
    native.confirm.mockResolvedValueOnce({ response: 0 });
    expect(await call("moyyi:restore", undefined)).toBeNull();
    expect(native.close).not.toHaveBeenCalled();
    native.maintenance.mockRejectedValueOnce(Error("bad backup"));
    await expect(call("moyyi:restore", undefined)).rejects.toThrow("bad backup");
    expect(native.maintenanceClose).toHaveBeenCalledOnce();
    await call("moyyi:act", { type: "list", offset: 0 });
  });
});

describe("desktop native permission entry", () => {
  it("requires the native confirmation for the exact selected workspace and independent grants", async () => {
    await call("moyyi:permissions", request);
    expect(native.confirm).toHaveBeenCalledOnce();
    const options = native.confirm.mock.calls[0]?.[1];
    expect(options.detail).toContain("/selected/workspace");
    expect(options.detail).toContain("整个工作目录");
    expect(options.detail).toContain("命令检查：关闭");
    expect(options.defaultId).toBe(0);
    expect(native.send).toHaveBeenCalledWith({ type: "permissions", ...request });
  });
  it("keeps dismissal inert and permits revocation without a new grant dialog", async () => {
    native.confirm.mockResolvedValueOnce({ response: 0 });
    await call("moyyi:permissions", request);
    expect(native.send).not.toHaveBeenCalled();
    await call("moyyi:permissions", { ...request, writes: false });
    expect(native.confirm).toHaveBeenCalledOnce();
    expect(native.send).toHaveBeenCalledWith({ type: "permissions", ...request, writes: false });
  });
  it("does not accept generic IPC, another frame, forged fields, or an active run", async () => {
    await expect(call("moyyi:act", { type: "permissions", ...request })).rejects.toThrow(
      "原生入口",
    );
    await expect(
      call("moyyi:permissions", request, {
        ...event(),
        senderFrame: { url: "file:///installed/app/index.html" },
      }),
    ).rejects.toThrow("非当前窗口");
    await expect(call("moyyi:permissions", { ...request, workspaceRoot: "/" })).rejects.toThrow();
    native.state.run = { id: "run_active" };
    await expect(call("moyyi:permissions", request)).rejects.toThrow("结束当前任务");
    expect(native.confirm).not.toHaveBeenCalled();
    expect(native.send).not.toHaveBeenCalled();
  });
  it("invalidates confirmation after a changed session/workspace/status or new run", async () => {
    for (const change of [
      { activeSessionId: "session_other" },
      { workspaceRoot: "/other" },
      { status: "closed" },
      { run: { id: "run_late" } },
    ]) {
      native.state = {
        status: "ready",
        activeSessionId: "session_current",
        workspaceRoot: "/selected/workspace",
        run: null,
      };
      native.confirm.mockImplementationOnce(async () => {
        Object.assign(native.state, change);
        return { response: 1 };
      });
      await expect(call("moyyi:permissions", request)).rejects.toThrow("会话已变化");
    }
    expect(native.send).not.toHaveBeenCalled();
  });
  it("locks other selection/actions until the native confirmation settles, then releases", async () => {
    let resolve: ((value: { response: number }) => void) | undefined;
    native.confirm.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const pending = call("moyyi:permissions", { ...request, checks: true });
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    await expect(
      call("moyyi:act", { type: "start", sessionId: request.sessionId, text: "run" }),
    ).rejects.toThrow("当前选择");
    await expect(call("moyyi:permissions", request)).rejects.toThrow();
    resolve?.({ response: 0 });
    await pending;
    await call("moyyi:act", { type: "list", offset: 0 });
    expect(native.send).toHaveBeenCalledWith({ type: "list", offset: 0 });
  });
});
