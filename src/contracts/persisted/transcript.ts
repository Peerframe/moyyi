import type { ContentPart, ModelOrigin, TextPart, ToolResultPart } from "./content.ts";
import type { BlobRef, EntryId, RunId, SessionId, Timestamp } from "./ids.ts";
import type { JsonValue, ReplayEnvelope } from "./replay.ts";

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

export type StopReason =
  | "end_turn"
  | "tool_use"
  | "max_tokens"
  | "refusal"
  | "interrupted"
  | "other";

export interface AssistantMessageBody {
  readonly kind: "assistant_message";
  readonly origin: ModelOrigin;
  readonly content: readonly ContentPart[];
  readonly stopReason: StopReason;
  /** Provider termination code/details; null means not reported, never an invented value. */
  readonly providerStopReason: JsonValue;
  readonly usage: Usage;
  readonly replay?: ReplayEnvelope;
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
  readonly status: "unknown" | "partial" | "final";
  /** Total input includes cache read/write subcounts. Missing counters are null, not zero. */
  readonly inputTokens: number | null;
  /** Includes any reasoning tokens counted by the provider; never add them again. */
  readonly outputTokens: number | null;
  readonly cacheReadTokens: number | null;
  readonly cacheWriteTokens: number | null;
  readonly reasoningTokens: number | null;
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
