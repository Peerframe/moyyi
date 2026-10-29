import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { app, clipboard, dialog } from "electron";
import { imagePreview } from "../../host/image-preview.ts";
import { parseDesktopCommand } from "../../host/validation.ts";
import { claimSelection, currentSession, type NativeFeature } from "../../native/context.ts";
import { contract } from "./contract.ts";
export const nativeFeature = {
  contract,
  handlers: {
    async selectDocuments(context, value) {
      const sessionId = contract.channels.selectDocuments.validate(value, parseDesktopCommand);
      const state = await currentSession(context, sessionId);
      claimSelection(context);
      try {
        const selected = await dialog.showOpenDialog(context.window, {
          title: "导入文档或图片",
          defaultPath: state.workspaceRoot as string,
          message:
            "可选择工作目录外的材料；每份最多10MiB、最多8份。原件保留，工作目录创建副本；不自动上传或调用模型。",
          properties: ["openFile", "multiSelections", "noResolveAliases"],
          // Electron 45 maps extension filters to macOS type registration. A valid DOCX may
          // otherwise be unselectable without an associated app. The context.host validates formats,
          // bounded bytes and authority after selection; the picker is never that boundary.
          buttonLabel: "选择文档",
        });
        if (selected.canceled) return context.host.getState();
        const current = await context.host.getState();
        if (
          current.activeSessionId !== sessionId ||
          current.workspaceRoot !== state.workspaceRoot ||
          current.run ||
          current.status !== "ready" ||
          current.historyOnly ||
          context.quitting
        )
          throw Error("会话已变化，请重新选择文档。");
        return context.host.send({
          type: "materials.import",
          sessionId,
          paths: selected.filePaths,
        });
      } finally {
        context.selecting = false;
      }
    },
    async importFiles(context, value) {
      const command = contract.channels.importFiles.validate(value, parseDesktopCommand);
      const state = await currentSession(context, command.sessionId);
      claimSelection(context);
      try {
        const consent = await dialog.showMessageBox(context.window, {
          type: "question",
          title: "导入外部材料",
          message: "将这些文件复制到当前工作目录？",
          detail: `${state.workspaceRoot}\n\n${command.paths.join("\n")}\n\n保留原件并保存哈希；不会上传或调用模型，也不开放模型写入权限。`,
          buttons: ["取消", "导入副本"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        if (consent.response !== 1) return context.host.getState();
        const current = await context.host.getState();
        if (
          current.activeSessionId !== command.sessionId ||
          current.workspaceRoot !== state.workspaceRoot ||
          current.run ||
          current.status !== "ready" ||
          current.historyOnly ||
          context.quitting
        )
          throw Error("会话已变化，请重新导入。");
        return context.host.send(command);
      } finally {
        context.selecting = false;
      }
    },
    async pasteImage(context, value) {
      const sessionId = contract.channels.pasteImage.validate(value, parseDesktopCommand);
      const state = await currentSession(context, sessionId);
      claimSelection(context);
      let temporary: string | undefined;
      try {
        const items = await clipboard.read();
        const item = items.find((item) => item.types.includes("image/png"));
        if (!item) throw Error("剪贴板没有 PNG 图片。");
        const blob = await item.getType("image/png");
        if (blob.size > 524288) throw Error("粘贴图片最多512KiB；大图片请通过文件选择导入原件。");
        const bytes = Buffer.from(await blob.arrayBuffer());
        const size = imagePreview(bytes, "png");
        const consent = await dialog.showMessageBox(context.window, {
          type: "question",
          title: "粘贴图片",
          message: "保存剪贴板图片到当前工作目录？",
          detail: `${size.width} × ${size.height} · ${bytes.length} 字节\n\n${state.workspaceRoot}\n只保存和预览，不上传、OCR或调用模型。`,
          buttons: ["取消", "保存图片"],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        if (consent.response !== 1) return context.host.getState();
        temporary = realpathSync(mkdtempSync(join(app.getPath("temp"), "moyyi-paste-")));
        const path = join(temporary, "clipboard.png");
        writeFileSync(path, bytes, { mode: 0o600, flag: "wx" });
        const current = await context.host.getState();
        if (
          current.activeSessionId !== sessionId ||
          current.workspaceRoot !== state.workspaceRoot ||
          current.run ||
          current.status !== "ready" ||
          current.historyOnly ||
          context.quitting
        )
          throw Error("会话已变化，请重新粘贴。");
        return await context.host.send({ type: "materials.import", sessionId, paths: [path] });
      } finally {
        if (temporary) rmSync(temporary, { recursive: true, force: true });
        context.selecting = false;
      }
    },
  },
} satisfies NativeFeature;
