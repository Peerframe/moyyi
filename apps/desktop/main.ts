import { realpathSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, Menu, session } from "electron";
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
        if (command.type === "create" || command.type === "close")
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
      await ownedWindow.loadURL(entry);
    })
    .catch(() => {
      dialog.showErrorBox("moyyi 无法打开", "桌面窗口初始化失败，请检查安装包后重新打开。");
      app.quit();
    });
}
