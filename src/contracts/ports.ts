import type {
  HistoryPage,
  ManagedSessionSummary,
  SessionListPage,
  SessionManagement,
  SessionUpdate,
} from "./history.ts";
import type { ModelProfile, ModelRequest, ToolSpec } from "./model.ts";
import type {
  BlobRef,
  EffectId,
  EffectProfile,
  EffectRecord,
  EntryId,
  RunId,
  SessionId,
  Timestamp,
  TranscriptEntry,
} from "./persisted/index.ts";
import type { ContextSection } from "./plugin.ts";
import type { PreparedAction } from "./tools.ts";

/**
 * Ports the core depends on. Implementations live in src/store, src/context, src/policy and
 * are wired in src/runtime; the core never imports them directly.
 */

export interface SessionStore {
  /** Enumerates persisted sessions for startup recovery, including runs with no effects. */
  listSessions(): Promise<readonly SessionId[]>;
  /** Optional bounded, read-only catalog for local clients. Recovery keeps listSessions. */
  listSessionSummaries?(page: HistoryPage): Promise<SessionListPage>;
  /** Optional host-only management. Recovery and core continue using the original ports. */
  readonly sessionManagement?: Omit<SessionManagement, "update"> & {
    update(change: SessionUpdate, now: Timestamp): Promise<ManagedSessionSummary>;
  };
  /** Removed sessions remain readable/recoverable, but must be restored before new runs. */
  isSessionRemoved?(sessionId: SessionId): boolean;
  /** Applies all changes in one transaction, or none of them. */
  commit(batch: StoreBatch): Promise<void>;
  loadSession(sessionId: SessionId): Promise<SessionSnapshot | null>;
  /** Non-terminal effects from earlier processes, to be reconciled at startup. */
  unsettledEffects(): Promise<readonly EffectRecord[]>;
  putBlob(bytes: Uint8Array): Promise<BlobRef>;
  getBlob(ref: BlobRef): Promise<Uint8Array | null>;
}

export interface StoreBatch {
  readonly entries: readonly TranscriptEntry[];
  /** Upserts; the store rejects any change that is not a legal effect transition. */
  readonly effects: readonly EffectRecord[];
  /** Session heads and run state share the entries/effects transaction. */
  readonly sessions?: readonly SessionState[];
  readonly runs?: readonly RunState[];
  readonly leases?: readonly WorkspaceLeaseChange[];
  /**
   * Both labels use WAL + FULL. `before_side_effect` marks the barrier before an action;
   * durability still depends on the operating system/filesystem honoring synchronization.
   */
  readonly durability: "normal" | "before_side_effect";
}

export interface SessionState {
  readonly sessionId: SessionId;
  readonly workspaceRoot: string;
  readonly headEntryId: EntryId | null;
}

export interface RunState {
  readonly runId: RunId;
  readonly sessionId: SessionId;
  readonly status: "active" | "completed" | "interrupted";
}

export interface WorkspaceLease {
  readonly workspaceRoot: string;
  readonly runId: RunId;
}

export type WorkspaceLeaseChange = WorkspaceLease & { readonly kind: "acquire" | "release" };

export interface SessionSnapshot {
  readonly sessionId: SessionId;
  readonly workspaceRoot: string;
  readonly headEntryId: EntryId | null;
  readonly entries: readonly TranscriptEntry[];
  readonly effects: readonly EffectRecord[];
  readonly runs: readonly RunState[];
  readonly leases: readonly WorkspaceLease[];
}

export interface ContextBuilder {
  build(input: ContextInput): ContextResult;
  /** Explicit fresh-session answer from user inputs and original tool observations. */
  buildEvidenceAnswer?(input: ContextInput): ContextResult;
  /** Plans an explicit, tool-free summary request without changing history. */
  planCompaction?(input: ContextInput): CompactionPlan | null;
}

export interface CompactionPlan {
  readonly replaces: { readonly fromEntryId: EntryId; readonly toEntryId: EntryId };
  readonly request: ModelRequest;
  readonly promptVersion: string;
  /** Required request tokens before compaction, excluding optional context sections. */
  readonly originalTokens: number;
}

export interface ContextInput {
  /** Entries from the root to the current head, in order. */
  readonly path: readonly TranscriptEntry[];
  readonly profile: ModelProfile;
  readonly tools: readonly ToolSpec[];
  /** A final-answer request retains tool history but forbids new tool calls. */
  readonly toolChoice?: "none";
  /** Collected from plugin context sources before building. */
  readonly sections: readonly ContextSection[];
  /** Effects the model must be told about regardless of compaction. */
  readonly unsettledEffects: readonly EffectRecord[];
}

export interface ContextResult {
  readonly request: ModelRequest;
  /** What was included, summarized or dropped, for debugging and evals. */
  readonly report: {
    readonly includedEntryIds: readonly EntryId[];
    readonly notes: readonly string[];
    readonly estimatedTokens?: number;
    readonly summarizedEntryIds?: readonly EntryId[];
  };
}

export type PolicyDecision =
  | { readonly kind: "allow" }
  | { readonly kind: "ask" }
  | { readonly kind: "deny"; readonly reason: string };

export interface PermissionPolicy {
  /** Mutable grant owners increment this epoch on every grant/revocation. */
  revision?(): number;
  /** Automatic context reads have no approval flow. Missing, ask or deny means no read. */
  /** Workspace context uses relative paths; selected skills use absolute host paths. */
  /** Directory navigation asks for list; omission retains the existing read operation. */
  beforeContextRead?(path: string, operation?: "read" | "list"): PolicyDecision;
  /** Called before `prepare`, which reads state and therefore needs read permission too. */
  beforePrepare(tool: string, profile: EffectProfile, args: unknown): PolicyDecision;
  /** Called with the prepared action; the decision binds to its digest. */
  beforeExecute(
    tool: string,
    profile: EffectProfile,
    action: PreparedAction,
    effectId: EffectId,
    args?: unknown,
  ): PolicyDecision;
}

export interface Clock {
  now(): Timestamp;
}

export interface IdSource {
  next(prefix: string): string;
}
