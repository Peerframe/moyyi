import type { BlobRef, ToolCallId } from "./ids.ts";

/**
 * Provider-neutral content. This shape is persisted, so it must represent the union of what
 * the supported wire protocols need to round-trip, not the lowest common denominator.
 * See docs/decisions/0003-provider-neutral-content.md.
 */
export type ContentPart = TextPart | ImagePart | ReasoningPart | ToolCallPart | ToolResultPart;

export interface TextPart {
  readonly type: "text";
  readonly text: string;
}

export interface ImagePart {
  readonly type: "image";
  readonly mediaType: string;
  readonly blob: BlobRef;
}

/**
 * Model reasoning. `opaque` is provider-owned (e.g. a signed thinking block or an encrypted
 * reasoning item) and must be replayed verbatim, and only, to the same provider family and model
 * that produced it. Other targets get `summary` or nothing.
 */
export interface ReasoningPart {
  readonly type: "reasoning";
  readonly origin: ModelOrigin;
  readonly summary?: string;
  readonly opaque?: unknown;
}

export interface ToolCallPart {
  readonly type: "tool_call";
  readonly callId: ToolCallId;
  /** The provider's own id, needed to pair the result on the wire. */
  readonly providerCallId: string;
  readonly name: string;
  /** Exactly what the model produced; kept even when it does not parse. */
  readonly rawArguments: string;
}

export type ToolResultStatus =
  | "succeeded"
  | "failed"
  | "denied"
  | "cancelled"
  /** The effect may or may not have happened; the model is told to verify before retrying. */
  | "unknown";

export interface ToolResultPart {
  readonly type: "tool_result";
  readonly callId: ToolCallId;
  readonly status: ToolResultStatus;
  readonly content: readonly (TextPart | ImagePart)[];
}

/** Identifies which provider family and model produced provider-bound content. */
export interface ModelOrigin {
  readonly provider: string;
  readonly model: string;
}
