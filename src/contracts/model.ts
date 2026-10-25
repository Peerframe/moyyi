import type {
  ContentPart,
  JsonValue,
  ModelOrigin,
  ReplayEnvelope,
  StopReason,
  Usage,
} from "./persisted/index.ts";
import type { JsonSchema } from "./tools.ts";

/** A fully rendered request, produced by the ContextBuilder. */
export interface ModelRequest {
  readonly origin: ModelOrigin;
  readonly system: readonly ContentPart[];
  readonly messages: readonly ModelMessage[];
  readonly tools: readonly ToolSpec[];
  readonly maxOutputTokens: number;
}

export interface ModelMessage {
  readonly role: "user" | "assistant";
  readonly content: readonly ContentPart[];
  readonly replay?: ReplayEnvelope;
}

export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
}

/**
 * Performs exactly one model request. It translates protocols and streams events. It never
 * executes tools, never loops, and never retries; retry policy belongs to the core.
 *
 * Every stream ends with exactly one terminal event, `completed` or `error`, and nothing after
 * it. Provider, network and cancellation failures are reported as an `error` event and never
 * thrown; a thrown exception means a programming error. `checkModelStream` verifies this.
 */
export interface ModelClient {
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelStreamEvent>;
}

export type ModelStreamEvent =
  | { readonly type: "text_delta"; readonly index: number; readonly text: string }
  | { readonly type: "refusal_delta"; readonly index: number; readonly text: string }
  | {
      readonly type: "reasoning_delta";
      readonly index: number;
      readonly kind: "visible" | "summary";
      readonly text: string;
    }
  | { readonly type: "tool_call_delta"; readonly index: number; readonly argumentsDelta: string }
  /** A part is final and may be persisted. Tool calls are only acted upon after `completed`. */
  | { readonly type: "part_completed"; readonly index: number; readonly part: ContentPart }
  | {
      readonly type: "completed";
      readonly stopReason: StopReason;
      readonly providerStopReason: JsonValue;
      readonly usage: Usage;
      readonly replay?: ReplayEnvelope;
    }
  | { readonly type: "error"; readonly error: ModelError };

export interface ModelError {
  readonly kind: ModelErrorKind;
  readonly message: string;
  readonly retryAfterMs?: number;
  /** Any content delta or completed part was emitted, including incomplete argument deltas. */
  readonly partialOutput: boolean;
  /** Available usage on interrupted/error streams, including an explicitly unknown record. */
  readonly usage: Usage;
}

export type ModelErrorKind =
  | "rate_limited"
  | "overloaded"
  | "auth"
  | "invalid_request"
  | "context_overflow"
  | "network"
  | "stream_interrupted"
  | "protocol"
  | "cancelled";

/** Per-model facts the core and ContextBuilder adapt to. */
export interface ModelProfile {
  readonly origin: ModelOrigin;
  readonly contextWindowTokens: number;
  readonly maxOutputTokens: number;
  readonly parallelToolCalls: boolean;
  readonly reasoning: "none" | "visible" | "opaque";
  readonly promptCache: "none" | "automatic" | "explicit";
  /** Edit tool format that works best for this model; decided by evals, not by taste. */
  readonly editFormat: "search_replace" | "unified_diff" | "whole_file";
}
