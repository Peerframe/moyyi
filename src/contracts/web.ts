/** Outbound tool requests are distinct from model-provider traffic and local file reads. */
export type WebRequest =
  | { readonly kind: "fetch"; readonly url: string }
  | { readonly kind: "search"; readonly query: string; readonly count: number };

export interface WebResponse {
  readonly url: string;
  readonly status: number;
  readonly contentType: string;
  readonly text: string;
  readonly truncated: boolean;
}

export interface WebAccess {
  /** Validates an exact proposal without DNS or network I/O. */
  prepare(request: WebRequest): Promise<WebRequest>;
  /** Runs only the approved proposal, once, after its durable start barrier. */
  execute(): Promise<WebResponse>;
}
