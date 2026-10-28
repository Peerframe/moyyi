import type { EffectId, EffectRecord, RunId, SessionId, Timestamp } from "./persisted/index.ts";
import type { ExecutionReceipt } from "./receipts.ts";

/** Local host inspection only. These views are neither persisted nor model context. */
export interface HistoryPage {
  readonly offset: number;
  readonly limit: number;
}

export interface SessionSummary {
  readonly sessionId: SessionId;
  readonly workspaceRoot: string;
  readonly lastActivityAt: Timestamp | null;
  /** A bounded excerpt of the last recorded user prompt, not a generated title. */
  readonly promptPreview: string | null;
}

export interface SessionListPage extends HistoryPage {
  readonly sessions: readonly SessionSummary[];
  readonly hasMore: boolean;
}

export interface HistoricalEffect {
  readonly effectId: EffectId;
  readonly runId: RunId;
  readonly tool: string;
  readonly state: EffectRecord["state"];
  readonly updatedAt: Timestamp;
  /** Matched journal/result evidence; never a claim about the file's current contents. */
  readonly receipt: ExecutionReceipt | null;
}

export interface SessionResultsPage extends HistoryPage {
  readonly sessionId: SessionId;
  readonly workspaceRoot: string;
  readonly effects: readonly HistoricalEffect[];
  readonly hasMore: boolean;
}

/** Local organization only: these fields never enter model context or grant authority. */
export interface SessionMetadata {
  readonly title: string | null;
  readonly group: string | null;
  readonly pinned: boolean;
  readonly muted: boolean;
  readonly removedAt: Timestamp | null;
  readonly revision: number;
}

export interface ManagedSessionSummary extends SessionSummary {
  readonly metadata: SessionMetadata;
}

export interface SessionQuery {
  readonly search?: string;
  readonly group?: string | null;
  readonly removed?: "active" | "removed" | "all";
  readonly cursor?: string;
  readonly limit?: number;
}

export interface ManagedSessionPage {
  readonly items: readonly ManagedSessionSummary[];
  readonly nextCursor: string | null;
}

export interface SessionUpdate {
  readonly sessionId: SessionId;
  readonly expectedRevision: number;
  readonly patch: {
    readonly title?: string | null;
    readonly group?: string | null;
    readonly pinned?: boolean;
    readonly muted?: boolean;
    readonly removed?: boolean;
  };
}

export interface SessionHistoryQuery {
  readonly sessionId: SessionId;
  /** Opaque older-page continuation, bound to this session. */
  readonly cursor?: string;
  readonly limit?: number;
}

/** Display projection only. Reasoning, replay and request blobs are deliberately absent. */
export interface SessionHistoryMessage {
  readonly id: string;
  readonly entryId: string;
  readonly role: "user" | "assistant" | "tool" | "notice";
  readonly text: string;
  readonly tool?: string;
  readonly state?: string;
  readonly recordedAt: Timestamp;
  readonly textLength: number;
  readonly truncated: boolean;
}

export interface SessionHistoryPage {
  readonly sessionId: SessionId;
  readonly workspaceRoot: string;
  /** Chronological within a page; nextCursor continues toward earlier records. */
  readonly items: readonly SessionHistoryMessage[];
  readonly nextCursor: string | null;
}

export interface SessionMessageQuery {
  readonly sessionId: SessionId;
  readonly messageId: string;
  /** UTF-16 offsets; returned continuations never split a surrogate pair. */
  readonly offset?: number;
  readonly limit?: number;
}

export interface SessionMessageChunk {
  readonly text: string;
  readonly totalLength: number;
  readonly nextOffset: number | null;
}

/** Trusted local host port. No model request, action replay, permission or workspace access. */
export interface SessionManagement {
  list(query?: SessionQuery): Promise<ManagedSessionPage>;
  history(query: SessionHistoryQuery): Promise<SessionHistoryPage>;
  readMessage(query: SessionMessageQuery): Promise<SessionMessageChunk>;
  update(change: SessionUpdate): Promise<ManagedSessionSummary>;
}
