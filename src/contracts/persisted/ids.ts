declare const brand: unique symbol;

/** Nominal string type: prevents passing a RunId where a SessionId is expected. */
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type SessionId = Brand<string, "SessionId">;
export type EntryId = Brand<string, "EntryId">;
export type RunId = Brand<string, "RunId">;
export type ToolCallId = Brand<string, "ToolCallId">;
export type EffectId = Brand<string, "EffectId">;

/** Content-addressed reference into the blob store (e.g. "sha256:<hex>"). */
export type BlobRef = Brand<string, "BlobRef">;

/** Digest of a prepared action; approvals bind to it, never to a tool name alone. */
export type ActionDigest = Brand<string, "ActionDigest">;

/** RFC 3339 timestamp produced by the injected clock. */
export type Timestamp = Brand<string, "Timestamp">;
