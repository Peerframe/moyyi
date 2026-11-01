import { dialog } from "electron";
import { parseDesktopCommand } from "../../host/validation.ts";
import { claimSelection, type NativeFeature } from "../../native/context.ts";
import { contract } from "./contract.ts";
export const nativeFeature = {
  contract,
  handlers: {
    async changeConnection(context, change) {
      if (context.selecting || context.quitting) throw Error("请先完成或取消当前选择。");
      const command = parseDesktopCommand({ type: "connection.change", change });
      if (command.type !== "connection.change") throw Error("Invalid connection change");
      if (command.change.action !== "delete") return context.host.send(command);
      const id = command.change.id;
      claimSelection(context);
      try {
        const state = await context.host.getState();
        if (state.run || state.status !== "ready" || context.host.hasPendingCommands())
          throw Error("请先结束当前任务，再删除连接。");
        const connection = state.connections.find((c) => c.id === id);
        if (!connection) throw Error("连接不存在，请重新打开设置。");
        if (id === state.activeConnectionId) throw Error("不能删除当前连接，请先切换连接。");
        const consequence = {
          delete: "同时删除此连接专用的钥匙串密钥（如存在）。此操作无法撤销。",
          "retain-legacy":
            "只解除此连接在设置中的关联。旧版共享密钥仍保留在系统钥匙串中，供旧版应用或 CLI 使用。",
          "retain-shared":
            "只解除此连接在设置中的关联。密钥仍被其他连接使用，将保留在系统钥匙串中。",
        }[connection.credentialDeletion];
        const confirmation = await dialog.showMessageBox(context.window, {
          type: "warning",
          title: "删除模型连接",
          message: `删除连接“${connection.name}”？`,
          detail: `${consequence}\n\n已有会话保留。${state.searchConnectionId === id ? "此连接的网页搜索设置也将清除。" : ""}`,
          buttons: ["取消", "删除连接"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        if (confirmation.response !== 1) return context.host.getState();
        const current = await context.host.getState();
        const selected = current.connections.find((c) => c.id === id);
        if (
          context.quitting ||
          current.run ||
          current.status !== "ready" ||
          context.host.hasPendingCommands() ||
          current.activeConnectionId !== state.activeConnectionId ||
          current.searchConnectionId !== state.searchConnectionId ||
          selected?.name !== connection.name ||
          selected?.provider !== connection.provider ||
          selected?.credentialDeletion !== connection.credentialDeletion
        )
          throw Error("连接或任务状态已变化，请重新确认删除。");
        return await context.host.send(command);
      } finally {
        context.selecting = false;
      }
    },
    async configure(context, options) {
      if (context.selecting || context.quitting) throw Error("请先完成或取消当前选择。 ");
      const command = parseDesktopCommand({ ...options, type: "configure" });
      return context.host.send(command);
    },
  },
} satisfies NativeFeature<typeof contract>;
