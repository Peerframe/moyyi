import { boundedMessage } from "../security.ts";
import type { DesktopState } from "../shared.ts";
import type { FeatureContract, StateInitialization } from "./contract.ts";
import { featureContracts } from "./contracts.ts";
import { choice, nullableString, object } from "./state-validation.ts";

/** Only explicitly owned fields are admitted; modules retain their exact slice validators. */
export function createStateSchema(features: readonly FeatureContract[]) {
  const keys = new Set<string>(["status", "error"]);
  for (const feature of features) {
    for (const key of feature.state.keys) {
      if (keys.has(key)) throw Error(`Duplicate desktop state owner: ${key}`);
      keys.add(key);
    }
  }
  const allowed = [...keys];
  return {
    keys: allowed,
    validate(value: unknown): value is DesktopState {
      if (
        !boundedMessage(value) ||
        !object(value, allowed) ||
        !choice(value.status, ["ready", "closing", "closed"]) ||
        !nullableString(value.error, 4096)
      )
        return false;
      for (const feature of features) {
        const slice = Object.fromEntries(
          feature.state.keys
            .filter((key) => Object.hasOwn(value, key))
            .map((key) => [key, value[key]]),
        );
        if (!feature.state.validate(slice)) return false;
      }
      return true;
    },
    initialize(context: StateInitialization): DesktopState {
      const state: Partial<DesktopState> = { status: "ready", error: null };
      for (const feature of features) {
        const slice = feature.state.initialize(context);
        for (const key of Object.keys(slice)) {
          if (!(feature.state.keys as readonly string[]).includes(key))
            throw Error(`${feature.id} initialized unowned state: ${key}`);
        }
        Object.assign(state, slice);
      }
      return state as DesktopState;
    },
  };
}
export const desktopStateSchema = createStateSchema(featureContracts);
