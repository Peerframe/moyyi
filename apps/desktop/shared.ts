/** Desktop projections contain display data, never a runtime, credential or raw transcript. */
export interface DesktopMessage {
  readonly id: string;
  readonly role: "user" | "assistant" | "tool" | "notice";
  readonly text: string;
  readonly tool?: string;
  readonly state?: string;
}

export interface DesktopSessionSummary {
  readonly sessionId: string;
  readonly workspaceRoot: string;
  readonly lastActivityAt: string | null;
  readonly promptPreview: string | null;
}

export interface DesktopApproval {
  readonly effectId: string;
  readonly digest: string;
  readonly summary: string;
  readonly preview?: string;
}

export interface DesktopState {
  readonly status: "ready" | "closing" | "closed";
  readonly connection: { readonly ready: boolean; readonly message?: string };
  readonly sessions: {
    readonly items: readonly DesktopSessionSummary[];
    readonly offset: number;
    readonly hasMore: boolean;
  };
  readonly activeSessionId: string | null;
  readonly workspaceRoot: string | null;
  readonly model: { readonly provider: string; readonly model: string } | null;
  readonly budgets: {
    readonly maxRequests: number | null;
    readonly timeoutMs: number | null;
    readonly maxOutputTokens: number | null;
  };
  readonly askEachRead: boolean;
  readonly messages: readonly DesktopMessage[];
  readonly historyTruncated: boolean;
  readonly streamText: string;
  readonly run: { readonly id: string; readonly state: "running" | "cancelling" } | null;
  readonly outcome: {
    readonly kind: "completed" | "cancelled" | "budget_exhausted" | "failed";
    readonly detail?: string;
  } | null;
  /** Only the first pending approval is displayed; later requests remain queued in the host. */
  readonly pendingApproval: DesktopApproval | null;
  readonly error: string | null;
}

/** Trusted main/worker commands. Only the native picker may supply create.workspaceRoot. */
export type DesktopCommand =
  | { readonly type: "create"; readonly workspaceRoot: string; readonly askEachRead: boolean }
  | { readonly type: "load"; readonly sessionId: string; readonly askEachRead: boolean }
  | { readonly type: "list"; readonly offset: number }
  | { readonly type: "start"; readonly sessionId: string; readonly text: string }
  | { readonly type: "cancel"; readonly runId: string }
  | {
      readonly type: "approve";
      readonly effectId: string;
      readonly digest: string;
      readonly decision: "approve" | "deny";
    }
  | { readonly type: "close" };

export type DesktopAction = Exclude<DesktopCommand, { readonly type: "create" }>;

/** Promise resolution acknowledges handling; run/outcome events determine actual completion. */
export interface DesktopBridge {
  getState(): Promise<DesktopState>;
  subscribe(listener: (state: DesktopState) => void): () => void;
  selectWorkspace(options: { readonly askEachRead: boolean }): Promise<DesktopState>;
  act(command: DesktopAction): Promise<DesktopState>;
}

declare global {
  interface Window {
    readonly moyyi: DesktopBridge;
  }
}
