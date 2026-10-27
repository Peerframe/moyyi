import type { DesktopEffect, DesktopEffectInspection } from "../shared.ts";
import { FileBoundaryError, locateWorkspaceFile, readWorkspaceFile } from "./materials.ts";

/** Inspect current bytes only; runtime remains responsible for mode-aware undo preconditions. */
export function inspectEffectFile(
  workspace: string,
  effect: DesktopEffect,
  excluded: readonly string[],
): DesktopEffectInspection {
  const receipt = effect.receipt;
  if (
    effect.state !== "succeeded" ||
    receipt?.kind !== "file" ||
    receipt.snapshotId !== effect.effectId
  )
    throw new FileBoundaryError("Select a successful recorded file operation first");
  const result = {
    effectId: effect.effectId,
    path: receipt.path,
    expectedHash: receipt.afterHash,
    actualHash: null,
  };
  try {
    const target = locateWorkspaceFile(workspace, receipt.path, excluded, true);
    if (target.stat === null) {
      const current = locateWorkspaceFile(workspace, receipt.path, excluded, true);
      if (
        current.stat !== null ||
        current.parents.length !== target.parents.length ||
        current.parents.some(
          (p, i) =>
            p.stat.dev !== target.parents[i]?.stat.dev ||
            p.stat.ino !== target.parents[i]?.stat.ino,
        )
      )
        return { ...result, state: "unavailable" };
      return { ...result, state: receipt.afterHash === null ? "absent" : "missing" };
    }
    const file = readWorkspaceFile(workspace, receipt.path, excluded, 1024 * 1024);
    return {
      ...result,
      actualHash: file.sha256,
      state: file.sha256 === receipt.afterHash ? "current" : "changed",
    };
  } catch (error) {
    return {
      ...result,
      state:
        error instanceof FileBoundaryError && error.kind === "missing" && receipt.afterHash !== null
          ? "missing"
          : "unavailable",
    };
  }
}
