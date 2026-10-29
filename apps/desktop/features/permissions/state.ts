import type { StateInitialization } from "../../native/contract.ts";
import { object } from "../../native/state-validation.ts";
import type { FeatureState } from "./contract.ts";
export function validateState(s: Record<string, unknown>): boolean {
  if (
    !object(s.permissions, ["writes", "checks"]) ||
    typeof s.permissions.writes !== "boolean" ||
    typeof s.permissions.checks !== "boolean" ||
    typeof s.askEachRead !== "boolean"
  )
    return false;
  return true;
}
export function initialState(_context: StateInitialization): FeatureState {
  return { permissions: { writes: false, checks: false }, askEachRead: false };
}
