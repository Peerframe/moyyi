import type { StateInitialization } from "../../native/contract.ts";
import {
  choice,
  hash,
  integer,
  nullableString,
  object,
  previewView,
  string,
} from "../../native/state-validation.ts";
import type { FeatureState } from "./contract.ts";
export function validateState(s: Record<string, unknown>): boolean {
  if (
    s.library !== undefined &&
    !(
      object(s.library, ["items", "offset", "hasMore", "housekeeping"]) &&
      integer(s.library.offset) &&
      typeof s.library.hasMore === "boolean" &&
      typeof s.library.housekeeping === "boolean" &&
      Array.isArray(s.library.items) &&
      s.library.items.length <= 20 &&
      s.library.items.every(
        (v) =>
          object(v, [
            "id",
            "path",
            "name",
            "format",
            "sourceBytes",
            "sha256",
            "createdAt",
            "state",
            "revision",
            "recycledAt",
            "referenceCount",
          ]) &&
          string(v.id, 128) &&
          string(v.path, 4096) &&
          string(v.name, 160) &&
          string(v.format, 16) &&
          integer(v.sourceBytes) &&
          Number(v.sourceBytes) <= 10485760 &&
          string(v.sha256, 64) &&
          /^[a-f0-9]{64}$/.test(v.sha256) &&
          string(v.createdAt, 128) &&
          choice(v.state, ["pending", "active", "recycled", "purged"]) &&
          integer(v.revision) &&
          nullableString(v.recycledAt, 128) &&
          integer(v.referenceCount),
      )
    )
  )
    return false;
  if (s.importing !== undefined && typeof s.importing !== "boolean") return false;
  if (
    !Array.isArray(s.materials) ||
    s.materials.length > 8 ||
    !s.materials.every(
      (v) =>
        object(v, ["path", "format", "sourceBytes", "sha256"]) &&
        string(v.path, 4096) &&
        choice(v.format, [
          "pdf",
          "docx",
          "xlsx",
          "pptx",
          "odt",
          "ods",
          "odp",
          "txt",
          "text",
          "md",
          "csv",
          "json",
          "png",
          "jpg",
          "jpeg",
        ]) &&
        integer(v.sourceBytes) &&
        Number(v.sourceBytes) <= 10 * 1024 * 1024 &&
        hash(v.sha256),
    )
  )
    return false;
  if (!previewView(s.materialPreview ?? null)) return false;
  return true;
}
export function initialState(_context: StateInitialization): FeatureState {
  return { materials: [] };
}
