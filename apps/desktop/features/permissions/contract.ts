import type { CommandParser, FeatureContract } from "../../native/contract.ts";
import type { DesktopState } from "../../shared.ts";
import { initialState, validateState } from "./state.ts";

export interface DesktopPermissions {
  readonly writes: boolean;
  readonly checks: boolean;
}
export type FeatureCommand = {
  readonly type: "permissions";
  readonly sessionId: string;
  readonly writes: boolean;
  readonly checks: boolean;
};
export const commandTypes = ["permissions"] as const satisfies readonly FeatureCommand["type"][];
export interface FeatureState {
  readonly permissions: DesktopPermissions;
  readonly askEachRead: boolean;
}
export const stateKeys = [
  "permissions",
  "askEachRead",
] as const satisfies readonly (keyof FeatureState)[];
export interface FeatureBridge {
  configurePermissions(
    options: DesktopPermissions & { readonly sessionId: string },
  ): Promise<DesktopState>;
}

export const actionTypes = [] as const satisfies readonly FeatureCommand["type"][];
export type FeatureAction = Extract<
  FeatureCommand,
  { readonly type: (typeof actionTypes)[number] }
>;
export const contract = {
  id: "permissions",
  commands: commandTypes,
  actions: actionTypes,
  state: { keys: stateKeys, validate: validateState, initialize: initialState },
  channels: {
    configurePermissions: {
      name: "moyyi:permissions",
      result: "state",
      validate: (value: unknown, parse: CommandParser) => {
        if (
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          Object.keys(value).some((key) => !["sessionId", "writes", "checks"].includes(key))
        )
          throw Error("Invalid workspace permissions");
        const command = parse({ ...value, type: "permissions" });
        if (command.type !== "permissions") throw Error("Invalid workspace permissions");
        return command;
      },
    },
  },
} satisfies FeatureContract;
