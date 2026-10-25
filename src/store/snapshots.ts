import { isAbsolute, normalize } from "node:path";
import type { WorkspaceSnapshot } from "../contracts/files.ts";
import { canonicalizeJson } from "../contracts/replay.ts";

const fields = [
  "version",
  "id",
  "effectId",
  "runId",
  "workspaceRoot",
  "path",
  "beforeBlob",
  "beforeHash",
  "afterHash",
  "beforeMode",
  "afterMode",
];
const hash = /^[0-9a-f]{64}$/;

/** Snapshot v1 is separately versioned; never relax the frozen transcript/effect contract. */
export function encodeSnapshot(snapshot: WorkspaceSnapshot): string {
  // Canonicalization rejects getters and lossy values before property access.
  const encoded = canonicalizeJson(snapshot);
  if (new TextEncoder().encode(encoded).byteLength > 64 * 1024)
    throw new Error("Snapshot exceeds its byte limit");
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
    throw new Error("Invalid snapshot record");
  const keys = Object.keys(snapshot);
  if (
    fields.some((field) => !keys.includes(field)) ||
    keys.some((field) => !fields.includes(field) && field !== "restoreOf")
  )
    throw new Error("Invalid snapshot fields");
  if (snapshot.version !== 1) throw new Error("Unsupported snapshot version");
  for (const value of [snapshot.id, snapshot.effectId, snapshot.runId]) {
    if (typeof value !== "string" || !value.length || value.length > 512)
      throw new Error("Invalid snapshot identity");
  }
  if (snapshot.id !== snapshot.effectId) throw new Error("Snapshot ID must equal its effect ID");
  if (
    typeof snapshot.workspaceRoot !== "string" ||
    !isAbsolute(snapshot.workspaceRoot) ||
    normalize(snapshot.workspaceRoot) !== snapshot.workspaceRoot ||
    snapshot.workspaceRoot.includes("\0")
  )
    throw new Error("Invalid snapshot workspace");
  if (
    typeof snapshot.path !== "string" ||
    snapshot.path.length === 0 ||
    snapshot.path.length > 4096 ||
    snapshot.path.includes("\\") ||
    snapshot.path.includes("\0") ||
    snapshot.path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error("Invalid snapshot relative path");
  for (const value of [snapshot.beforeHash, snapshot.afterHash]) {
    if (value !== null && (typeof value !== "string" || !hash.test(value)))
      throw new Error("Invalid snapshot hash");
  }
  for (const value of [snapshot.beforeMode, snapshot.afterMode]) {
    if (value !== null && (!Number.isSafeInteger(value) || value < 0 || value > 0o777))
      throw new Error("Invalid snapshot mode");
  }
  if (
    (snapshot.beforeHash === null) !== (snapshot.beforeMode === null) ||
    (snapshot.afterHash === null) !== (snapshot.afterMode === null) ||
    (snapshot.beforeHash === null
      ? snapshot.beforeBlob !== null
      : snapshot.beforeBlob !== `sha256:${snapshot.beforeHash}`)
  )
    throw new Error("Snapshot content, blob and mode disagree");
  if (snapshot.beforeHash === null && snapshot.afterHash === null)
    throw new Error("Snapshot must describe an existing before or after file");
  if (
    "restoreOf" in snapshot &&
    (typeof snapshot.restoreOf !== "string" ||
      !snapshot.restoreOf.length ||
      snapshot.restoreOf.length > 512 ||
      snapshot.restoreOf === snapshot.id)
  )
    throw new Error("Invalid snapshot restore source");
  if (snapshot.afterHash === null && snapshot.restoreOf === undefined)
    throw new Error("Only a restore snapshot may remove a file");
  return encoded;
}
