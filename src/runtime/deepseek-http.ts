import type {
  DeepSeekTransport,
  DeepSeekWireResponse,
} from "../plugins/provider-deepseek/index.ts";

export const DEEPSEEK_RESPONSES_URL = "https://api.deepseek.com/responses";
export interface DeepSeekHttpOptions {
  /** Caller-supplied secret access. Never read environment/configuration or persist the value here. */
  readonly getApiKey: () => string | Promise<string>;
  /** Trusted host injection for deterministic tests; never exposed as a model/tool argument. */
  readonly fetch?: typeof fetch;
}

/** Fixed-origin, no-redirect transport. The provider receives neither credentials nor headers. */
export function deepSeekHttpTransport(options: DeepSeekHttpOptions): DeepSeekTransport {
  const send = options.fetch ?? fetch;
  return async (body, signal): Promise<DeepSeekWireResponse> => {
    let key: string;
    try {
      if (signal.aborted) throw Error("cancelled");
      key = await options.getApiKey();
      if (signal.aborted) throw Error("cancelled");
      if (
        typeof key !== "string" ||
        key.length < 1 ||
        key.length > 4096 ||
        [...key].some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) > 126)
      )
        throw Error("Invalid credential");
    } catch {
      throw Object.assign(Error("DeepSeek credential access failed"), {
        kind: signal.aborted ? "cancelled" : "auth",
      });
    }
    let response: Response;
    try {
      if (signal.aborted) throw Error("cancelled");
      response = await send(DEEPSEEK_RESPONSES_URL, {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        signal,
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          Authorization: `Bearer ${key}`,
        },
        body,
      });
    } catch {
      // Fetch, credential providers and proxies may throw secret-bearing errors.
      throw Error(signal.aborted ? "DeepSeek request cancelled" : "DeepSeek transport unavailable");
    }
    const reader = response.body?.getReader();
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      try {
        await reader?.cancel();
      } catch {
        // Errored streams can reject cancel with the original, secret-bearing transport error.
      } finally {
        reader?.releaseLock();
      }
    };
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      retryAfter: response.headers.get("retry-after"),
      close,
      body: {
        async *[Symbol.asyncIterator]() {
          if (!reader) return;
          try {
            for (;;) {
              if (signal.aborted) throw Error("DeepSeek stream cancelled");
              const result = await reader.read();
              if (signal.aborted) throw Error("DeepSeek stream cancelled");
              if (result.done) break;
              yield result.value;
            }
          } catch {
            throw Error(
              signal.aborted ? "DeepSeek stream cancelled" : "DeepSeek stream transport failed",
            );
          } finally {
            await close();
          }
        },
      },
    };
  };
}
