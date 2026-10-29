import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app, dialog } from "electron";
import type { MaintenanceRequest } from "../../host/maintenance.ts";
import { MaintenanceProcess } from "../../host/maintenance-client.ts";
import { parseDesktopCommand } from "../../host/validation.ts";
import type { NativeContext, NativeFeature } from "../../native/context.ts";
import { contract } from "./contract.ts";

async function maintain(
  context: NativeContext,
  value: unknown,
  mode: "backup" | "restore" | "rollback",
) {
  contract.channels.createBackup.validate(value, parseDesktopCommand);
  if (
    context.selecting ||
    context.quitting ||
    context.maintenanceDone ||
    context.host.hasPendingCommands()
  )
    throw Error("请先完成当前操作。");
  context.selecting = true;
  let finish = () => {};
  context.maintenanceDone = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let helper: MaintenanceProcess | undefined;
  let stopped = false;
  let armed = false;
  try {
    const state = await context.host.getState();
    if (state.run || state.status !== "ready" || context.host.hasPendingCommands())
      throw Error("请先结束当前任务，再进行维护。");
    let request: MaintenanceRequest;
    if (mode === "backup") {
      const selected = await dialog.showSaveDialog(context.window, {
        title: "备份会话与设置",
        buttonLabel: "创建备份",
        defaultPath: `moyyi-backup-${new Date().toISOString().slice(0, 10)}`,
        message: "创建新的备份文件夹；含会话、撤销快照和设置，不含钥匙串密钥及项目文件。",
        showsTagField: false,
      });
      if (selected.canceled || !selected.filePath) return null;
      request = { mode, destination: selected.filePath };
    } else if (mode === "restore") {
      const selected = await dialog.showOpenDialog(context.window, {
        title: "选择 moyyi 备份文件夹",
        buttonLabel: "选择备份",
        properties: ["openDirectory", "noResolveAliases"],
      });
      if (selected.canceled || selected.filePaths.length !== 1) return null;
      const confirmation = await dialog.showMessageBox(context.window, {
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
        readFileSync(join(dirname(context.directory), "candidate.json"), "utf8"),
      ) as { runtime?: { revision?: unknown } };
      const revision = candidate.runtime?.revision;
      if (typeof revision !== "string" || !/^[a-f0-9]{40}$/.test(revision))
        throw Error("当前安装版本无法核对。");
      request = { mode, expectedCurrentRevision: revision };
    }
    // Selecting blocks all mutation IPC; the worker must really exit before its replacement owns the lock.
    const current = await context.host.getState();
    if (current.run || current.status !== "ready" || context.host.hasPendingCommands())
      throw Error("任务状态已变化，请重新开始维护。");
    await context.host.close();
    stopped = true;
    context.releaseWorker();
    helper = new MaintenanceProcess(context.directory, context.node, mode === "rollback");
    const result = await helper.run(request);
    if (mode === "rollback") {
      const confirmation = await dialog.showMessageBox(context.window, {
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
      if (stopped && !armed && !context.quitting) {
        context.host = context.startWorker();
        await context.host.getState();
      }
    } finally {
      context.selecting = false;
      context.maintenanceDone = undefined;
      finish();
      if (armed) app.quit();
    }
  }
}
export const nativeFeature = {
  contract,
  handlers: {
    createBackup: (context, value) => maintain(context, value, "backup"),
    restoreBackup: (context, value) => maintain(context, value, "restore"),
    rollbackApplication: (context, value) => maintain(context, value, "rollback"),
  },
} satisfies NativeFeature;
