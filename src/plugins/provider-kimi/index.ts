import {
  canonicalizeJson,
  type ModelClient,
  type ModelErrorKind,
  type ModelStreamEvent,
  type Plugin,
  UNKNOWN_USAGE,
} from "../../contracts/index.ts";
import { buildKimiRequest, decodeKimiEvents, kimiProfile } from "./codec.ts";
import { classifyKimi429 } from "./http-error.ts";
import { type KimiOptions, resolveKimiReasoningEffort } from "./options.ts";
import { parseKimiSse } from "./sse.ts";
import type { KimiTransport, KimiWireResponse } from "./types.ts";

export { KIMI_API_PROFILE, kimiProfile } from "./codec.ts";
export {
  type KimiOptions,
  type KimiReasoningEffort,
  kimiApiProfile,
  resolveKimiReasoningEffort,
} from "./options.ts";
export type { KimiTransport, KimiWireResponse } from "./types.ts";

/** Exactly one HTTP attempt. Only the core decides whether a new model attempt is allowed. */
export function createKimiClient(transport: KimiTransport, options: KimiOptions = {}): ModelClient {
  const reasoningEffort = resolveKimiReasoningEffort(options.reasoningEffort);
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
        yield error("cancelled", "Kimi request cancelled");
        return;
      }
      let body: string;
      try {
        body = canonicalizeJson(buildKimiRequest(request, { reasoningEffort }));
        if (new TextEncoder().encode(body).byteLength > 4 * 1024 * 1024)
          throw Error("Request too large");
      } catch {
        yield error(
          "invalid_request",
          "Request is outside the supported Kimi text/reasoning/tool profile",
        );
        return;
      }
      let response: KimiWireResponse;
      try {
        response = await transport(body, signal);
      } catch (failure) {
        const kind =
          failure instanceof Error && "kind" in failure && failure.kind === "auth"
            ? "auth"
            : "network";
        yield error(
          signal.aborted ? "cancelled" : kind,
          signal.aborted ? "Kimi request cancelled" : "Kimi transport or credential access failed",
        );
        return;
      }
      try {
        if (signal.aborted) {
          yield error("cancelled", "Kimi request cancelled");
          return;
        }
        if (response.status !== 200) {
          if (response.status === 429) {
            const diagnostic = await classifyKimi429(response.body, signal);
            yield error(
              diagnostic.kind,
              diagnostic.message,
              diagnostic.kind === "cancelled" ? undefined : retryAfter(response.retryAfter),
            );
            return;
          }
          const kind: ModelErrorKind = [401, 402, 403].includes(response.status)
            ? "auth"
            : [500, 503].includes(response.status)
              ? "overloaded"
              : [400, 404, 413, 422].includes(response.status)
                ? "invalid_request"
                : "protocol";
          yield error(
            kind,
            response.status === 402
              ? "Kimi account balance is unavailable"
              : `Kimi HTTP ${response.status}`,
            retryAfter(response.retryAfter),
          );
          return;
        }
        if (response.contentType?.split(";")[0]?.trim().toLowerCase() !== "text/event-stream") {
          yield error("protocol", "Kimi response is not an event stream");
          return;
        }
        yield* decodeKimiEvents(parseKimiSse(response.body, signal), signal, request.toolChoice);
      } finally {
        // Cleanup failures cannot add a second terminal event or expose transport diagnostics.
        try {
          const closing = response.close();
          // A stalled diagnostic body must not turn into a stalled terminal cleanup.
          if (response.status === 429) void Promise.resolve(closing).catch(() => {});
          else await closing;
        } catch {
          /* host cleanup failure */
        }
      }
    },
  };
}

export function createKimiPlugin(transport: KimiTransport, options: KimiOptions = {}): Plugin {
  const reasoningEffort = resolveKimiReasoningEffort(options.reasoningEffort);
  return {
    name: "provider-kimi",
    apiVersion: 1,
    setup(host) {
      if (host.config !== undefined)
        throw Error("Kimi wire options are fixed by the trusted runtime");
      host.registerModelProvider({
        id: "kimi",
        models: [kimiProfile],
        createClient(model) {
          if (model !== "kimi-k3.1-pro") throw Error("Unsupported Kimi model");
          return createKimiClient(transport, { reasoningEffort });
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
