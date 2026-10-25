import {
  type ContentPart,
  canonicalizeJson,
  checkModelStream,
  type JsonValue,
  type ModelClient,
  type ModelError,
  type ModelRequest,
  type ModelStreamEvent,
  type ReplayEnvelope,
  type StopReason,
  UNKNOWN_USAGE,
  type Usage,
} from "../contracts/index.ts";

export interface Response {
  parts: ContentPart[];
  partial: boolean;
  error?: ModelError;
  stopReason: StopReason;
  providerStopReason: JsonValue;
  usage: Usage;
  replay?: ReplayEnvelope;
}

/** Bounded stream collection; even incomplete deltas survive interruption as common content. */
export async function consumeResponse(
  model: ModelClient,
  request: ModelRequest,
  signal: AbortSignal,
  maxBytes: number,
  onText: (text: string) => void,
): Promise<Response> {
  const events: ModelStreamEvent[] = [];
  const complete = new Map<number, ContentPart>();
  const deltas = new Map<number, { kind: string; text: string }>();
  let size = 0;
  const response: Response = {
    parts: [],
    partial: false,
    stopReason: "interrupted",
    providerStopReason: null,
    usage: UNKNOWN_USAGE,
  };
  let iterator: AsyncIterator<ModelStreamEvent> | undefined;
  let finished = false;
  function fail(kind: ModelError["kind"], message: string) {
    response.error = {
      kind,
      message: message.slice(0, 1024),
      partialOutput: response.partial,
      usage: response.usage,
    };
  }
  try {
    // The provider cannot mutate schema/history objects still owned by the execution core.
    iterator = model
      .stream(JSON.parse(canonicalizeJson(request)) as ModelRequest, signal)
      [Symbol.asyncIterator]();
    while (!signal.aborted) {
      const next = await cancellable(iterator.next(), signal);
      if (next === null) break;
      if (next.done) {
        finished = true;
        break;
      }
      const encoded = canonicalizeJson(next.value);
      size += new TextEncoder().encode(encoded).byteLength;
      if (size > maxBytes) {
        fail("protocol", "Model output exceeded byte limit; partial output retained");
        break;
      }
      const event = JSON.parse(encoded) as ModelStreamEvent;
      events.push(event);
      if (event.type === "completed") {
        response.stopReason = event.stopReason;
        response.providerStopReason = event.providerStopReason;
        response.usage = event.usage;
        if (event.replay) response.replay = event.replay;
      } else if (event.type === "error") {
        response.error = event.error;
        response.usage = event.error.usage;
        response.partial ||= event.error.partialOutput;
      } else {
        response.partial = true;
        if (!Number.isSafeInteger(event.index) || event.index < 0) {
          fail("protocol", "Invalid part index");
          break;
        }
        if (event.type === "part_completed") complete.set(event.index, event.part);
        else {
          const kind = event.type === "reasoning_delta" ? `reasoning:${event.kind}` : event.type;
          const text = event.type === "tool_call_delta" ? event.argumentsDelta : event.text;
          if (typeof text !== "string") {
            fail("protocol", "Invalid content delta");
            break;
          }
          const old = deltas.get(event.index);
          deltas.set(event.index, { kind, text: (old?.text ?? "") + text });
          if (event.type === "text_delta") onText(text);
        }
      }
    }
    if (signal.aborted) fail("cancelled", "Model stream cancelled");
    else if (!response.error) {
      const violations = checkModelStream(events);
      if (violations.length) fail("protocol", violations.join("; "));
    }
    // Error streams also need usage/partial-output validation, without discarding their content.
    if (response.error && !signal.aborted) {
      const violations = checkModelStream(events);
      if (violations.length && finished) fail("protocol", violations.join("; "));
    }
  } catch (error) {
    fail(
      signal.aborted ? "cancelled" : "protocol",
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    if (!finished && iterator?.return) {
      // A broken provider cannot block local cancellation by ignoring AbortSignal. Its eventual
      // return is observed, but no subsequent content or tool action is accepted from it.
      try {
        void Promise.resolve(iterator.return()).catch(() => {});
      } catch {
        /* provider bug */
      }
    }
  }
  for (const index of [...new Set([...complete.keys(), ...deltas.keys()])].sort((a, b) => a - b)) {
    const part = complete.get(index),
      delta = deltas.get(index);
    if (part) response.parts.push(part);
    else if (delta) {
      if (delta.kind === "text_delta") response.parts.push({ type: "text", text: delta.text });
      else if (delta.kind === "refusal_delta")
        response.parts.push({ type: "refusal", text: delta.text });
      else if (delta.kind === "reasoning:visible" || delta.kind === "reasoning:summary")
        response.parts.push({
          type: "reasoning",
          kind: delta.kind === "reasoning:visible" ? "visible" : "summary",
          text: delta.text,
        });
      else
        response.parts.push({
          type: "text",
          text: `Incomplete tool arguments (no callable identity, part ${index}): ${delta.text}`,
        });
    }
  }
  if (response.error) {
    response.error = {
      ...response.error,
      partialOutput: response.partial || response.error.partialOutput,
    };
    delete response.replay;
  }
  // Invalid provider usage must not prevent recording the interrupted content itself.
  if (
    checkModelStream([
      {
        type: "error",
        error: {
          kind: "protocol",
          message: "validation",
          partialOutput: false,
          usage: response.usage,
        },
      },
    ]).length
  )
    response.usage = UNKNOWN_USAGE;
  return response;
}

function cancellable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | null> {
  if (signal.aborted) {
    void promise.catch(() => {});
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    const abort = () => {
      cleanup();
      resolve(null);
    };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}
