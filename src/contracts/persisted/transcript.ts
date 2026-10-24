import type { ContentPart, ModelOrigin, TextPart, ToolResultPart } from "./content.ts";
import type { BlobRef, EntryId, RunId, SessionId, Timestamp } from "./ids.ts";

/**
 * One immutable transcript entry. Entries form a tree through `parentId` so that editing an
 * earlier message, retrying, or forking a session never rewrites history.
 */
export interface TranscriptEntry {
  readonly id: EntryId;
  readonly sessionId: SessionId;
  readonly parentId: EntryId | null;
  readonly runId: RunId | null;
  readonly createdAt: Timestamp;
  readonly body: EntryBody;
}

export type EntryBody =
  | UserMessageBody
  | AssistantMessageBody
  | ToolResultsBody
  | CompactionBody
  | NoticeBody;

export interface UserMessageBody {
  readonly kind: "user_message";
  readonly content: readonly ContentPart[];
  /** True when sent while a run was active (steering) rather than starting a run. */
  readonly steering: boolean;
}

export type StopReason = "end_turn" | "tool_use" | "max_tokens" | "refusal" | "interrupted";

export interface AssistantMessageBody {
  readonly kind: "assistant_message";
  readonly origin: ModelOrigin;
  readonly content: readonly ContentPart[];
  readonly stopReason: StopReason;
  readonly usage: Usage;
  /** The exact request the model saw, for debugging, replay and training export. */
  readonly request: RenderedRequestRef;
}

export interface ToolResultsBody {
  readonly kind: "tool_results";
  readonly results: readonly ToolResultPart[];
}

/**
 * A context compaction is itself a recorded fact: which span it replaces, what it says, and
 * what produced it. Original entries are never deleted.
 */
export interface CompactionBody {
  readonly kind: "compaction";
  readonly replaces: { readonly fromEntryId: EntryId; readonly toEntryId: EntryId };
  readonly summary: readonly TextPart[];
  readonly producedBy: { readonly origin: ModelOrigin; readonly promptVersion: string };
}

/** Runtime-authored facts the model must see, e.g. "the previous run was interrupted". */
export interface NoticeBody {
  readonly kind: "notice";
  readonly code: string;
  readonly text: string;
}

export interface Usage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
}

/**
 * The exact request a model saw, stored piecewise. Each rendered message is its own
 * content-addressed blob, so the history shared by consecutive requests is stored once and
 * storage grows linearly with session length instead of quadratically.
 */
export interface RenderedRequestRef {
  readonly rendererVersion: string;
  readonly system: BlobRef;
  readonly tools: BlobRef;
  readonly messages: readonly BlobRef[];
}
