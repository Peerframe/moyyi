import type { StateInitialization } from "../../native/contract.ts";
import { choice, object, string } from "../../native/state-validation.ts";
import type { FeatureState } from "./contract.ts";
export function validateState(s: Record<string, unknown>): boolean {
  if (typeof s.historyTruncated !== "boolean" || !string(s.streamText)) return false;
  if (
    !Array.isArray(s.messages) ||
    s.messages.length > 400 ||
    !s.messages.every(
      (v: unknown) =>
        object(v, ["id", "role", "text", "tool", "state"]) &&
        string(v.id, 256) &&
        choice(v.role, ["user", "assistant", "tool", "notice"]) &&
        string(v.text) &&
        (v.tool === undefined || string(v.tool, 256)) &&
        (v.state === undefined || string(v.state, 256)),
    )
  )
    return false;
  if (
    s.run !== null &&
    !(
      object(s.run, ["id", "state"]) &&
      string(s.run.id, 128) &&
      choice(s.run.state, ["running", "cancelling"])
    )
  )
    return false;
  if (
    s.outcome !== null &&
    !(
      object(s.outcome, ["kind", "detail"]) &&
      choice(s.outcome.kind, ["completed", "cancelled", "budget_exhausted", "failed"]) &&
      (s.outcome.detail === undefined || string(s.outcome.detail, 4096))
    )
  )
    return false;
  return true;
}
export function initialState(_context: StateInitialization): FeatureState {
  return { messages: [], historyTruncated: false, streamText: "", run: null, outcome: null };
}
