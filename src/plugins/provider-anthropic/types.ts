import type { ModelErrorKind } from "../../contracts/index.ts";
/** Credentials and headers stay in the trusted runtime, outside this provider. */
export interface AnthropicWireResponse {
  readonly status: number;
  readonly contentType: string | null;
  readonly retryAfter: string | null;
  readonly body: AsyncIterable<Uint8Array>;
  close(): Promise<void>;
}
export type AnthropicTransport = (
  body: string,
  signal: AbortSignal,
) => Promise<AnthropicWireResponse>;
export interface AnthropicOptions {
  /** Non-secret host identity for the account, never the API key or a hash of it. */
  readonly accountScope: string;
}
export class AnthropicWireError extends Error {
  readonly kind: ModelErrorKind;
  constructor(kind: ModelErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}
