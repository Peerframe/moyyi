/** Renderer DTO composition; module contracts own their slices and never expose runtime payloads. */
import type {
  FeatureActions,
  FeatureBridges,
  FeatureCommands,
  FeatureStates,
} from "./shared-feature-types.ts";

export type { DesktopArtifact, DesktopArtifactPreview } from "./features/artifacts/contract.ts";
export type { DesktopMessage } from "./features/conversation/contract.ts";
export type {
  DesktopApproval,
  DesktopEffect,
  DesktopEffectInspection,
} from "./features/effects/contract.ts";
export type { DesktopMaintenanceResult } from "./features/maintenance/contract.ts";
export type { DesktopManagedMaterial, DesktopMaterial } from "./features/materials/contract.ts";
export type { DesktopPermissions } from "./features/permissions/contract.ts";
export type {
  DesktopHistoryPage,
  DesktopMessageChunk,
  DesktopSessionMetadata,
  DesktopSessionQuery,
  DesktopSessionSummary,
  DesktopSessionUpdate,
} from "./features/sessions/contract.ts";
export type { DesktopSettings } from "./features/settings/contract.ts";
export { DEFAULT_DESKTOP_SETTINGS } from "./features/settings/contract.ts";
export type { DesktopWebAccess, DesktopWebSource } from "./features/web/contract.ts";
export interface DesktopState extends FeatureStates {
  readonly status: "ready" | "closing" | "closed";
  readonly error: string | null;
}
export type DesktopCommand = FeatureCommands;
export type DesktopAction = FeatureActions;
export interface DesktopBridge extends FeatureBridges {
  subscribe(listener: (state: DesktopState) => void): () => void;
}
declare global {
  interface Window {
    readonly moyyi: DesktopBridge;
  }
}
