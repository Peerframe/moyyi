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
  if (!nullableString(s.reportTarget, 4096)) return false;
  if (
    !object(s.artifacts, ["items", "offset", "hasMore"]) ||
    !integer(s.artifacts.offset) ||
    typeof s.artifacts.hasMore !== "boolean" ||
    !Array.isArray(s.artifacts.items) ||
    s.artifacts.items.length > 20 ||
    !s.artifacts.items.every(
      (v) =>
        object(v, ["effectId", "path", "afterHash", "state"]) &&
        string(v.effectId, 128) &&
        string(v.path, 4096) &&
        hash(v.afterHash) &&
        choice(v.state, ["unchecked", "current", "changed", "missing", "unavailable"]),
    )
  )
    return false;
  if (!previewView(s.artifactPreview)) return false;
  return true;
}
export function initialState(_context: StateInitialization): FeatureState {
  return {
    reportTarget: null,
    artifacts: { items: [], offset: 0, hasMore: false },
    artifactPreview: null,
  };
}
