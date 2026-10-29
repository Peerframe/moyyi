import type { StateInitialization } from "../../native/contract.ts";
import type { FeatureState } from "./contract.ts";
export function validateState(_s: Record<string, unknown>): boolean {
  return true;
}
export function initialState(_context: StateInitialization): FeatureState {
  return {};
}
