import { basename, join, relative } from "node:path";
import { dialog, shell } from "electron";
import { saveReceiptFile } from "../../host/save-result.ts";
import { claimSelection, currentSession, type NativeFeature } from "../../native/context.ts";
import { contract } from "./contract.ts";
export const nativeFeature = {
  contract,
  handlers: {
    async saveArtifact(context, command) {
      await currentSession(context, command.sessionId);
      claimSelection(context);
      try {
        const state = await context.host.send(command),
          preview = state.artifactPreview;
        if (!preview || preview.effectId !== command.effectId || !state.workspaceRoot)
          throw Error("成果已变化或不可用。");
        const selected = await dialog.showSaveDialog(context.window, {
          title: "另存成果副本",
          defaultPath: basename(preview.path),
          message: "仅保存当前核对哈希的内容，不覆盖已有文件。",
          buttonLabel: "另存副本",
        });
        if (selected.canceled || !selected.filePath) return context.host.getState();
        const current = await context.host.getState();
        if (
          current.activeSessionId !== command.sessionId ||
          current.workspaceRoot !== state.workspaceRoot ||
          current.run ||
          current.status !== "ready" ||
          current.historyOnly ||
          context.quitting
        )
          throw Error("会话已变化。");
        saveReceiptFile(state.workspaceRoot, preview.path, preview.sha256, selected.filePath, []);
        return context.host.getState();
      } finally {
        context.selecting = false;
      }
    },
    async selectReportTarget(context, sessionId) {
      const state = await currentSession(context, sessionId);
      claimSelection(context);
      try {
        const selected = await dialog.showSaveDialog(context.window, {
          title: "选择报告保存位置",
          defaultPath: join(state.workspaceRoot as string, "report.json"),
          message: "仅授权在当前工作目录新建这一份报告；不能覆盖已有文件，写入前仍需逐次批准。",
          buttonLabel: "设置报告位置",
          showsTagField: false,
          filters: [{ name: "纯文本报告", extensions: ["json", "md", "txt", "csv"] }],
        });
        if (selected.canceled || !selected.filePath) return context.host.getState();
        const current = await context.host.getState();
        if (
          current.activeSessionId !== sessionId ||
          current.workspaceRoot !== state.workspaceRoot ||
          current.run ||
          current.status !== "ready" ||
          current.historyOnly ||
          context.quitting
        )
          throw Error("会话已变化，请重新选择报告位置。");
        return context.host.send({
          type: "report.target",
          sessionId,
          path: relative(state.workspaceRoot as string, selected.filePath),
        });
      } finally {
        context.selecting = false;
      }
    },
    async revealArtifact(context, command) {
      await currentSession(context, command.sessionId);
      const state = await context.host.send(command);
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
    },
  },
} satisfies NativeFeature<typeof contract>;
