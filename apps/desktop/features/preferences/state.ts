import type { StateInitialization } from "../../native/contract.ts";
import { object, string } from "../../native/state-validation.ts";
import type { FeatureState } from "./contract.ts";

const sha = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export function validateState(state: Record<string, unknown>): boolean {
  const p = state.preferences;
  if (
    !object(p, ["personalInstructions", "personalInstructionsHash", "skills", "review"]) ||
    !string(p.personalInstructions, 8192) ||
    new TextEncoder().encode(p.personalInstructions).length > 8192 ||
    !(p.personalInstructionsHash === null || sha(p.personalInstructionsHash)) ||
    !Array.isArray(p.skills) ||
    p.skills.length > 32 ||
    !p.skills.every(
      (s) =>
        object(s, ["name", "description", "sha256", "importedAt", "enabled"]) &&
        string(s.name, 64) &&
        string(s.description, 1024) &&
        sha(s.sha256) &&
        string(s.importedAt, 32) &&
        typeof s.enabled === "boolean",
    )
  )
    return false;
  const r = p.review;
  return (
    r === null ||
    (object(r, ["id", "name", "description", "sha256", "text", "omitted", "omittedTruncated"]) &&
      string(r.id, 64) &&
      string(r.name, 64) &&
      string(r.description, 1024) &&
      sha(r.sha256) &&
      string(r.text, 12288) &&
      new TextEncoder().encode(r.text).length <= 12288 &&
      Array.isArray(r.omitted) &&
      r.omitted.length <= 64 &&
      r.omitted.every((x) => string(x, 256)) &&
      typeof r.omittedTruncated === "boolean")
  );
}
export function initialState(_context: StateInitialization): FeatureState {
  return {
    preferences: {
      personalInstructions: "",
      personalInstructionsHash: null,
      skills: [],
      review: null,
    },
  };
}
