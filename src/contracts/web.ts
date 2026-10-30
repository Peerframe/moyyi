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
  /** Provider-reported usage; null means unreported, never an estimated zero. */
  readonly search?: {
    readonly backend: "deepseek";
    readonly query: string;
    readonly usage: WebSearchUsage;
    readonly error?: "no_structured_results" | "native_search_failed";
  };
}

export interface WebSearchUsage {
  readonly successfulSearches: number | null;
  readonly attemptedSearches: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheReadInputTokens: number | null;
  readonly cacheCreationInputTokens: number | null;
}

export interface WebAccess {
  /** Validates an exact proposal without DNS or network I/O. */
  prepare(request: WebRequest): Promise<WebRequest>;
  /** Runs only the approved proposal, once, after its durable start barrier. */
  execute(): Promise<WebResponse>;
}
