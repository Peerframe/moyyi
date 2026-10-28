import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    clipboardRead: vi.fn(),
    tempDirectory: "",
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
    getPath: () => native.tempDirectory,
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
  clipboard: { read: native.clipboardRead },
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
  native.clipboardRead.mockReset().mockResolvedValue([]);
  await import("./main.ts");
  await vi.waitFor(() => expect(native.handlers.has("moyyi:permissions")).toBe(true));
  expect(native.error).not.toHaveBeenCalled();
});

const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});
function files() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-native-m6-")));
  temporary.push(directory);
  const workspace = join(directory, "workspace");
  const temp = join(directory, "temporary");
  mkdirSync(workspace);
  mkdirSync(temp);
  native.tempDirectory = temp;
  native.state.workspaceRoot = workspace;
  return { directory, workspace, temp };
}
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZC8sAAAAASUVORK5CYII=",
  "base64",
);
function clipboardPng(bytes: Buffer = png) {
  const getType = vi
    .fn()
    .mockResolvedValue(new Blob([new Uint8Array(bytes)], { type: "image/png" }));
  native.clipboardRead.mockResolvedValue([{ types: ["image/png"], getType }]);
  return getType;
}

describe("native M6 materials and saving", () => {
  const selected = { sessionId: "session_current" };
  const drop = { ...selected, paths: ["/external/source.md"] };
  it("keeps imports behind native entry points and rejected confirmations inert", async () => {
    await expect(call("moyyi:act", { type: "materials.import", ...drop })).rejects.toThrow(
      "原生入口",
    );
    native.confirm.mockResolvedValueOnce({ response: 0 });
    await call("moyyi:import-files", drop);
    expect(native.confirm.mock.calls[0]?.[1]).toMatchObject({ defaultId: 0, cancelId: 0 });
    expect(native.confirm.mock.calls[0]?.[1].detail).toContain(drop.paths[0]);
    expect(native.send).not.toHaveBeenCalled();
    native.picker.mockResolvedValueOnce({ canceled: true });
    await call("moyyi:documents", selected);
    expect(native.send).not.toHaveBeenCalled();
    expect(native.picker.mock.calls.at(-1)?.[1].filters).toBeUndefined();
    await call("moyyi:import-files", drop);
    expect(native.send).toHaveBeenCalledExactlyOnceWith({ type: "materials.import", ...drop });
  });
  it("claims the drop gate before another selection or generic action can start", async () => {
    let finish: ((value: { response: number }) => void) | undefined;
    native.confirm.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = call("moyyi:import-files", drop);
    const rejected = expect(call("moyyi:documents", selected)).rejects.toThrow("当前选择");
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    await expect(
      call("moyyi:act", { type: "start", ...selected, text: "not admitted" }),
    ).rejects.toThrow("当前选择");
    finish?.({ response: 0 });
    await Promise.all([first, rejected]);
    expect(native.send).not.toHaveBeenCalled();
    await call("moyyi:act", { type: "list", offset: 0 });
    expect(native.send).toHaveBeenCalledOnce();
  });
  it("allows only material cancellation through the action gate while native selection is pending", async () => {
    let finish: ((value: { response: number }) => void) | undefined;
    native.confirm.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const first = call("moyyi:import-files", drop);
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    await call("moyyi:act", { type: "material.cancel", ...selected });
    expect(native.send).toHaveBeenCalledExactlyOnceWith({ type: "material.cancel", ...selected });
    await expect(call("moyyi:act", { type: "list", offset: 0 })).rejects.toThrow("当前选择");
    finish?.({ response: 0 });
    await first;
    expect(native.send).toHaveBeenCalledOnce();
  });
  it("invalidates the file picker after a session switch instead of importing into the next session", async () => {
    native.picker.mockImplementationOnce(async () => {
      native.state.activeSessionId = "session_other";
      return { canceled: false, filePaths: drop.paths };
    });
    await expect(call("moyyi:documents", selected)).rejects.toThrow("会话已变化");
    expect(native.send).not.toHaveBeenCalled();
  });
  it.each([
    { activeSessionId: "other_session" },
    { workspaceRoot: "/other-workspace" },
    { run: { id: "late_run" } },
    { status: "closed" },
    { historyOnly: true },
  ])("rejects a drop confirmation after state changes to %j", async (change) => {
    native.confirm.mockImplementationOnce(async () => {
      Object.assign(native.state, change);
      return { response: 1 };
    });
    await expect(call("moyyi:import-files", drop)).rejects.toThrow("会话已变化");
    expect(native.send).not.toHaveBeenCalled();
  });
  it("reads only the clipboard Blob and cancels before any staging file or worker import", async () => {
    const f = files();
    const getType = clipboardPng();
    await expect(
      call("moyyi:paste-image", { ...selected, bytes: png.toString("base64") }),
    ).rejects.toThrow();
    expect(native.clipboardRead).not.toHaveBeenCalled();
    native.confirm.mockResolvedValueOnce({ response: 0 });
    await call("moyyi:paste-image", selected);
    expect(getType).toHaveBeenCalledExactlyOnceWith("image/png");
    expect(native.send).not.toHaveBeenCalled();
    expect(readdirSync(f.temp)).toEqual([]);
  });
  it("stages exactly the accepted clipboard PNG, waits for import and removes staging", async () => {
    const f = files();
    clipboardPng();
    let staged = "";
    native.send.mockImplementationOnce(async (command) => {
      expect(command).toMatchObject({ type: "materials.import", ...selected });
      expect(command.paths).toHaveLength(1);
      staged = command.paths[0];
      expect(readFileSync(staged)).toEqual(png);
      expect(staged.startsWith(`${f.temp}/moyyi-paste-`)).toBe(true);
      return structuredClone(native.state);
    });
    await call("moyyi:paste-image", selected);
    expect(native.send).toHaveBeenCalledOnce();
    expect(existsSync(staged)).toBe(false);
    expect(readdirSync(f.temp)).toEqual([]);
  });
  it("rejects oversized clipboard blobs before confirmation, allocation or import", async () => {
    const f = files();
    const arrayBuffer = vi.fn();
    native.clipboardRead.mockResolvedValue([
      { types: ["image/png"], getType: async () => ({ size: 524289, arrayBuffer }) },
    ]);
    await expect(call("moyyi:paste-image", selected)).rejects.toThrow("512KiB");
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(native.confirm).not.toHaveBeenCalled();
    expect(native.send).not.toHaveBeenCalled();
    expect(readdirSync(f.temp)).toEqual([]);
  });
  it.each([{ activeSessionId: "other_session" }, { status: "closed" }, { historyOnly: true }])(
    "rejects a paste after confirmation changes state to %j",
    async (change) => {
      const f = files();
      clipboardPng();
      native.confirm.mockImplementationOnce(async () => {
        Object.assign(native.state, change);
        return { response: 1 };
      });
      await expect(call("moyyi:paste-image", selected)).rejects.toThrow("会话已变化");
      expect(native.send).not.toHaveBeenCalled();
      expect(readdirSync(f.temp)).toEqual([]);
    },
  );
  it("saves receipt-matched bytes and refuses changed source or an existing destination", async () => {
    const f = files();
    const source = join(f.workspace, "report.md");
    const destination = join(f.directory, "saved.md");
    writeFileSync(source, "recorded result");
    const preview = {
      effectId: "effect_report",
      path: "report.md",
      sha256: createHash("sha256").update("recorded result").digest("hex"),
      sourceBytes: 15,
      text: "recorded result",
      truncated: false,
    };
    native.send.mockImplementation(async (command) => {
      expect(command).toEqual({ type: "artifact.open", ...selected, effectId: preview.effectId });
      return { ...native.state, artifactPreview: preview };
    });
    native.picker.mockResolvedValue({ canceled: false, filePath: destination });
    await call("moyyi:save-artifact", { ...selected, effectId: preview.effectId });
    expect(readFileSync(destination, "utf8")).toBe("recorded result");
    writeFileSync(destination, "user destination");
    await expect(
      call("moyyi:save-artifact", { ...selected, effectId: preview.effectId }),
    ).rejects.toThrow();
    expect(readFileSync(destination, "utf8")).toBe("user destination");
    const second = join(f.directory, "second.md");
    native.picker.mockResolvedValue({ canceled: false, filePath: second });
    writeFileSync(source, "changed source");
    await expect(
      call("moyyi:save-artifact", { ...selected, effectId: preview.effectId }),
    ).rejects.toThrow("changed");
    expect(existsSync(second)).toBe(false);
    await expect(
      call("moyyi:save-artifact", { ...selected, effectId: preview.effectId, path: source }),
    ).rejects.toThrow("Invalid");
  });
  it("does not show a save picker for a mismatched receipt identity", async () => {
    native.send.mockResolvedValueOnce({
      ...native.state,
      artifactPreview: { effectId: "other_receipt" },
    });
    await expect(
      call("moyyi:save-artifact", { ...selected, effectId: "effect_report" }),
    ).rejects.toThrow("成果已变化");
    expect(native.picker).not.toHaveBeenCalled();
  });
  it("keeps cancelled or stale save pickers from writing a result copy", async () => {
    const f = files();
    const destination = join(f.directory, "not-saved.md");
    writeFileSync(join(f.workspace, "report.md"), "recorded");
    const preview = {
      effectId: "effect_report",
      path: "report.md",
      sha256: createHash("sha256").update("recorded").digest("hex"),
      sourceBytes: 8,
      text: "recorded",
      truncated: false,
    };
    native.send.mockImplementation(async () => ({ ...native.state, artifactPreview: preview }));
    native.picker.mockResolvedValueOnce({ canceled: true, filePath: destination });
    await call("moyyi:save-artifact", { ...selected, effectId: preview.effectId });
    expect(existsSync(destination)).toBe(false);
    native.picker.mockImplementationOnce(async () => {
      native.state.status = "closed";
      return { canceled: false, filePath: destination };
    });
    await expect(
      call("moyyi:save-artifact", { ...selected, effectId: preview.effectId }),
    ).rejects.toThrow("会话已变化");
    expect(existsSync(destination)).toBe(false);
  });
});

