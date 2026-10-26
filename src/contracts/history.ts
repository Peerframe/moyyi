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
