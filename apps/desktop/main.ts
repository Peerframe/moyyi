import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, Menu, session } from "electron";
import { DesktopProcess } from "./bridge.ts";
import { stateChannel } from "./native/channels.ts";
import type { NativeContext } from "./native/context.ts";
import { nativeFeatures } from "./native/feature-registry.ts";
import { isTrustedSender } from "./security.ts";

app.setName("moyyi");
app.enableSandbox();
if (!app.requestSingleInstanceLock()) app.quit();
else {
  let window: BrowserWindow | undefined;
  let worker: DesktopProcess | undefined;
  let quitting = false;
  let allowedToQuit = false;
  let selecting = false;
  let maintenanceDone: Promise<void> | undefined;
  app.on("second-instance", () => {
    window?.show();
    window?.focus();
  });
  app.on("before-quit", (event) => {
    if (allowedToQuit) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    void (async () => {
      await maintenanceDone;
      await worker?.close();
    })()
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
      const node = join(dirname(directory), "node/bin/node");
      function startWorker(): DesktopProcess {
        const next = new DesktopProcess(directory, node, (state) => {
          if (!ownedWindow.isDestroyed()) ownedWindow.webContents.send(stateChannel.name, state);
        });
        worker = next;
        return next;
      }
      let host = startWorker();
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
      const context: NativeContext = {
        directory,
        node,
        window: ownedWindow,
        get host() {
          return host;
        },
        set host(value) {
          host = value;
        },
        get selecting() {
          return selecting;
        },
        set selecting(value) {
          selecting = value;
        },
        get quitting() {
          return quitting;
        },
        get maintenanceDone() {
          return maintenanceDone;
        },
        set maintenanceDone(value) {
          maintenanceDone = value;
        },
        startWorker,
        releaseWorker() {
          worker = undefined;
        },
      };
      for (const feature of nativeFeatures) {
        for (const [method, channel] of Object.entries(feature.contract.channels)) {
          const handle = feature.handlers[method];
          if (!handle) throw Error(`Missing native handler: ${feature.contract.id}/${method}`);
          ipcMain.handle(channel.name, async (event, value: unknown) => {
            trusted(event);
            return handle(context, value);
          });
        }
      }
      await ownedWindow.loadURL(entry);
    })
    .catch(() => {
      dialog.showErrorBox("moyyi 无法打开", "桌面窗口初始化失败，请检查安装包后重新打开。");
      app.quit();
    });
}
