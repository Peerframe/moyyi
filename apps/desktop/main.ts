import { realpathSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell } from "electron";
import { DesktopProcess } from "./bridge.ts";
import { parseDesktopCommand } from "./host/validation.ts";
import { isTrustedSender, pickerOptions } from "./security.ts";

app.setName("moyyi");
app.enableSandbox();
if (!app.requestSingleInstanceLock()) app.quit();
else {
  let window: BrowserWindow | undefined;
  let worker: DesktopProcess | undefined;
  let quitting = false;
  let allowedToQuit = false;
  let selecting = false;
  app.on("second-instance", () => {
    window?.show();
    window?.focus();
  });
  app.on("before-quit", (event) => {
    if (allowedToQuit) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    void (worker?.close() ?? Promise.resolve())
      .then(() => {
        allowedToQuit = true;
        app.quit();
      })
      .catch(() => {
        quitting = false;
        dialog.showErrorBox(
          "会话尚未安全关闭",
          "请稍候再退出；已有会话未删除。不要启动另一个写入同一会话库的进程。",
        );
      });
  });
  // Electron waits for ESM evaluation before readiness; do not await readiness at top level.
  void app
    .whenReady()
    .then(async () => {
      const directory = app.getAppPath();
      const entry = pathToFileURL(join(directory, "index.html")).href;
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
        callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      // Renderer assets are all local and fixed; even user-initiated links cannot contact the network.
      session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
        callback({ cancel: !details.url.startsWith(`${pathToFileURL(directory).href}/`) }),
      );
      window = new BrowserWindow({
        width: 1120,
        height: 800,
        minWidth: 780,
        minHeight: 560,
        title: "moyyi",
        backgroundColor: "#ffffff",
        webPreferences: {
          preload: join(directory, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          webviewTag: false,
          devTools: false,
          spellcheck: false,
        },
      });
      const ownedWindow = window;
      ownedWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      ownedWindow.webContents.on("will-navigate", (event) => event.preventDefault());
      ownedWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
      ownedWindow.on("close", (event) => {
        if (!allowedToQuit) {
          event.preventDefault();
          app.quit();
        }
      });
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          {
            label: "moyyi",
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
          {
            label: "编辑",
            submenu: [
              { role: "undo" },
              { role: "redo" },
              { type: "separator" },
              { role: "cut" },
              { role: "copy" },
              { role: "paste" },
              { role: "selectAll" },
            ],
          },
          { label: "窗口", submenu: [{ role: "minimize" }, { role: "zoom" }] },
        ]),
      );
      worker = new DesktopProcess(directory, join(dirname(directory), "node/bin/node"), (state) => {
        if (!ownedWindow.isDestroyed()) ownedWindow.webContents.send("moyyi:state", state);
      });
      const host = worker;
      function trusted(event: Electron.IpcMainInvokeEvent): void {
        if (
          ownedWindow.isDestroyed() ||
          !isTrustedSender(
            { sender: event.sender, frame: event.senderFrame, url: event.senderFrame?.url ?? "" },
            {
              sender: ownedWindow.webContents,
              frame: ownedWindow.webContents.mainFrame,
              url: entry,
            },
          )
        )
          throw Error("拒绝非当前窗口的操作。");
      }
      ipcMain.handle("moyyi:state", async (event) => {
        trusted(event);
        return host.getState();
      });
      ipcMain.handle("moyyi:act", async (event, value: unknown) => {
        trusted(event);
        const command = parseDesktopCommand(value);
        if (selecting) throw Error("请先完成或取消当前选择。 ");
        if (["create", "close", "configure", "materials", "report.target"].includes(command.type))
          throw Error("此操作只能从原生入口发起。");
        return host.send(command);
      });
      ipcMain.handle("moyyi:workspace", async (event, value: unknown) => {
        trusted(event);
        const { askEachRead } = pickerOptions(value);
        const state = await host.getState();
        if (selecting || state.run || state.status !== "ready") throw Error("请先结束当前任务。");
        selecting = true;
        try {
          const selected = await dialog.showOpenDialog(ownedWindow, {
            title: "选择 moyyi 可读取的工作目录",
            properties: ["openDirectory"],
            buttonLabel: "使用此目录",
          });
          if (selected.canceled || selected.filePaths.length !== 1) return host.getState();
          const workspaceRoot = realpathSync(selected.filePaths[0] as string);
          if (!statSync(workspaceRoot).isDirectory()) throw Error("请选择一个文件夹。");
          return host.send({ type: "create", workspaceRoot, askEachRead });
        } finally {
          selecting = false;
        }
      });
      async function currentSession(sessionId: string) {
        const state = await host.getState();
        if (
          selecting ||
          state.run ||
          state.status !== "ready" ||
          state.activeSessionId !== sessionId ||
          !state.workspaceRoot
        )
          throw Error("请先结束当前任务，并选择当前会话。 ");
        return state;
      }
      function identity(value: unknown): string {
        if (
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          Object.keys(value).length !== 1 ||
          !("sessionId" in value)
        )
          throw Error("Invalid session selection");
        const parsed = parseDesktopCommand({
          type: "artifacts",
          sessionId: value.sessionId,
          offset: 0,
        });
        if (parsed.type !== "artifacts") throw Error("Invalid session selection");
        return parsed.sessionId;
      }
      ipcMain.handle("moyyi:configure", async (event, value: unknown) => {
        trusted(event);
        if (
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          Object.keys(value).some((k) => !["settings", "apiKey"].includes(k))
        )
          throw Error("Invalid model settings");
        if (selecting) throw Error("请先完成或取消当前选择。 ");
        const command = parseDesktopCommand({ ...value, type: "configure" });
        return host.send(command);
      });
      ipcMain.handle("moyyi:documents", async (event, value: unknown) => {
        trusted(event);
        const sessionId = identity(value);
        const state = await currentSession(sessionId);
        selecting = true;
        try {
          const selected = await dialog.showOpenDialog(ownedWindow, {
            title: "选择工作目录内的文档",
            defaultPath: state.workspaceRoot as string,
            message:
              "只选择当前工作目录内的文件，每份最多10MiB，最多8份；选择不会自动上传或调用模型。",
            properties: ["openFile", "multiSelections", "noResolveAliases"],
            filters: [
              {
                name: "支持的文档",
                extensions: ["pdf", "docx", "xlsx", "pptx", "odt", "ods", "odp"],
              },
            ],
            buttonLabel: "选择文档",
          });
          if (selected.canceled) return host.getState();
          const current = await host.getState();
          if (
            current.activeSessionId !== sessionId ||
            current.workspaceRoot !== state.workspaceRoot ||
            current.run
          )
            throw Error("会话已变化，请重新选择文档。");
          return host.send({
            type: "materials",
            sessionId,
            paths: selected.filePaths.map((p) => relative(state.workspaceRoot as string, p)),
          });
        } finally {
          selecting = false;
        }
      });
      ipcMain.handle("moyyi:report-target", async (event, value: unknown) => {
        trusted(event);
        const sessionId = identity(value);
        const state = await currentSession(sessionId);
        selecting = true;
        try {
          const selected = await dialog.showSaveDialog(ownedWindow, {
            title: "选择报告保存位置",
            defaultPath: join(state.workspaceRoot as string, "report.json"),
            message: "仅授权在当前工作目录新建这一份报告；不能覆盖已有文件，写入前仍需逐次批准。",
            buttonLabel: "设置报告位置",
            showsTagField: false,
            filters: [{ name: "纯文本报告", extensions: ["json", "md", "txt", "csv"] }],
          });
          if (selected.canceled || !selected.filePath) return host.getState();
          const current = await host.getState();
          if (
            current.activeSessionId !== sessionId ||
            current.workspaceRoot !== state.workspaceRoot ||
            current.run
          )
            throw Error("会话已变化，请重新选择报告位置。");
          return host.send({
            type: "report.target",
            sessionId,
            path: relative(state.workspaceRoot as string, selected.filePath),
          });
        } finally {
          selecting = false;
        }
      });
      ipcMain.handle("moyyi:reveal-artifact", async (event, value: unknown) => {
        trusted(event);
        if (
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          Object.keys(value).sort().join() !== "effectId,sessionId"
        )
          throw Error("Invalid result selection");
        const command = parseDesktopCommand({ ...value, type: "artifact.open" });
        if (command.type !== "artifact.open") throw Error("Invalid result selection");
        await currentSession(command.sessionId);
        const state = await host.send(command);
        if (
          !state.artifactPreview ||
          state.artifactPreview.effectId !== command.effectId ||
          state.activeSessionId !== command.sessionId ||
          !state.workspaceRoot
        )
          throw Error("文件已变化或不可用，未打开访达。");
        // Only locate a receipt-verified report. Never execute a generated file or model URL.
        shell.showItemInFolder(join(state.workspaceRoot, state.artifactPreview.path));
        return state;
      });
      await ownedWindow.loadURL(entry);
    })
    .catch(() => {
      dialog.showErrorBox("moyyi 无法打开", "桌面窗口初始化失败，请检查安装包后重新打开。");
      app.quit();
    });
}
