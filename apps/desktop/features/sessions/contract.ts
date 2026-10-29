import type { CommandParser, FeatureContract } from "../../native/contract.ts";
import { pickerOptions } from "../../security.ts";
import type { DesktopMessage, DesktopState } from "../../shared.ts";
export const contract = {
  id: "sessions",
  channels: {
    getState: {
      name: "moyyi:state",
      result: "state",
      input: "none",
      validate: (_value: unknown, _parse: CommandParser) => undefined,
    },
    selectWorkspace: {
      name: "moyyi:workspace",
      result: "state",
      validate: (value: unknown, _parse: CommandParser) => pickerOptions(value),
    },
  },
} satisfies FeatureContract;

export interface DesktopSessionMetadata {
  readonly title: string | null;
  readonly group: string | null;
  readonly pinned: boolean;
  readonly muted: boolean;
  readonly removedAt: string | null;
  readonly revision: number;
}
export interface DesktopSessionQuery {
  readonly search?: string;
  readonly group?: string | null;
  readonly removed?: "active" | "removed" | "all";
  readonly cursor?: string;
  readonly limit?: number;
}
export interface DesktopSessionUpdate {
  readonly sessionId: string;
  readonly expectedRevision: number;
  readonly patch: {
    readonly title?: string | null;
    readonly group?: string | null;
    readonly pinned?: boolean;
    readonly muted?: boolean;
    readonly removed?: boolean;
  };
}
export interface DesktopHistoryPage {
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly items: readonly (DesktopMessage & {
    readonly entryId: string;
    readonly recordedAt: string;
    readonly textLength: number;
    readonly truncated: boolean;
  })[];
  readonly nextCursor: string | null;
}
export interface DesktopMessageChunk {
  readonly messageId: string;
  readonly offset: number;
  readonly text: string;
  readonly totalLength: number;
  readonly nextOffset: number | null;
}
export interface DesktopSessionSummary {
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly lastActivityAt: string | null;
  readonly promptPreview: string | null;
  readonly metadata?: DesktopSessionMetadata;
}
export type FeatureCommand =
  | { readonly type: "create"; readonly workspaceRoot: string; readonly askEachRead: boolean }
  | { readonly type: "load"; readonly sessionId: string; readonly askEachRead: boolean }
  | { readonly type: "list"; readonly offset: number }
  | { readonly type: "catalog"; readonly query: DesktopSessionQuery }
  | { readonly type: "session.update"; readonly update: DesktopSessionUpdate }
  | { readonly type: "history"; readonly sessionId: string; readonly cursor?: string }
  | {
      readonly type: "history.message";
      readonly sessionId: string;
      readonly messageId: string;
      readonly offset: number;
    }
  | { readonly type: "history.close" };
export const commandTypes = [
  "create",
  "load",
  "list",
  "catalog",
  "session.update",
  "history",
  "history.message",
  "history.close",
] as const satisfies readonly FeatureCommand["type"][];
export interface FeatureState {
  readonly activeMetadata?: DesktopSessionMetadata | null;
  readonly catalog?: { readonly query: DesktopSessionQuery; readonly nextCursor: string | null };
  readonly history?: DesktopHistoryPage | null;
  readonly messageDetail?: DesktopMessageChunk | null;
  readonly historyOnly?: boolean;
  readonly openedHistory: boolean;
  readonly sessions: {
    readonly items: readonly DesktopSessionSummary[];
    readonly offset: number;
    readonly hasMore: boolean;
  };
  readonly activeSessionId: string | null;
  readonly workspaceRoot: string | null;
}
export const stateKeys = [
  "activeMetadata",
  "catalog",
  "history",
  "messageDetail",
  "historyOnly",
  "openedHistory",
  "sessions",
  "activeSessionId",
  "workspaceRoot",
] as const satisfies readonly (keyof FeatureState)[];
export interface FeatureBridge {
  getState(): Promise<DesktopState>;
  selectWorkspace(options: { readonly askEachRead: boolean }): Promise<DesktopState>;
}
