import type { CommandParser, FeatureContract } from "../../native/contract.ts";
import { sessionIdentity } from "../../native/contract.ts";
import type { DesktopState } from "../../shared.ts";
export const contract = {
  id: "artifacts",
  channels: {
    saveArtifact: {
      name: "moyyi:save-artifact",
      result: "state",
      validate: (value: unknown, parse: CommandParser) => {
        if (
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          Object.keys(value).sort().join() !== "effectId,sessionId"
        )
          throw Error("Invalid result selection");
        const command = parse({ ...value, type: "artifact.open" });
        if (command.type !== "artifact.open") throw Error("Invalid result selection");
        return command;
      },
    },
    selectReportTarget: { name: "moyyi:report-target", result: "state", validate: sessionIdentity },
    revealArtifact: {
      name: "moyyi:reveal-artifact",
      result: "state",
      validate: (value: unknown, parse: CommandParser) => {
        if (
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          Object.keys(value).sort().join() !== "effectId,sessionId"
        )
          throw Error("Invalid result selection");
        const command = parse({ ...value, type: "artifact.open" });
        if (command.type !== "artifact.open") throw Error("Invalid result selection");
        return command;
      },
    },
  },
} satisfies FeatureContract;

export interface DesktopArtifact {
  readonly effectId: string;
  readonly path: string;
  readonly afterHash: string;
  readonly state: "unchecked" | "current" | "changed" | "missing" | "unavailable";
}
export interface DesktopArtifactPreview {
  readonly effectId: string;
  readonly path: string;
  readonly sha256: string;
  readonly text: string;
  readonly sourceBytes: number;
  readonly truncated: boolean;
  readonly image?: {
    readonly mime: "image/png" | "image/jpeg";
    readonly width: number;
    readonly height: number;
    readonly dataUrl: string;
  };
}
export type FeatureCommand =
  | { readonly type: "report.target"; readonly sessionId: string; readonly path: string | null }
  | { readonly type: "report.clear"; readonly sessionId: string }
  | { readonly type: "artifacts"; readonly sessionId: string; readonly offset: number }
  | { readonly type: "artifact.open"; readonly sessionId: string; readonly effectId: string }
  | { readonly type: "artifact.close" };
export const commandTypes = [
  "report.target",
  "report.clear",
  "artifacts",
  "artifact.open",
  "artifact.close",
] as const satisfies readonly FeatureCommand["type"][];
export interface FeatureState {
  readonly reportTarget: string | null;
  readonly artifacts: {
    readonly items: readonly DesktopArtifact[];
    readonly offset: number;
    readonly hasMore: boolean;
  };
  readonly artifactPreview: DesktopArtifactPreview | null;
}
export const stateKeys = [
  "reportTarget",
  "artifacts",
  "artifactPreview",
] as const satisfies readonly (keyof FeatureState)[];
export interface FeatureBridge {
  selectReportTarget(options: { readonly sessionId: string }): Promise<DesktopState>;
  saveArtifact(options: {
    readonly sessionId: string;
    readonly effectId: string;
  }): Promise<DesktopState>;
  revealArtifact(options: {
    readonly sessionId: string;
    readonly effectId: string;
  }): Promise<DesktopState>;
}
