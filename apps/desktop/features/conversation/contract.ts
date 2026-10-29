import type { CommandParser, FeatureContract } from "../../native/contract.ts";
import type { DesktopAction, DesktopState } from "../../shared.ts";
export const contract = {
  id: "conversation",
  channels: {
    act: {
      name: "moyyi:act",
      result: "state",
      validate: (value: unknown, parse: CommandParser) => parse(value),
    },
  },
} satisfies FeatureContract;

export interface DesktopMessage {
  readonly id: string;
  readonly role: "user" | "assistant" | "tool" | "notice";
  readonly text: string;
  readonly tool?: string;
  readonly state?: string;
}
export type FeatureCommand =
  | { readonly type: "start"; readonly sessionId: string; readonly text: string }
  | { readonly type: "cancel"; readonly runId: string }
  | { readonly type: "close" };
export const commandTypes = [
  "start",
  "cancel",
  "close",
] as const satisfies readonly FeatureCommand["type"][];
export interface FeatureState {
  readonly messages: readonly DesktopMessage[];
  readonly historyTruncated: boolean;
  readonly streamText: string;
  readonly run: { readonly id: string; readonly state: "running" | "cancelling" } | null;
  readonly outcome: {
    readonly kind: "completed" | "cancelled" | "budget_exhausted" | "failed";
    readonly detail?: string;
  } | null;
}
export const stateKeys = [
  "messages",
  "historyTruncated",
  "streamText",
  "run",
  "outcome",
] as const satisfies readonly (keyof FeatureState)[];
export interface FeatureBridge {
  act(command: DesktopAction): Promise<DesktopState>;
}
