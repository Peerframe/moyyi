import type { ComponentType, Dispatch, SetStateAction } from "react";
import type { DesktopMessage, DesktopSettings } from "../shared.ts";
import type { FeatureUI, RendererBase, RendererUI } from "./ui.ts";

/** Placement belongs to App; the order reproduces the existing desktop layout. */
export const SLOT_NAMES = [
  "sidebar",
  "header-actions",
  "permission-line",
  "connection-notice",
  "setup",
  "before-messages",
  "messages",
  "after-messages",
  "composer",
  "dialogs",
  "right-panel",
] as const;
export type SlotId = (typeof SLOT_NAMES)[number];
export interface SlotContribution {
  readonly id: string;
  readonly slot: SlotId;
  readonly order: number;
  readonly Component: ComponentType;
}
export interface SettingsSectionProps {
  readonly draft: { readonly settings: DesktopSettings; readonly apiKey: string };
  readonly setDraft: Dispatch<SetStateAction<SettingsSectionProps["draft"]>>;
  readonly setNotice: Dispatch<SetStateAction<string | null>>;
  readonly setError: Dispatch<SetStateAction<string | null>>;
}
export interface MessageRenderer {
  readonly id: string;
  readonly role?: DesktopMessage["role"];
  readonly tool?: string;
  readonly Component: ComponentType<{ message: DesktopMessage }>;
}
export interface RendererFeature {
  readonly id: string;
  readonly useController?: (base: RendererBase, getUI: () => RendererUI) => Partial<FeatureUI>;
  readonly slots?: readonly SlotContribution[];
  readonly settingsSections?: readonly {
    readonly id: string;
    readonly order: number;
    readonly Component: ComponentType<SettingsSectionProps>;
  }[];
  readonly messages?: readonly MessageRenderer[];
}
