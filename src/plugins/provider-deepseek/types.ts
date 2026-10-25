/** Credentials/HTTP headers are owned by the host; the provider sees only the response body. */
export interface DeepSeekWireResponse {
  readonly status: number;
  readonly contentType: string | null;
  readonly retryAfter: string | null;
  readonly body: AsyncIterable<Uint8Array>;
  close(): Promise<void>;
}
export type DeepSeekTransport = (
  body: string,
  signal: AbortSignal,
) => Promise<DeepSeekWireResponse>;

export class DeepSeekWireError extends Error {
  readonly kind: "protocol" | "network" | "cancelled" | "stream_interrupted" | "auth";
  constructor(kind: DeepSeekWireError["kind"], message: string) {
    super(message);
    this.kind = kind;
  }
}
