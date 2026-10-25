import type { AnthropicTransport } from "./types.ts";

export type AnthropicFixtureBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; signature: string }
  | { type: "redacted_thinking"; data: string }
  | { type: "tool_use"; id: string; name: string; rawArguments: string };

/** Handwritten synthetic SSE, not a recording of a private or live model exchange. */
export function anthropicFixture(
  blocks: readonly AnthropicFixtureBlock[],
  options: {
    responseId?: string;
    model?: string;
    stopReason?: string;
    usage?: Record<string, number> | null;
    stopDetails?: unknown;
  } = {},
): string {
  const events: Record<string, unknown>[] = [
    {
      type: "message_start",
      message: {
        id: options.responseId ?? "msg_synthetic",
        type: "message",
        role: "assistant",
        model: options.model ?? "claude-sonnet-5-5",
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage:
          options.usage === undefined
            ? {
                input_tokens: 12,
                output_tokens: 1,
                cache_read_input_tokens: 3,
                cache_creation_input_tokens: 2,
              }
            : options.usage,
      },
    },
  ];
  blocks.forEach((block, index) => {
    if (block.type === "text") {
      events.push({
        type: "content_block_start",
        index,
        content_block: { type: "text", text: "" },
      });
      events.push({
        type: "content_block_delta",
        index,
        delta: { type: "text_delta", text: block.text },
      });
    } else if (block.type === "thinking") {
      events.push({
        type: "content_block_start",
        index,
        content_block: { type: "thinking", thinking: "" },
      });
      events.push({
        type: "content_block_delta",
        index,
        delta: { type: "thinking_delta", thinking: block.thinking },
      });
      events.push({
        type: "content_block_delta",
        index,
        delta: { type: "signature_delta", signature: block.signature },
      });
    } else if (block.type === "redacted_thinking")
      events.push({ type: "content_block_start", index, content_block: block });
    else {
      events.push({
        type: "content_block_start",
        index,
        content_block: { type: "tool_use", id: block.id, name: block.name, input: {} },
      });
      const split = Math.floor(block.rawArguments.length / 2);
      for (const partial_json of [
        block.rawArguments.slice(0, split),
        block.rawArguments.slice(split),
      ])
        events.push({
          type: "content_block_delta",
          index,
          delta: { type: "input_json_delta", partial_json },
        });
    }
    events.push({ type: "content_block_stop", index });
  });
  events.push({
    type: "message_delta",
    delta: {
      stop_reason:
        options.stopReason ??
        (blocks.some((block) => block.type === "tool_use") ? "tool_use" : "end_turn"),
      stop_sequence: null,
      ...(options.stopDetails === undefined ? {} : { stop_details: options.stopDetails }),
    },
    usage: options.usage === null ? null : { output_tokens: 7 },
  });
  events.push({ type: "message_stop" });
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
}

export function anthropicFixtureTransport(
  streams: readonly string[],
  chunkSize = 31,
): {
  transport: AnthropicTransport;
  requests: Record<string, unknown>[];
  closed: () => number;
} {
  const requests: Record<string, unknown>[] = [];
  let closed = 0;
  return {
    requests,
    closed: () => closed,
    transport: async (body, signal) => {
      requests.push(JSON.parse(body));
      const raw = streams[requests.length - 1];
      if (raw === undefined) throw Error("Synthetic script exhausted");
      return {
        status: 200,
        contentType: "text/event-stream",
        retryAfter: null,
        body: (async function* () {
          const bytes = new TextEncoder().encode(raw);
          for (let i = 0; i < bytes.length; i += chunkSize) {
            if (signal.aborted) return;
            yield bytes.slice(i, i + chunkSize);
          }
        })(),
        async close() {
          closed++;
        },
      };
    },
  };
}
