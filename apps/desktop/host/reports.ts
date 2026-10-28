import { extname } from "node:path";
import type { DesktopArtifact, DesktopArtifactPreview } from "../shared.ts";
import { imagePreview } from "./image-preview.ts";
import { FileBoundaryError, locateWorkspaceFile, readWorkspaceFile } from "./materials.ts";

const formats = new Set([".json", ".md", ".txt", ".csv"]);
export function reportTarget(
  workspace: string,
  input: string,
  excluded: readonly string[],
): string {
  if (!formats.has(extname(input).toLowerCase()))
    throw new FileBoundaryError("Choose a JSON, Markdown, text or CSV report");
  const target = locateWorkspaceFile(workspace, input, excluded, true);
  if (target.stat !== null)
    throw new FileBoundaryError("Reports may only create a new file; choose a different name");
  return target.path;
}

export function inspectReport(
  workspace: string,
  artifact: DesktopArtifact,
  excluded: readonly string[],
): { state: DesktopArtifact["state"]; preview?: DesktopArtifactPreview } {
  try {
    const extension = extname(artifact.path).toLowerCase();
    const image = [".png", ".jpg", ".jpeg"].includes(extension);
    if (!formats.has(extension) && !image) return { state: "unavailable" };
    const file = readWorkspaceFile(workspace, artifact.path, excluded, 1024 * 1024, true);
    if (file.sha256 !== artifact.afterHash) return { state: "changed" };
    if (image)
      return {
        state: "current",
        preview: {
          effectId: artifact.effectId,
          path: file.path,
          sha256: file.sha256,
          sourceBytes: file.sourceBytes,
          text: "",
          truncated: false,
          image: imagePreview(file.bytes ?? new Uint8Array(), extension.slice(1)),
        },
      };
    const full = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
    let text = full.slice(0, 65_536);
    if (/[\uD800-\uDBFF]$/u.test(text)) text = text.slice(0, -1);
    return {
      state: "current",
      preview: {
        effectId: artifact.effectId,
        path: file.path,
        sha256: file.sha256,
        sourceBytes: file.sourceBytes,
        text,
        truncated: text.length !== full.length,
      },
    };
  } catch (error) {
    return {
      state:
        error instanceof FileBoundaryError && error.kind === "missing" ? "missing" : "unavailable",
    };
  }
}
