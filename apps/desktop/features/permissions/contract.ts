import type { CommandParser, FeatureContract } from "../../native/contract.ts";
import type { DesktopState } from "../../shared.ts";
export const contract = {
  id: "permissions",
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