describe("native web permission entry", () => {
  const web = {
    sessionId: "session_current",
    allowedOrigins: ["https://www.iana.org", "https://www.rfc-editor.org"],
    dns: "cloudflare-doh",
  };
  it("confirms exact origins and DNS disclosure before granting, independently from file/report permissions", async () => {
    await call("moyyi:web-permissions", web);
    const prompt = native.confirm.mock.calls[0]?.[1];
    expect(prompt.detail).toContain(web.allowedOrigins.join("\n"));
    expect(prompt.detail).toContain("将网页主机名发送给 Cloudflare");
    expect(prompt.detail).toContain("每次 GET 仍需单独批准");
    expect(prompt.detail).toContain("与报告位置及文件权限独立");
    expect(prompt).toMatchObject({ defaultId: 0, cancelId: 0 });
    expect(native.send).toHaveBeenCalledWith({ type: "web.permissions", ...web });
  });
  it("keeps dismissed confirmation inert and clears without a grant prompt", async () => {
    native.confirm.mockResolvedValueOnce({ response: 0 });
    await call("moyyi:web-permissions", web);
    expect(native.send).not.toHaveBeenCalled();
    await call("moyyi:web-permissions", { ...web, allowedOrigins: [], dns: "system" });
    expect(native.confirm).toHaveBeenCalledOnce();
    expect(native.send).toHaveBeenCalledWith({
      type: "web.permissions",
      ...web,
      allowedOrigins: [],
      dns: "system",
    });
  });
  it("rejects generic actions, foreign frames, forged fields, invalid origins and active runs", async () => {
    await expect(call("moyyi:act", { type: "web.permissions", ...web })).rejects.toThrow(
      "原生入口",
    );
    await expect(
      call("moyyi:web-permissions", web, {
        ...event(),
        senderFrame: { url: "file:///installed/app/index.html" },
      }),
    ).rejects.toThrow("非当前窗口");
    for (const changed of [
      { type: "permissions" },
      { workspaceRoot: "/" },
      { dns: "custom" },
      { allowedOrigins: ["https://example.com/path"] },
      { allowedOrigins: ["https://127.0.0.1"] },
    ])
      await expect(call("moyyi:web-permissions", { ...web, ...changed })).rejects.toThrow();
    native.state.run = { id: "active" };
    await expect(call("moyyi:web-permissions", web)).rejects.toThrow("结束当前任务");
    expect(native.confirm).not.toHaveBeenCalled();
    expect(native.send).not.toHaveBeenCalled();
  });
  it.each([
    { activeSessionId: "session_other" },
    { workspaceRoot: "/other" },
    { status: "closed" },
    { run: { id: "late" } },
  ])("rejects stale confirmation after %j", async (changed) => {
    native.confirm.mockImplementationOnce(async () => {
      Object.assign(native.state, changed);
      return { response: 1 };
    });
    await expect(call("moyyi:web-permissions", web)).rejects.toThrow("会话已变化");
    expect(native.send).not.toHaveBeenCalled();
  });
  it("holds the selection gate through the native dialog and releases after cancellation", async () => {
    let resolve: ((value: { response: number }) => void) | undefined;
    native.confirm.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const saving = call("moyyi:web-permissions", web);
    await vi.waitFor(() => expect(resolve).toBeTypeOf("function"));
    await expect(
      call("moyyi:act", { type: "start", sessionId: web.sessionId, text: "run" }),
    ).rejects.toThrow("当前选择");
    await expect(call("moyyi:permissions", request)).rejects.toThrow();
    resolve?.({ response: 0 });
    await saving;
    await call("moyyi:act", { type: "list", offset: 0 });
    expect(native.send).toHaveBeenCalledWith({ type: "list", offset: 0 });
  });
  it("claims one native confirmation atomically for simultaneous web requests", async () => {
    let resolve: ((value: { response: number }) => void) | undefined;
    native.confirm.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const first = call("moyyi:web-permissions", web);
    const second = call("moyyi:web-permissions", web);
    const rejection = expect(second).rejects.toThrow("当前选择");
    await vi.waitFor(() => expect(native.confirm).toHaveBeenCalledOnce());
    resolve?.({ response: 0 });
    await Promise.all([first, rejection]);
    expect(native.send).not.toHaveBeenCalled();
  });
  it.each([
    ["moyyi:permissions", true],
    ["moyyi:permissions", false],
    ["moyyi:documents", true],
    ["moyyi:documents", false],
    ["moyyi:report-target", true],
    ["moyyi:report-target", false],
  ] as const)("shares the gate with %s, web first=%s", async (other, webFirst) => {
    let resolve: ((value: { response: number; canceled: boolean }) => void) | undefined;
    const hold = () =>
      new Promise((r) => {
        resolve = r;
      });
    native.confirm.mockImplementation(hold);
    native.picker.mockImplementation(hold);
    const otherRequest = other === "moyyi:permissions" ? request : { sessionId: web.sessionId };
    const first = webFirst ? call("moyyi:web-permissions", web) : call(other, otherRequest);
    const second = webFirst ? call(other, otherRequest) : call("moyyi:web-permissions", web);
    const rejection = expect(second).rejects.toThrow("当前选择");
    await vi.waitFor(() =>
      expect(native.confirm.mock.calls.length + native.picker.mock.calls.length).toBe(1),
    );
    resolve?.({ response: 0, canceled: true });
    await Promise.all([first, rejection]);
    expect(native.send).not.toHaveBeenCalled();
  });
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
