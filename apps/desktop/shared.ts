/** Renderer DTOs deliberately do not import runtime/contracts or expose stored payloads. */
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
/** Non-executable desktop settings; model/provider endpoints are fixed reviewed presets. */
export interface DesktopSettings {
  readonly preset: "flash" | "kimi-cn" | "kimi-global";
  readonly maxRequests: number;
  readonly timeoutMs: number;
  readonly kimiReasoningEffort?: "low" | "high";
  readonly evidenceAnswer?: boolean;
}
export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  preset: "flash",
  maxRequests: 3,
  timeoutMs: 120_000,
};
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

/** Ephemeral host grants; opening history never restores these permissions. */
export interface DesktopPermissions {
  readonly writes: boolean;
  readonly checks: boolean;
}
export interface DesktopWebAccess {
  readonly allowedOrigins: readonly string[];
  readonly dns: "system" | "cloudflare-doh";
}
/** Recorded tool observations, not verified claims or webpage publication dates. */
export interface DesktopWebSource {
  readonly id: string;
  readonly entryId: string;
  readonly callId: string;
  readonly url: string;
  readonly status: number;
  readonly contentType: string;
  readonly title: string | null;
  readonly text: string;
  readonly truncated: boolean;
  readonly displayTruncated: boolean;
  readonly recordedAt: string;
  readonly textSha256: string;
}
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
  readonly metadata?: DesktopSessionMetadata;
}

export interface DesktopApproval {
  readonly effectId: string;
  readonly digest: string;
  readonly summary: string;
  readonly preview?: string;
}

export interface DesktopState {
  readonly activeMetadata?: DesktopSessionMetadata | null;
  readonly importing?: boolean;
  readonly library?: {
    readonly items: readonly DesktopManagedMaterial[];
    readonly offset: number;
    readonly hasMore: boolean;
    readonly housekeeping: boolean;
  };
  readonly materialPreview?: DesktopArtifactPreview | null;
  readonly catalog?: { readonly query: DesktopSessionQuery; readonly nextCursor: string | null };
  readonly history?: DesktopHistoryPage | null;
  readonly messageDetail?: DesktopMessageChunk | null;
  readonly historyOnly?: boolean;
  readonly status: "ready" | "closing" | "closed";
  readonly connection: { readonly ready: boolean; readonly message?: string };
  readonly settings: DesktopSettings;
  readonly materials: readonly DesktopMaterial[];
  readonly reportTarget: string | null;
  readonly permissions: DesktopPermissions;
  readonly webAccess: DesktopWebAccess;
  readonly sources: { readonly items: readonly DesktopWebSource[]; readonly truncated: boolean };
  readonly openedHistory: boolean;
  readonly effects: {
    readonly items: readonly DesktopEffect[];
    readonly offset: number;
    readonly hasMore: boolean;
  };
  readonly effectInspection: DesktopEffectInspection | null;
  readonly artifacts: {
    readonly items: readonly DesktopArtifact[];
    readonly offset: number;
    readonly hasMore: boolean;
  };
  readonly artifactPreview: DesktopArtifactPreview | null;
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
  | { readonly type: "material.cancel"; readonly sessionId: string }
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
  | { readonly type: "history.close" }
  | { readonly type: "start"; readonly sessionId: string; readonly text: string }
  | { readonly type: "cancel"; readonly runId: string }
  | {
      readonly type: "approve";
      readonly effectId: string;
      readonly digest: string;
      readonly decision: "approve" | "deny";
    }
  | { readonly type: "configure"; readonly settings: DesktopSettings; readonly apiKey?: string }
  | {
      readonly type: "permissions";
      readonly sessionId: string;
      readonly writes: boolean;
      readonly checks: boolean;
    }
  | ({ readonly type: "web.permissions"; readonly sessionId: string } & DesktopWebAccess)
  | { readonly type: "effects"; readonly sessionId: string; readonly offset: number }
  | { readonly type: "effect.inspect"; readonly sessionId: string; readonly effectId: string }
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
  | { readonly type: "material.remove"; readonly sessionId: string; readonly path: string }
  | { readonly type: "report.target"; readonly sessionId: string; readonly path: string | null }
  | { readonly type: "report.clear"; readonly sessionId: string }
  | { readonly type: "artifacts"; readonly sessionId: string; readonly offset: number }
  | { readonly type: "artifact.open"; readonly sessionId: string; readonly effectId: string }
  | { readonly type: "artifact.close" }
  | { readonly type: "close" };

export type DesktopAction = Exclude<
  DesktopCommand,
  {
    readonly type:
      | "create"
      | "close"
      | "configure"
      | "materials"
      | "materials.import"
      | "report.target"
      | "permissions"
      | "web.permissions";
  }
>;

/** Promise resolution acknowledges handling; run/outcome events determine actual completion. */
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

export interface DesktopBridge {
  getState(): Promise<DesktopState>;
  createBackup(): Promise<DesktopMaintenanceResult | null>;
  restoreBackup(): Promise<DesktopMaintenanceResult | null>;
  rollbackApplication(): Promise<DesktopMaintenanceResult | null>;
  subscribe(listener: (state: DesktopState) => void): () => void;
  selectWorkspace(options: { readonly askEachRead: boolean }): Promise<DesktopState>;
  act(command: DesktopAction): Promise<DesktopState>;
  configure(options: {
    readonly settings: DesktopSettings;
    readonly apiKey?: string;
  }): Promise<DesktopState>;
  selectDocuments(options: { readonly sessionId: string }): Promise<DesktopState>;
  selectReportTarget(options: { readonly sessionId: string }): Promise<DesktopState>;
  configurePermissions(
    options: DesktopPermissions & { readonly sessionId: string },
  ): Promise<DesktopState>;
  configureWebAccess(
    options: DesktopWebAccess & { readonly sessionId: string },
  ): Promise<DesktopState>;
  saveArtifact(options: {
    readonly sessionId: string;
    readonly effectId: string;
  }): Promise<DesktopState>;
  importFiles(options: {
    readonly sessionId: string;
    readonly files: readonly File[];
  }): Promise<DesktopState>;
  pasteImage(options: { readonly sessionId: string }): Promise<DesktopState>;
  revealArtifact(options: {
    readonly sessionId: string;
    readonly effectId: string;
  }): Promise<DesktopState>;
}

declare global {
  interface Window {
    readonly moyyi: DesktopBridge;
  }
}
