import { realpathSync, statSync } from "node:fs";
import { dialog } from "electron";
import { parseDesktopCommand } from "../../host/validation.ts";
import type { NativeFeature } from "../../native/context.ts";
import { contract } from "./contract.ts";
export const nativeFeature = {
  contract,
  handlers: {
    async getState(context, _value) {
      return context.host.getState();
    },
    async selectWorkspace(context, value) {
      const { askEachRead } = contract.channels.selectWorkspace.validate(
        value,
        parseDesktopCommand,
      );
      const state = await context.host.getState();
      if (context.selecting || context.quitting || state.run || state.status !== "ready")
        throw Error("请先结束当前任务。");
      context.selecting = true;
      try {
        const selected = await dialog.showOpenDialog(context.window, {
          title: "选择 moyyi 可读取的工作目录",
          properties: ["openDirectory"],
          buttonLabel: "使用此目录",
        });
        if (selected.canceled || selected.filePaths.length !== 1) return context.host.getState();
        const workspaceRoot = realpathSync(selected.filePaths[0] as string);
        if (!statSync(workspaceRoot).isDirectory()) throw Error("请选择一个文件夹。");
        return context.host.send({ type: "create", workspaceRoot, askEachRead });
      } finally {
        context.selecting = false;
      }
    },
  },
} satisfies NativeFeature;
