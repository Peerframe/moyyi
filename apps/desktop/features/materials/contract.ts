import type { CommandParser, FeatureContract } from "../../native/contract.ts";
import { sessionIdentity } from "../../native/contract.ts";
import type { DesktopArtifactPreview, DesktopState } from "../../shared.ts";
import { initialState, validateState } from "./state.ts";

export interface DesktopMaterial {
  readonly path: string;
  readonly format: string;
  readonly sourceBytes: number;
  readonly sha256: string;
}
export interface DesktopManagedMaterial extends DesktopMaterial {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly state: "pending" | "active" | "recycled" | "purged";
  readonly revision: number;
  readonly recycledAt: string | null;
  readonly referenceCount: number;
}
export type FeatureCommand =
  | { readonly type: "material.cancel"; readonly sessionId: string }
  | {
      readonly type: "materials.import";
      readonly sessionId: string;
      readonly paths: readonly string[];
    }
  | { readonly type: "library"; readonly sessionId: string; readonly offset: number }
  | {
      readonly type: "material.select";
      readonly sessionId: string;
      readonly ids: readonly string[];
    }
  | {
      readonly type:
        | "material.recycle"
        | "material.restore"
        | "material.purge"
        | "material.preview";
      readonly sessionId: string;
      readonly id: string;
      readonly revision: number;
    }
  | {
      readonly type: "material.housekeeping";
      readonly sessionId: string;
      readonly enabled: boolean;
    }
  | { readonly type: "materials"; readonly sessionId: string; readonly paths: readonly string[] }
  | { readonly type: "material.remove"; readonly sessionId: string; readonly path: string };
export const commandTypes = [
  "material.cancel",
  "materials.import",
  "library",
  "material.select",
  "material.recycle",
  "material.restore",
  "material.purge",
  "material.preview",
  "material.housekeeping",
  "materials",
  "material.remove",
] as const satisfies readonly FeatureCommand["type"][];
export interface FeatureState {
  readonly importing?: boolean;
  readonly library?: {
    readonly items: readonly DesktopManagedMaterial[];
    readonly offset: number;
    readonly hasMore: boolean;
    readonly housekeeping: boolean;
  };
  readonly materialPreview?: DesktopArtifactPreview | null;
  readonly materials: readonly DesktopMaterial[];
}
export const stateKeys = [
  "importing",
  "library",
  "materialPreview",
  "materials",
] as const satisfies readonly (keyof FeatureState)[];
export interface FeatureBridge {
  selectDocuments(options: { readonly sessionId: string }): Promise<DesktopState>;
  importFiles(options: {
    readonly sessionId: string;
    readonly files: readonly File[];
  }): Promise<DesktopState>;
  pasteImage(options: { readonly sessionId: string }): Promise<DesktopState>;
}

export const actionTypes = [
  "material.cancel",
  "library",
  "material.select",
  "material.recycle",
  "material.restore",
  "material.purge",
  "material.preview",
  "material.housekeeping",
  "material.remove",
] as const satisfies readonly FeatureCommand["type"][];
export type FeatureAction = Extract<
  FeatureCommand,
  { readonly type: (typeof actionTypes)[number] }
>;
export const contract = {
  id: "materials",
  commands: commandTypes,
  actions: actionTypes,
  state: { keys: stateKeys, validate: validateState, initialize: initialState },
  channels: {
    selectDocuments: { name: "moyyi:documents", result: "state", validate: sessionIdentity },
    importFiles: {
      name: "moyyi:import-files",
      result: "state",
      input: "files",
      validate: (value: unknown, parse: CommandParser) => {
        if (
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          Object.keys(value).sort().join() !== "paths,sessionId"
        )
          throw Error("Invalid dropped files");
        const command = parse({ ...value, type: "materials.import" });
        if (command.type !== "materials.import") throw Error("Invalid dropped files");
        return command;
      },
    },
    pasteImage: { name: "moyyi:paste-image", result: "state", validate: sessionIdentity },
  },
} satisfies FeatureContract;
