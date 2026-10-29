import { createContext, type Dispatch, type SetStateAction, useContext } from "react";
import type { DesktopAction, DesktopBridge, DesktopState } from "../shared.ts";

/** Shared client coordination only. Feature controllers own every field below. */
// Feature-owned declarations merge into this client coordination contract at build time.
// biome-ignore lint/suspicious/noEmptyInterface: The interface is deliberately open for feature augmentation.
export interface FeatureUI {}

export interface RendererBase {
  bridge: DesktopBridge;
  state: DesktopState | null;
  pending: boolean;
  viewError: string | null;
  setViewError: Dispatch<SetStateAction<string | null>>;
  perform(
    operation: () => Promise<DesktopState>,
    failureMessage?: string,
  ): Promise<DesktopState | null>;
  act(command: DesktopAction): void;
}
export interface RendererUI extends RendererBase, FeatureUI {
  busy: boolean;
  configuring: boolean;
  canSend: boolean;
  composerBlocked: boolean;
}
export type ReadyRendererUI = RendererUI & { state: DesktopState };
export const RendererContext = createContext<ReadyRendererUI | null>(null);
export function useDesktopUI(): ReadyRendererUI {
  const value = useContext(RendererContext);
  if (!value) throw Error("Desktop features require a ready renderer context");
  return value;
}
export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "操作未能完成，请稍后重试。";
}
