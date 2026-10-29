import { dialog } from "electron";
import { parseDesktopCommand } from "../../host/validation.ts";
import { claimSelection, currentSession, type NativeFeature } from "../../native/context.ts";
import { contract } from "./contract.ts";
export const nativeFeature = {
  contract,
  handlers: {
    async configurePermissions(context, value) {
      const command = contract.channels.configurePermissions.validate(value, parseDesktopCommand);
      const state = await currentSession(context, command.sessionId);
      claimSelection(context);
      try {
        if (command.writes || command.checks) {
          const result = await dialog.showMessageBox(context.window, {
            type: "question",
            title: "确认当前工作目录的权限",
            message: "只对当前打开的会话启用以下权限？",
            detail: `${state.workspaceRoot}\n\n${command.writes ? "文件修改：可在整个工作目录内创建、编辑和撤销，每次操作都需审批。" : "文件修改：关闭。"}\n${command.checks ? "命令检查：使用原生沙箱和附带的 Node；工作目录只读，无网络，每次命令都需审批。命令不提供快照撤销。" : "命令检查：关闭。"}\n\n受保护文件仍不可访问。重开会话或修改模型设置会关闭这些权限；已有报告目标将清除。停止任务不会撤销已经完成的修改。`,
            buttons: ["取消", "启用所选权限"],
            defaultId: 0,
            cancelId: 0,
            noLink: true,
          });
          if (result.response !== 1) return context.host.getState();
        }
        const current = await context.host.getState();
        if (
          current.status !== "ready" ||
          current.historyOnly ||
          context.quitting ||
          current.run ||
          current.activeSessionId !== command.sessionId ||
          current.workspaceRoot !== state.workspaceRoot
        )
          throw Error("会话已变化，请重新确认权限。");
        return context.host.send(command);
      } finally {
        context.selecting = false;
      }
    },
  },
} satisfies NativeFeature;
