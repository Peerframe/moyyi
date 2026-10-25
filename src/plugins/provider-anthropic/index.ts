import {
  canonicalizeJson,
  type ModelClient,
  type ModelErrorKind,
  type ModelStreamEvent,
  type Plugin,
  UNKNOWN_USAGE,
} from "../../contracts/index.ts";
import { anthropicProfile, buildAnthropicRequest, decodeAnthropicEvents } from "./codec.ts";
import { parseAnthropicSse } from "./sse.ts";
import type { AnthropicOptions, AnthropicTransport, AnthropicWireResponse } from "./types.ts";

export { ANTHROPIC_API_PROFILE, ANTHROPIC_API_VERSION, anthropicProfile } from "./codec.ts";
export type { AnthropicOptions, AnthropicTransport, AnthropicWireResponse } from "./types.ts";

/** One attempt only: credentials, policy and retries belong to the runtime/core. */
export function createAnthropicClient(
  transport: AnthropicTransport,
  options: AnthropicOptions,
): ModelClient {
  if (!/^[a-zA-Z0-9_.:-]{1,128}$/.test(options.accountScope))
    throw Error("A non-secret accountScope is required");
  return {
    async *stream(request, signal) {
      const error = (
        kind: ModelErrorKind,
        message: string,
        retryAfterMs?: number,
      ): ModelStreamEvent => ({
        type: "error",
        error: {
          kind,
          message,
          partialOutput: false,
          usage: UNKNOWN_USAGE,
          ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
        },
      });
      if (signal.aborted) {
        yield error("cancelled", "Anthropic request cancelled");
        return;
      }
      let prepared: ReturnType<typeof buildAnthropicRequest>;
      try {
        prepared = buildAnthropicRequest(request, options);
      } catch {
        yield error(
          "invalid_request",
          "Request is outside the supported Anthropic text/thinking/tool profile",
        );
        return;
      }
      let response: AnthropicWireResponse;
      try {
        response = await transport(canonicalizeJson(prepared.body), signal);
      } catch (failure) {
        yield error(
          signal.aborted
            ? "cancelled"
            : failure instanceof Error && "kind" in failure && failure.kind === "auth"
              ? "auth"
              : "network",
          signal.aborted
            ? "Anthropic request cancelled"
            : "Anthropic transport or credential access failed",
        );
        return;
      }
      try {
        if (signal.aborted) {
          yield error("cancelled", "Anthropic request cancelled");
          return;
        }
        if (response.status !== 200) {
          const kind: ModelErrorKind = [401, 403].includes(response.status)
            ? "auth"
            : response.status === 429
              ? "rate_limited"
              : [500, 502, 503, 504, 529].includes(response.status)
                ? "overloaded"
                : [400, 404, 413, 422].includes(response.status)
                  ? "invalid_request"
                  : "protocol";
          const retry =
            response.retryAfter !== null && /^[0-9]+(?:\.[0-9]+)?$/.test(response.retryAfter)
              ? Number(response.retryAfter) * 1000
              : undefined;
          yield error(
            kind,
            `Anthropic HTTP ${response.status}`,
            retry !== undefined && Number.isFinite(retry) ? Math.min(retry, 30_000) : undefined,
          );
          return;
        }
        if (response.contentType?.split(";")[0]?.trim().toLowerCase() !== "text/event-stream") {
          yield error("protocol", "Anthropic response is not an event stream");
          return;
        }
        yield* decodeAnthropicEvents(
          parseAnthropicSse(response.body, signal),
          signal,
          prepared,
          options,
        );
      } finally {
        try {
          await response.close();
        } catch {
          /* cleanup cannot add a second terminal event */
        }
      }
    },
  };
}

export function createAnthropicPlugin(
  transport: AnthropicTransport,
  options: AnthropicOptions,
): Plugin {
  return {
    name: "provider-anthropic",
    apiVersion: 1,
    setup(host) {
      if (host.config !== undefined)
        throw Error("Anthropic connection is fixed by the trusted runtime");
      host.registerModelProvider({
        id: "anthropic",
        models: [anthropicProfile],
        createClient(model) {
          if (model !== anthropicProfile.origin.model) throw Error("Unsupported Anthropic model");
          return createAnthropicClient(transport, options);
        },
      });
    },
  };
}
