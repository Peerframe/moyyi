import type { EffectRecord, ToolResultPart } from "./persisted/index.ts";

export type ExecutionReceipt =
  | {
      readonly kind: "file";
      readonly path: string;
      readonly snapshotId: string;
      readonly beforeHash: string | null;
      readonly afterHash: string | null;
    }
  | {
      readonly kind: "process";
      readonly exitCode: number | null;
      readonly termination: string;
      readonly outputTruncated: boolean;
    };

export function isReceiptEffect(effect: EffectRecord): boolean {
  return (
    (["create", "edit", "undo"].includes(effect.tool) &&
      effect.profile.class === "workspace_write" &&
      effect.profile.reversibility === "snapshot") ||
    (effect.tool === "shell" && effect.profile.class === "process")
  );
}

/** Extract only bounded fields from matching execution records, never assistant prose. */
export function executionReceipt(
  effect: EffectRecord,
  result: ToolResultPart,
): ExecutionReceipt | null {
  if (
    !isReceiptEffect(effect) ||
    result.callId !== effect.callId ||
    result.status !== effect.state ||
    !["succeeded", "failed"].includes(effect.state) ||
    result.content.length !== 1
  )
    return null;
  const part = result.content[0];
  if (part?.type !== "text" || part.text.length > 65_536) return null;
  let data: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(part.text);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    data = value as Record<string, unknown>;
  } catch {
    return null;
  }
  if (effect.profile.class === "workspace_write") {
    const hash = (value: unknown): value is string | null =>
      value === null || (typeof value === "string" && /^[a-f0-9]{64}$/.test(value));
    if (
      effect.state !== "succeeded" ||
      effect.profile.verification !== "postcheck" ||
      typeof data.path !== "string" ||
      !data.path ||
      data.path.length > 4_096 ||
      data.snapshotId !== effect.id ||
      effect.id.length > 512 ||
      !hash(data.beforeHash) ||
      !hash(data.afterHash)
    )
      return null;
    return {
      kind: "file",
      path: data.path,
      snapshotId: effect.id,
      beforeHash: data.beforeHash,
      afterHash: data.afterHash,
    };
  }
  if (
    typeof data.termination !== "string" ||
    !["exited", "cancelled", "timeout", "output_limit", "revoked", "unknown"].includes(
      data.termination,
    ) ||
    (data.exitCode !== null && !Number.isSafeInteger(data.exitCode)) ||
    typeof data.truncated !== "boolean"
  )
    return null;
  return {
    kind: "process",
    exitCode: data.exitCode as number | null,
    termination: data.termination,
    outputTruncated: data.truncated,
  };
}
