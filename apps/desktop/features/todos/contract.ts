import type { FeatureContract } from "../../native/contract.ts";
export type FeatureCommand = never;
export type FeatureAction = never;
export type FeatureState = Record<never, never>;
export type FeatureBridge = Record<never, never>;
export const commandTypes = [] as const;
export const actionTypes = [] as const;
export const stateKeys = [] as const;
export const contract = {
  id: "todos",
  commands: commandTypes,
  actions: actionTypes,
  channels: {},
  state: {
    keys: stateKeys,
    initialize: () => ({}),
    validate: (s: Record<string, unknown>) => Object.keys(s).length === 0,
  },
} satisfies FeatureContract;
