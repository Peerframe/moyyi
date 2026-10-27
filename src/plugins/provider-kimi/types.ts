/** Credentials/HTTP headers are owned by the host; the provider sees only the response body. */
export interface KimiWireResponse {
  readonly status: number;
  readonly contentType: string | null;
  readonly retryAfter: string | null;
  readonly body: AsyncIterable<Uint8Array>;
  close(): Promise<void>;
}
export type KimiTransport = (body: string, signal: AbortSignal) => Promise<KimiWireResponse>;

export class KimiWireError extends Error {
  readonly kind: "protocol" | "network" | "cancelled" | "stream_interrupted" | "auth";
  constructor(kind: KimiWireError["kind"], message: string) {
    super(message);
    this.kind = kind;
  }
}
