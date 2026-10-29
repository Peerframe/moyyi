import type { CommandParser, FeatureContract } from "../../native/contract.ts";
import { initialState, validateState } from "./state.ts";

function noArguments(value: unknown, _parse: CommandParser) {
  if (value !== undefined) throw Error("维护入口不接受自定义路径或命令。");
}

export interface DesktopMaintenanceResult {
  readonly kind: "backup" | "restore" | "rollback";
  readonly path: string;
  readonly rescuePath: string | null;
  readonly sessionCount: number | null;
  readonly schemaVersion: number | null;
  readonly persistedFormat: number | null;
  readonly targetRevision: string | null;
  readonly settingsPreserved: true;
  readonly workspacesUntouched: true;
  readonly credentialsExported: false;
}
export type FeatureCommand = never;
export const commandTypes = [] as const satisfies readonly FeatureCommand["type"][];
export type FeatureState = Record<never, never>;
export const stateKeys = [] as const satisfies readonly (keyof FeatureState)[];
export interface FeatureBridge {
  createBackup(): Promise<DesktopMaintenanceResult | null>;
  restoreBackup(): Promise<DesktopMaintenanceResult | null>;
  rollbackApplication(): Promise<DesktopMaintenanceResult | null>;
}

export const actionTypes = [] as const satisfies readonly FeatureCommand["type"][];
export type FeatureAction = Extract<
  FeatureCommand,
  { readonly type: (typeof actionTypes)[number] }
>;
export const contract = {
  id: "maintenance",
  commands: commandTypes,
  actions: actionTypes,
  state: { keys: stateKeys, validate: validateState, initialize: initialState },
  channels: {
    createBackup: { name: "moyyi:backup", result: "maintenance", validate: noArguments },
    restoreBackup: { name: "moyyi:restore", result: "maintenance", validate: noArguments },
    rollbackApplication: { name: "moyyi:rollback", result: "maintenance", validate: noArguments },
  },
} satisfies FeatureContract;
