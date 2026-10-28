import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, session, shell } from "electron";
import { DesktopProcess } from "./bridge.ts";
import { imagePreview } from "./host/image-preview.ts";
import type { MaintenanceRequest } from "./host/maintenance.ts";
import { MaintenanceProcess } from "./host/maintenance-client.ts";
import { saveReceiptFile } from "./host/save-result.ts";
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
          if (!ownedWindow.isDestroyed()) ownedWindow.webContents.send("moyyi:state", state);
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
      ipcMain.handle("moyyi:state", async (event) => {
        trusted(event);
        return host.getState();
      });
      for (const mode of ["backup", "restore", "rollback"] as const) {
        ipcMain.handle(`moyyi:${mode}`, async (event, value: unknown) => {
          trusted(event);
          if (value !== undefined) throw Error("维护入口不接受自定义路径或命令。");
          if (selecting || quitting || maintenanceDone || host.hasPendingCommands())
            throw Error("请先完成当前操作。");
          selecting = true;
          let finish = () => {};
          maintenanceDone = new Promise<void>((resolve) => {
            finish = resolve;
          });
          let helper: MaintenanceProcess | undefined;
          let stopped = false;
          let armed = false;
          try {
            const state = await host.getState();
            if (state.run || state.status !== "ready" || host.hasPendingCommands())
              throw Error("请先结束当前任务，再进行维护。");
            let request: MaintenanceRequest;
            if (mode === "backup") {
              const selected = await dialog.showSaveDialog(ownedWindow, {
                title: "备份会话与设置",
                buttonLabel: "创建备份",
                defaultPath: `moyyi-backup-${new Date().toISOString().slice(0, 10)}`,
                message: "创建新的备份文件夹；含会话、撤销快照和设置，不含钥匙串密钥及项目文件。",
                showsTagField: false,
              });
              if (selected.canceled || !selected.filePath) return null;
              request = { mode, destination: selected.filePath };
            } else if (mode === "restore") {
              const selected = await dialog.showOpenDialog(ownedWindow, {
                title: "选择 moyyi 备份文件夹",
                buttonLabel: "选择备份",
                properties: ["openDirectory", "noResolveAliases"],
              });
              if (selected.canceled || selected.filePaths.length !== 1) return null;
              const confirmation = await dialog.showMessageBox(ownedWindow, {
                type: "warning",
                title: "恢复会话记录",
                message: "用这份备份替换当前会话记录？",
                detail: `${selected.filePaths[0]}\n\n将先保存当前会话的救援备份。模型设置、钥匙串和工作区文件不变；不会重放操作或恢复写入权限。恢复不是撤销文件修改。`,
                buttons: ["取消", "保存救援备份并恢复"],
                defaultId: 0,
                cancelId: 0,
                noLink: true,
              });
              if (confirmation.response !== 1) return null;
              request = { mode, backupPath: selected.filePaths[0] as string };
            } else {
              const candidate = JSON.parse(
                readFileSync(join(dirname(directory), "candidate.json"), "utf8"),
              ) as { runtime?: { revision?: unknown } };
              const revision = candidate.runtime?.revision;
              if (typeof revision !== "string" || !/^[a-f0-9]{40}$/.test(revision))
                throw Error("当前安装版本无法核对。");
              request = { mode, expectedCurrentRevision: revision };
            }
            // Selecting blocks all mutation IPC; the worker must really exit before its replacement owns the lock.
            const current = await host.getState();
            if (current.run || current.status !== "ready" || host.hasPendingCommands())
              throw Error("任务状态已变化，请重新开始维护。");
            await host.close();
            stopped = true;
            worker = undefined;
            helper = new MaintenanceProcess(directory, node, mode === "rollback");
            const result = await helper.run(request);
            if (mode === "rollback") {
              const confirmation = await dialog.showMessageBox(ownedWindow, {
                type: "warning",
                title: "回退 moyyi 软件",
                message: "退出并回退到上一份已验证的安装？",
                detail: `目标版本：${result.targetRevision?.slice(0, 7)}\n\n保留当前会话、模型设置和工作区文件。当前软件将保存在：${result.rescuePath}\n\n确认后安全退出，再替换软件并重新打开。`,
                buttons: ["取消", "退出并回退"],
                defaultId: 0,
                cancelId: 0,
                noLink: true,
              });
              if (confirmation.response !== 1) return null;
              await helper.arm();
              armed = true;
            }
            return result;
          } finally {
            try {
              await helper?.close();
              if (stopped && !armed && !quitting) {
                host = startWorker();
                await host.getState();
              }
            } finally {
              selecting = false;
              maintenanceDone = undefined;
              finish();
              if (armed) app.quit();
            }
          }
        });
      }
      ipcMain.handle("moyyi:act", async (event, value: unknown) => {
        trusted(event);
        const command = parseDesktopCommand(value);
        if ((selecting && command.type !== "material.cancel") || quitting)
          throw Error("请先完成或取消当前选择。 ");
        if (
          [
            "create",
            "close",
            "configure",
            "materials",
            "materials.import",
            "report.target",
            "permissions",
            "web.permissions",
          ].includes(command.type)
        )
          throw Error("此操作只能从原生入口发起。");
        return host.send(command);
      });
      ipcMain.handle("moyyi:workspace", async (event, value: unknown) => {
        trusted(event);
        const { askEachRead } = pickerOptions(value);
        const state = await host.getState();
        if (selecting || quitting || state.run || state.status !== "ready")
          throw Error("请先结束当前任务。");
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
          quitting ||
          state.run ||
          state.historyOnly ||
          state.status !== "ready" ||
          state.activeSessionId !== sessionId ||
          !state.workspaceRoot
        )
          throw Error("请先结束当前任务，并选择当前会话。 ");
        return state;
      }
      function claimSelection() {
        // Claim synchronously after awaited state checks, including across different native entries.
        if (selecting || quitting) throw Error("请先完成或取消当前选择。 ");
        selecting = true;
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
        if (selecting || quitting) throw Error("请先完成或取消当前选择。 ");
        const command = parseDesktopCommand({ ...value, type: "configure" });
        return host.send(command);
      });
      ipcMain.handle("moyyi:permissions", async (event, value: unknown) => {
        trusted(event);
        if (
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          Object.keys(value).some((key) => !["sessionId", "writes", "checks"].includes(key))
        )
          throw Error("Invalid workspace permissions");
        const command = parseDesktopCommand({ ...value, type: "permissions" });
        if (command.type !== "permissions") throw Error("Invalid workspace permissions");
        const state = await currentSession(command.sessionId);
        claimSelection();
        try {
          if (command.writes || command.checks) {
            const result = await dialog.showMessageBox(ownedWindow, {
              type: "question",
              title: "确认当前工作目录的权限",
              message: "只对当前打开的会话启用以下权限？",
              detail: `${state.workspaceRoot}\n\n${command.writes ? "文件修改：可在整个工作目录内创建、编辑和撤销，每次操作都需审批。" : "文件修改：关闭。"}\n${command.checks ? "命令检查：使用原生沙箱和附带的 Node；工作目录只读，无网络，每次命令都需审批。命令不提供快照撤销。" : "命令检查：关闭。"}\n\n受保护文件仍不可访问。重开会话或修改模型设置会关闭这些权限；已有报告目标将清除。停止任务不会撤销已经完成的修改。`,
              buttons: ["取消", "启用所选权限"],
              defaultId: 0,
              cancelId: 0,
              noLink: true,
            });
            if (result.response !== 1) return host.getState();
          }
          const current = await host.getState();
          if (
            current.status !== "ready" ||
            current.historyOnly ||
            quitting ||
            current.run ||
            current.activeSessionId !== command.sessionId ||
            current.workspaceRoot !== state.workspaceRoot
          )
            throw Error("会话已变化，请重新确认权限。");
          return host.send(command);
        } finally {
          selecting = false;
        }
      });
      ipcMain.handle("moyyi:web-permissions", async (event, value: unknown) => {
        trusted(event);
        if (
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          Object.keys(value).some((key) => !["sessionId", "allowedOrigins", "dns"].includes(key))
        )
          throw Error("Invalid web permissions");
        const command = parseDesktopCommand({ ...value, type: "web.permissions" });
        if (command.type !== "web.permissions") throw Error("Invalid web permissions");
        const state = await currentSession(command.sessionId);
        claimSelection();
        try {
          if (command.allowedOrigins.length > 0) {
            const result = await dialog.showMessageBox(ownedWindow, {
              type: "question",
              title: "确认当前会话的网页访问",
              message: "只允许从以下确切来源读取公开网页？",
              detail: `${state.workspaceRoot}\n\n${command.allowedOrigins.join("\n")}\n\n${command.dns === "cloudflare-doh" ? "DNS：Cloudflare DoH。将网页主机名发送给 Cloudflare 解析，不向其发送页面路径或查询参数。" : "DNS：系统 DNS。使用本机配置的解析服务查询网页主机名。"}\n\n每次 GET 仍需单独批准，目标网站会收到请求路径和查询参数。不会加载子资源、执行网页脚本或携带登录凭据；不自动跟随跳转。返回正文会进入模型上下文，并可在来源面板核对。\n\n授权仅限本次会话，与报告位置及文件权限独立。重新打开会话或修改模型设置后关闭；停止任务不会撤回已发送的请求。`,
              buttons: ["取消", "启用网页访问"],
              defaultId: 0,
              cancelId: 0,
              noLink: true,
            });
            if (result.response !== 1) return host.getState();
          }
          const current = await host.getState();
          if (
            current.status !== "ready" ||
            current.historyOnly ||
            quitting ||
            current.run ||
            current.activeSessionId !== command.sessionId ||
            current.workspaceRoot !== state.workspaceRoot
          )
            throw Error("会话已变化，请重新确认网页访问。");
          return host.send(command);
        } finally {
          selecting = false;
        }
      });
      ipcMain.handle("moyyi:documents", async (event, value: unknown) => {
        trusted(event);
        const sessionId = identity(value);
        const state = await currentSession(sessionId);
        claimSelection();
        try {
          const selected = await dialog.showOpenDialog(ownedWindow, {
            title: "导入文档或图片",
            defaultPath: state.workspaceRoot as string,
            message:
              "可选择工作目录外的材料；每份最多10MiB、最多8份。原件保留，工作目录创建副本；不自动上传或调用模型。",
            properties: ["openFile", "multiSelections", "noResolveAliases"],
            filters: [
              {
                name: "支持的文档",
                extensions: [
                  "pdf",
                  "docx",
                  "xlsx",
                  "pptx",
                  "odt",
                  "ods",
                  "odp",
                  "txt",
                  "md",
                  "csv",
                  "json",
                  "png",
                  "jpg",
                  "jpeg",
                ],
              },
            ],
            buttonLabel: "选择文档",
          });
          if (selected.canceled) return host.getState();
          const current = await host.getState();
          if (
            current.activeSessionId !== sessionId ||
            current.workspaceRoot !== state.workspaceRoot ||
            current.run ||
            current.status !== "ready" ||
            current.historyOnly ||
            quitting
          )
            throw Error("会话已变化，请重新选择文档。");
          return host.send({
            type: "materials.import",
            sessionId,
            paths: selected.filePaths,
          });
        } finally {
          selecting = false;
        }
      });
      ipcMain.handle("moyyi:import-files", async (event, value: unknown) => {
        trusted(event);
        if (
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          Object.keys(value).sort().join() !== "paths,sessionId"
        )
          throw Error("Invalid dropped files");
        const command = parseDesktopCommand({ ...value, type: "materials.import" });
        if (command.type !== "materials.import") throw Error("Invalid dropped files");
        const state = await currentSession(command.sessionId);
        claimSelection();
        try {
          const consent = await dialog.showMessageBox(ownedWindow, {
            type: "question",
            title: "导入外部材料",
            message: "将这些文件复制到当前工作目录？",
            detail: `${state.workspaceRoot}\n\n${command.paths.join("\n")}\n\n保留原件并保存哈希；不会上传或调用模型，也不开放模型写入权限。`,
            buttons: ["取消", "导入副本"],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          });
          if (consent.response !== 1) return host.getState();
          const current = await host.getState();
          if (
            current.activeSessionId !== command.sessionId ||
            current.workspaceRoot !== state.workspaceRoot ||
            current.run ||
            current.status !== "ready" ||
            current.historyOnly ||
            quitting
          )
            throw Error("会话已变化，请重新导入。");
          return host.send(command);
        } finally {
          selecting = false;
        }
      });
      ipcMain.handle("moyyi:paste-image", async (event, value: unknown) => {
        trusted(event);
        const sessionId = identity(value);
        const state = await currentSession(sessionId);
        claimSelection();
        let temporary: string | undefined;
        try {
          const items = await clipboard.read();
          const item = items.find((item) => item.types.includes("image/png"));
          if (!item) throw Error("剪贴板没有 PNG 图片。");
          const blob = await item.getType("image/png");
          if (blob.size > 524288) throw Error("粘贴图片最多512KiB；大图片请通过文件选择导入原件。");
          const bytes = Buffer.from(await blob.arrayBuffer());
          const size = imagePreview(bytes, "png");
          const consent = await dialog.showMessageBox(ownedWindow, {
            type: "question",
            title: "粘贴图片",
            message: "保存剪贴板图片到当前工作目录？",
            detail: `${size.width} × ${size.height} · ${bytes.length} 字节\n\n${state.workspaceRoot}\n只保存和预览，不上传、OCR或调用模型。`,
            buttons: ["取消", "保存图片"],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          });
          if (consent.response !== 1) return host.getState();
          temporary = realpathSync(mkdtempSync(join(app.getPath("temp"), "moyyi-paste-")));
          const path = join(temporary, "clipboard.png");
          writeFileSync(path, bytes, { mode: 0o600, flag: "wx" });
          const current = await host.getState();
          if (
            current.activeSessionId !== sessionId ||
            current.workspaceRoot !== state.workspaceRoot ||
            current.run ||
            current.status !== "ready" ||
            current.historyOnly ||
            quitting
          )
            throw Error("会话已变化，请重新粘贴。");
          return await host.send({ type: "materials.import", sessionId, paths: [path] });
        } finally {
          if (temporary) rmSync(temporary, { recursive: true, force: true });
          selecting = false;
        }
      });
      ipcMain.handle("moyyi:save-artifact", async (event, value: unknown) => {
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
        claimSelection();
        try {
          const state = await host.send(command),
            preview = state.artifactPreview;
          if (!preview || preview.effectId !== command.effectId || !state.workspaceRoot)
            throw Error("成果已变化或不可用。");
          const selected = await dialog.showSaveDialog(ownedWindow, {
            title: "另存成果副本",
            defaultPath: basename(preview.path),
            message: "仅保存当前核对哈希的内容，不覆盖已有文件。",
            buttonLabel: "另存副本",
          });
          if (selected.canceled || !selected.filePath) return host.getState();
          const current = await host.getState();
          if (
            current.activeSessionId !== command.sessionId ||
            current.workspaceRoot !== state.workspaceRoot ||
            current.run ||
            current.status !== "ready" ||
            current.historyOnly ||
            quitting
          )
            throw Error("会话已变化。");
          saveReceiptFile(state.workspaceRoot, preview.path, preview.sha256, selected.filePath, []);
          return host.getState();
        } finally {
          selecting = false;
        }
      });
      ipcMain.handle("moyyi:report-target", async (event, value: unknown) => {
        trusted(event);
        const sessionId = identity(value);
        const state = await currentSession(sessionId);
        claimSelection();
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
            current.run ||
            current.status !== "ready" ||
            current.historyOnly ||
            quitting
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
