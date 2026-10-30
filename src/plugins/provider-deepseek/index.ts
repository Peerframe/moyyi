import {
  canonicalizeJson,
  type ModelClient,
  type ModelErrorKind,
  type ModelStreamEvent,
  type Plugin,
  UNKNOWN_USAGE,
} from "../../contracts/index.ts";
import { buildDeepSeekRequest, decodeDeepSeekEvents, deepSeekProfile } from "./codec.ts";
import { type DeepSeekOptions, resolveDeepSeekReasoningEffort } from "./options.ts";
import { parseDeepSeekSse } from "./sse.ts";
import type { DeepSeekTransport, DeepSeekWireResponse } from "./types.ts";

export { DEEPSEEK_API_PROFILE, deepSeekProfile } from "./codec.ts";
export {
  type DeepSeekOptions,
  type DeepSeekReasoningEffort,
  deepSeekApiProfile,
  resolveDeepSeekReasoningEffort,
} from "./options.ts";
export type { DeepSeekTransport, DeepSeekWireResponse } from "./types.ts";

/** Exactly one HTTP attempt. Only the core decides whether a new model attempt is allowed. */
export function createDeepSeekClient(
  transport: DeepSeekTransport,
  options: DeepSeekOptions = {},
): ModelClient {
  const reasoningEffort = resolveDeepSeekReasoningEffort(options.reasoningEffort);
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
        yield error("cancelled", "DeepSeek request cancelled");
        return;
      }
      let body: string;
      try {
        body = canonicalizeJson(buildDeepSeekRequest(request, { reasoningEffort }));
        if (new TextEncoder().encode(body).byteLength > 4 * 1024 * 1024)
          throw Error("Request too large");
      } catch {
        yield error(
          "invalid_request",
          "Request is outside the supported DeepSeek text/reasoning/tool profile",
        );
        return;
      }
      let response: DeepSeekWireResponse;
      try {
        response = await transport(body, signal);
      } catch (failure) {
        const kind =
          failure instanceof Error && "kind" in failure && failure.kind === "auth"
            ? "auth"
            : "network";
        yield error(
          signal.aborted ? "cancelled" : kind,
          signal.aborted
            ? "DeepSeek request cancelled"
            : "DeepSeek transport or credential access failed",
        );
        return;
      }
      try {
        if (signal.aborted) {
          yield error("cancelled", "DeepSeek request cancelled");
          return;
        }
        if (response.status !== 200) {
          const kind: ModelErrorKind =
            response.status === 402
              ? "quota"
              : [401, 403].includes(response.status)
                ? "auth"
                : response.status === 429
                  ? "rate_limited"
                  : response.status >= 500 && response.status < 600
                    ? "overloaded"
                    : [400, 404, 413, 422].includes(response.status)
                      ? "invalid_request"
                      : "protocol";
          yield error(
            kind,
            response.status === 402
              ? "DeepSeek account balance is unavailable"
              : `DeepSeek HTTP ${response.status}`,
            retryAfter(response.retryAfter),
          );
          return;
        }
        if (response.contentType?.split(";")[0]?.trim().toLowerCase() !== "text/event-stream") {
          yield error("protocol", "DeepSeek response is not an event stream");
          return;
        }
        yield* decodeDeepSeekEvents(parseDeepSeekSse(response.body, signal), signal);
      } finally {
        // Cleanup failures cannot add a second terminal event or expose transport diagnostics.
        try {
          await response.close();
        } catch {
          /* host cleanup failure */
        }
      }
    },
  };
}

export function createDeepSeekPlugin(
  transport: DeepSeekTransport,
  options: DeepSeekOptions = {},
): Plugin {
  const reasoningEffort = resolveDeepSeekReasoningEffort(options.reasoningEffort);
  return {
    name: "provider-deepseek",
    apiVersion: 1,
    setup(host) {
      if (host.config !== undefined)
        throw Error("DeepSeek wire options are fixed by the trusted runtime");
      host.registerModelProvider({
        id: "deepseek",
        models: [deepSeekProfile],
        createClient(model) {
          if (model !== "deepseek-flash") throw Error("Unsupported DeepSeek model");
          return createDeepSeekClient(transport, { reasoningEffort });
        },
      });
    },
  };
}

function retryAfter(value: string | null): number | undefined {
  if (value === null || !/^[0-9]+(?:\.[0-9]+)?$/.test(value)) return undefined;
  const milliseconds = Number(value) * 1000;
  return Number.isFinite(milliseconds) ? Math.min(milliseconds, 30_000) : undefined;
}
