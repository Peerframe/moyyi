import type { CommandParser, FeatureContract } from "../../native/contract.ts";

function noArguments(value: unknown, _parse: CommandParser) {
  if (value !== undefined) throw Error("维护入口不接受自定义路径或命令。");
}
export const contract = {
  id: "maintenance",
  channels: {
    createBackup: { name: "moyyi:backup", result: "maintenance", validate: noArguments },
    restoreBackup: { name: "moyyi:restore", result: "maintenance", validate: noArguments },
    rollbackApplication: { name: "moyyi:rollback", result: "maintenance", validate: noArguments },
  },
} satisfies FeatureContract;

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
