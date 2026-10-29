import type { StateInitialization } from "../../native/contract.ts";
import { choice, integer, nullableHash, object, string } from "../../native/state-validation.ts";
import type { FeatureState } from "./contract.ts";
export function validateState(s: Record<string, unknown>): boolean {
  const receipt = (v: unknown) =>
    v === null ||
    (object(v, ["kind", "path", "snapshotId", "beforeHash", "afterHash"]) &&
      v.kind === "file" &&
      string(v.path, 4096) &&
      string(v.snapshotId, 128) &&
      nullableHash(v.beforeHash) &&
      nullableHash(v.afterHash)) ||
    (object(v, ["kind", "exitCode", "termination", "outputTruncated"]) &&
      v.kind === "process" &&
      (v.exitCode === null || Number.isSafeInteger(v.exitCode)) &&
      choice(v.termination, [
        "exited",
        "cancelled",
        "timeout",
        "output_limit",
        "revoked",
        "unknown",
      ]) &&
      typeof v.outputTruncated === "boolean");
  if (
    !object(s.effects, ["items", "offset", "hasMore"]) ||
    !integer(s.effects.offset) ||
    typeof s.effects.hasMore !== "boolean" ||
    !Array.isArray(s.effects.items) ||
    s.effects.items.length > 20 ||
    !s.effects.items.every(
      (v) =>
        object(v, ["effectId", "runId", "tool", "state", "updatedAt", "receipt"]) &&
        string(v.effectId, 128) &&
        string(v.runId, 128) &&
        string(v.tool, 256) &&
        string(v.updatedAt, 128) &&
        choice(v.state, [
          "intended",
          "awaiting_approval",
          "approved",
          "denied",
          "started",
          "succeeded",
          "failed",
          "cancelled",
          "unknown",
        ]) &&
        receipt(v.receipt),
    )
  )
    return false;
  if (
    s.effectInspection !== null &&
    !(
      object(s.effectInspection, ["effectId", "path", "state", "expectedHash", "actualHash"]) &&
      string(s.effectInspection.effectId, 128) &&
      string(s.effectInspection.path, 4096) &&
      choice(s.effectInspection.state, [
        "current",
        "changed",
        "missing",
        "absent",
        "unavailable",
      ]) &&
      nullableHash(s.effectInspection.expectedHash) &&
      nullableHash(s.effectInspection.actualHash)
    )
  )
    return false;
  return (
    s.pendingApproval === null ||
    (object(s.pendingApproval, ["effectId", "digest", "summary", "preview"]) &&
      string(s.pendingApproval.effectId, 128) &&
      string(s.pendingApproval.digest, 256) &&
      string(s.pendingApproval.summary, 32768) &&
      (s.pendingApproval.preview === undefined || string(s.pendingApproval.preview)))
  );
}
export function initialState(_context: StateInitialization): FeatureState {
  return {
    effects: { items: [], offset: 0, hasMore: false },
    effectInspection: null,
    pendingApproval: null,
  };
}
