import {
  ANTHROPIC_API_VERSION,
  type AnthropicTransport,
  type AnthropicWireResponse,
} from "../plugins/provider-anthropic/index.ts";

export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
export interface AnthropicHttpOptions {
  /** Explicit trusted credential access; no environment/config discovery or secret persistence. */
  readonly getApiKey: () => string | Promise<string>;
  /** Non-secret account identity; change this when switching the account behind the credential. */
  readonly accountScope: string;
  readonly fetch?: typeof fetch;
}

/** Fixed-origin Messages transport. Secrets and raw transport errors never reach the model. */
export function anthropicHttpTransport(options: AnthropicHttpOptions): AnthropicTransport {
  const send = options.fetch ?? fetch;
  return async (body, signal): Promise<AnthropicWireResponse> => {
    let key: string;
    try {
      if (signal.aborted) throw Error("cancelled");
      key = await options.getApiKey();
      if (
        signal.aborted ||
        typeof key !== "string" ||
        key.length < 1 ||
        key.length > 4096 ||
        [...key].some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) > 126)
      )
        throw Error("Invalid credential");
    } catch {
      throw Object.assign(Error("Anthropic credential access failed"), {
        kind: signal.aborted ? "cancelled" : "auth",
      });
    }
    let response: Response;
    try {
      if (signal.aborted) throw Error("cancelled");
      response = await send(ANTHROPIC_MESSAGES_URL, {
        method: "POST",
        redirect: "error",
        cache: "no-store",
        signal,
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
          "x-api-key": key,
          "anthropic-version": ANTHROPIC_API_VERSION,
        },
        body,
      });
    } catch {
      throw Error(
        signal.aborted ? "Anthropic request cancelled" : "Anthropic transport unavailable",
      );
    }
    const reader = response.body?.getReader();
    let closed = false;
    const close = async () => {
      if (closed) return;
      closed = true;
      try {
        await reader?.cancel();
      } catch {
        /* Never leak credential-bearing transport exceptions. */
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
              if (signal.aborted) throw Error("cancelled");
              const result = await reader.read();
              if (signal.aborted) throw Error("cancelled");
              if (result.done) break;
              yield result.value;
            }
          } catch {
            throw Error(
              signal.aborted ? "Anthropic stream cancelled" : "Anthropic stream transport failed",
            );
          } finally {
            await close();
          }
        },
      },
    };
  };
}
