import type { CommandParser, FeatureContract } from "../../native/contract.ts";
import type { DesktopState } from "../../shared.ts";
import { initialState, validateState } from "./state.ts";

export interface DesktopSettings {
  readonly preset: "flash" | "kimi-cn" | "kimi-global";
  readonly maxRequests: number;
  readonly timeoutMs: number;
  readonly kimiReasoningEffort?: "low" | "high";
  readonly evidenceAnswer?: boolean;
}
export type FeatureCommand = {
  readonly type: "configure";
  readonly settings: DesktopSettings;
  readonly apiKey?: string;
};
export const commandTypes = ["configure"] as const satisfies readonly FeatureCommand["type"][];
export interface FeatureState {
  readonly connection: { readonly ready: boolean; readonly message?: string };
  readonly settings: DesktopSettings;
  readonly model: { readonly provider: string; readonly model: string } | null;
  readonly budgets: {
    readonly maxRequests: number | null;
    readonly timeoutMs: number | null;
    readonly maxOutputTokens: number | null;
  };
}
export const stateKeys = [
  "connection",
  "settings",
  "model",
  "budgets",
] as const satisfies readonly (keyof FeatureState)[];
export interface FeatureBridge {
  configure(options: {
    readonly settings: DesktopSettings;
    readonly apiKey?: string;
  }): Promise<DesktopState>;
}
export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  preset: "flash",
  maxRequests: 3,
  timeoutMs: 120_000,
};

export const actionTypes = [] as const satisfies readonly FeatureCommand["type"][];
export type FeatureAction = Extract<
  FeatureCommand,
  { readonly type: (typeof actionTypes)[number] }
>;
export const contract = {
  id: "settings",
  commands: commandTypes,
  actions: actionTypes,
  state: { keys: stateKeys, validate: validateState, initialize: initialState },
  channels: {
    configure: {
      name: "moyyi:configure",
      result: "state",
      validate: (value: unknown, _parse: CommandParser) => {
        if (
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          Object.keys(value).some((k) => !["settings", "apiKey"].includes(k))
        )
          throw Error("Invalid model settings");
        return value;
      },
    },
  },
} satisfies FeatureContract;
