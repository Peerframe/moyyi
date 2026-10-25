import type { ContentPart, ModelOrigin } from "./content.ts";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** Non-secret configuration identity; a rolling model alias is not a known model revision. */
export interface ReplayOrigin extends ModelOrigin {
  readonly apiProfile: string;
  readonly modelRevision: string | null;
}

/** Canonicalized together (RFC 8785), then hashed using SHA-256. Order is significant. */
export interface ReplayContent {
  readonly role: "user" | "assistant";
  readonly content: readonly ContentPart[];
}

/** Payload interpretation belongs exclusively to its originating adapter. Never grants authority. */
export interface ReplayEnvelope {
  readonly version: 1;
  readonly payloadVersion: number;
  readonly origin: ReplayOrigin;
  readonly contentHash: string;
  /** UTF-8 adapter bytes represented as a string; never parsed by generic validation. */
  readonly payload: string;
}

export const MAX_REPLAY_BYTES = 1_048_576;
