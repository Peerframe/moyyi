import { BoundaryError, defineHostFeature } from "../../host/feature.ts";
import { imagePreview } from "../../host/image-preview.ts";
import { FileBoundaryError, inspectMaterials } from "../../host/materials.ts";
import { commandTypes, stateKeys } from "./contract.ts";

export const hostFeature = defineHostFeature({
  id: "materials",
  stateKeys,
  commands: commandTypes,
  async refreshMaterials(host, offset = 0): Promise<void> {
    const sessionId = host.state.activeSessionId,
      workspaceRoot = host.state.workspaceRoot;
    if (!sessionId || !workspaceRoot || !host.runtime?.materials) return;
    const manager = host.materialManager();
    await manager.housekeeping({ workspaceRoot });
    const rows = await manager.list(workspaceRoot);
    const project = ({
      workspaceRoot: _workspace,
      ...row
    }: Awaited<ReturnType<typeof manager.list>>[number]) => row;
    const selected = await manager.selected({ sessionId, workspaceRoot });
    host.update({
      library: {
        items: rows.slice(offset, offset + 20).map(project),
        offset,
        hasMore: rows.length > offset + 20,
        housekeeping: await host.runtime.materials.housekeeping(workspaceRoot),
      },
      materials: selected.map(({ path, format, sourceBytes, sha256 }) => ({
        path,
        format,
        sourceBytes,
        sha256,
      })),
    });
  },
  async handle(host, command) {
    if (command.type === "material.cancel") {
      host.selected(command.sessionId);
      host.materialAbort?.abort();
      return;
    }
    if (
      command.type === "materials.import" ||
      command.type === "library" ||
      command.type === "material.select" ||
      command.type === "material.recycle" ||
      command.type === "material.restore" ||
      command.type === "material.purge" ||
      command.type === "material.preview" ||
      command.type === "material.housekeeping"
    ) {
      const workspaceRoot = host.selected(command.sessionId),
        sessionId = command.sessionId;
      if (host.state.historyOnly)
        throw new BoundaryError("Open the available workspace before managing materials");
      const manager = host.materialManager();
      host.update({ materialPreview: null });
      if (command.type === "materials.import") {
        const controller = new AbortController();
        host.materialAbort = controller;
        host.update({ importing: true });
        try {
          await manager.importFiles({
            sessionId,
            workspaceRoot,
            paths: command.paths,
            signal: controller.signal,
          });
        } catch (error) {
          if (controller.signal.aborted)
            throw new FileBoundaryError(
              "Import cancelled; any saved originals remain recoverable in the library",
            );
          throw error;
        } finally {
          host.materialAbort = undefined;
          host.update({ importing: false });
        }
      } else if (command.type === "material.select") {
        const selected = await manager.selected({ sessionId, workspaceRoot });
        await manager.attach({
          sessionId,
          workspaceRoot,
          ids: [...new Set([...selected.map((r) => r.id), ...command.ids])],
        });
      } else if (command.type === "material.housekeeping") {
        await manager.setHousekeeping(workspaceRoot, command.enabled);
        await manager.housekeeping({ workspaceRoot });
      } else if (command.type !== "library") {
        const operation = { workspaceRoot, id: command.id, revision: command.revision };
        if (command.type === "material.preview") {
          const record = (await manager.list(workspaceRoot)).find(
            (r) => r.id === command.id && r.revision === command.revision && r.state === "active",
          );
          if (!record) throw new FileBoundaryError("Select a current material first");
          const bytes = await manager.read(operation);
          const image = ["png", "jpg", "jpeg"].includes(record.format)
            ? imagePreview(bytes, record.format)
            : undefined;
          const isText = ["txt", "text", "md", "json", "csv"].includes(record.format);
          const text = isText
            ? new TextDecoder("utf-8", { fatal: true }).decode(bytes)
            : image
              ? ""
              : "原件已保留。此处显示文件身份；正文需在发送任务后通过受控文档工具读取，不是版式预览。";
          host.update({
            materialPreview: {
              effectId: record.id,
              path: record.path,
              sha256: record.sha256,
              sourceBytes: record.sourceBytes,
              text: text.slice(0, 65536),
              truncated: text.length > 65536,
              ...(image ? { image } : {}),
            },
          });
        } else if (command.type === "material.recycle") await manager.recycle(operation);
        else if (command.type === "material.restore") await manager.restore(operation);
        else await manager.purge(operation);
      }
      await host.refreshMaterials(command.type === "library" ? command.offset : 0);
      return;
    }
    if (command.type === "materials") {
      const workspace = host.selected(command.sessionId);
      if (command.paths.length)
        host.update({ materials: inspectMaterials(workspace, command.paths, host.excluded()) });
      return;
    }
    if (command.type === "material.remove") {
      host.selected(command.sessionId);
      if (host.runtime?.materials) {
        const workspaceRoot = host.selected(command.sessionId),
          manager = host.materialManager();
        const selected = await manager.selected({ sessionId: command.sessionId, workspaceRoot });
        await manager.attach({
          sessionId: command.sessionId,
          workspaceRoot,
          ids: selected.filter((r) => r.path !== command.path).map((r) => r.id),
        });
      }
      host.update({
        materials: host.state.materials.filter((item) => item.path !== command.path),
        materialPreview: null,
      });
      await host.refreshMaterials();
      return;
    }
  },
});
