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
export interface DesktopConnection {
  readonly id: string;
  readonly name: string;
  readonly provider: "deepseek" | "kimi-cn" | "kimi-global";
  readonly reasoningEffort: "low" | "high";
  readonly configured: boolean;
}
export type ConnectionChange =
  | {
      readonly action: "add";
      readonly name: string;
      readonly provider: DesktopConnection["provider"];
      readonly apiKey?: string;
    }
  | { readonly action: "rename"; readonly id: string; readonly name: string }
  | { readonly action: "delete" | "select" | "search"; readonly id: string };
export type FeatureCommand =
  | {
      readonly type: "configure";
      readonly settings: DesktopSettings;
      readonly apiKey?: string;
    }
  | { readonly type: "connection.change"; readonly change: ConnectionChange };
export const commandTypes = [
  "configure",
  "connection.change",
] as const satisfies readonly FeatureCommand["type"][];
export interface FeatureState {
  readonly connections: readonly DesktopConnection[];
  readonly activeConnectionId: string;
  readonly searchConnectionId: string | null;
  readonly connectionFailure: {
    readonly name: string;
    readonly kind: "quota" | "rate_limited" | "auth";
  } | null;
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
  "connections",
  "activeConnectionId",
  "searchConnectionId",
  "connectionFailure",
  "connection",
  "settings",
  "model",
  "budgets",
] as const satisfies readonly (keyof FeatureState)[];
export interface FeatureBridge {
  changeConnection(change: ConnectionChange): Promise<DesktopState>;
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
    changeConnection: {
      name: "moyyi:connection.change",
      result: "state",
      validate: (value: unknown, parse: CommandParser) => {
        const command = parse({ type: "connection.change", change: value });
        if (command.type !== "connection.change") throw Error("Invalid connection change");
        return command.change;
      },
    },
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
