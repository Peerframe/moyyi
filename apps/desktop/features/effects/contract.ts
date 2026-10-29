import type { FeatureContract } from "../../native/contract.ts";
import { initialState, validateState } from "./state.ts";

export interface DesktopEffect {
  readonly effectId: string;
  readonly runId: string;
  readonly tool: string;
  readonly state: string;
  readonly updatedAt: string;
  readonly receipt:
    | {
        readonly kind: "file";
        readonly path: string;
        readonly snapshotId: string;
        readonly beforeHash: string | null;
        readonly afterHash: string | null;
      }
    | {
        readonly kind: "process";
        readonly exitCode: number | null;
        readonly termination: string;
        readonly outputTruncated: boolean;
      }
    | null;
}
export interface DesktopEffectInspection {
  readonly effectId: string;
  readonly path: string;
  readonly state: "current" | "changed" | "missing" | "absent" | "unavailable";
  readonly expectedHash: string | null;
  readonly actualHash: string | null;
}
export interface DesktopApproval {
  readonly effectId: string;
  readonly digest: string;
  readonly summary: string;
  readonly preview?: string;
}
export type FeatureCommand =
  | {
      readonly type: "approve";
      readonly effectId: string;
      readonly digest: string;
      readonly decision: "approve" | "deny";
    }
  | { readonly type: "effects"; readonly sessionId: string; readonly offset: number }
  | { readonly type: "effect.inspect"; readonly sessionId: string; readonly effectId: string };
export const commandTypes = [
  "approve",
  "effects",
  "effect.inspect",
] as const satisfies readonly FeatureCommand["type"][];
export interface FeatureState {
  readonly effects: {
    readonly items: readonly DesktopEffect[];
    readonly offset: number;
    readonly hasMore: boolean;
  };
  readonly effectInspection: DesktopEffectInspection | null;
  /** Only the first pending approval is displayed; later requests remain queued in the host. */
  readonly pendingApproval: DesktopApproval | null;
}
export const stateKeys = [
  "effects",
  "effectInspection",
  "pendingApproval",
] as const satisfies readonly (keyof FeatureState)[];
export type FeatureBridge = Record<never, never>;

export const actionTypes = [
  "approve",
  "effects",
  "effect.inspect",
] as const satisfies readonly FeatureCommand["type"][];
export type FeatureAction = Extract<
  FeatureCommand,
  { readonly type: (typeof actionTypes)[number] }
>;
export const contract = {
  id: "effects",
  commands: commandTypes,
  actions: actionTypes,
  state: { keys: stateKeys, validate: validateState, initialize: initialState },
  channels: {},
} satisfies FeatureContract;
