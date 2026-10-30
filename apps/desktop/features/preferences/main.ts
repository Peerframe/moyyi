import { dialog } from "electron";
import { claimSelection, type NativeFeature } from "../../native/context.ts";
import { contract } from "./contract.ts";
export const nativeFeature = {
  contract,
  handlers: {
    async selectSkill(context) {
      const before = await context.host.getState();
      if (before.run || before.status !== "ready") throw Error("请先结束当前任务。");
      claimSelection(context);
      try {
        const result = await dialog.showOpenDialog(context.window, {
          title: "选择包含 SKILL.md 的目录",
          properties: ["openDirectory"],
        });
        const current = await context.host.getState();
        if (context.quitting || current.run || current.status !== "ready")
          throw Error("当前状态已改变，请重新选择。");
        if (result.canceled || result.filePaths.length !== 1) return current;
        return context.host.send({ type: "skill.inspect", directory: result.filePaths[0] ?? "" });
      } finally {
        context.selecting = false;
      }
    },
  },
} satisfies NativeFeature<typeof contract>;
