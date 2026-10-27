import type { KimiTransport } from "./types.ts";

/** Synthetic protocol data only; no service responses, secrets, or filesystem access. */
export interface KimiFixtureOptions {
  readonly text?: string;
  readonly reasoning?: string;
  readonly refusal?: string;
  readonly calls?: readonly {
    readonly id: string;
    readonly name: string;
    readonly arguments: string;
  }[];
  readonly finishReason?: string;
  readonly usage?: unknown;
  readonly responseId?: string;
  readonly model?: string;
}

export function kimiFixture(options: KimiFixtureOptions = {}): string {
  const events: Record<string, unknown>[] = [];
  const envelope = {
    id: options.responseId ?? "fixture_response_1",
    object: "chat.completion.chunk",
    created: 1,
    model: options.model ?? "kimi-k3.1-pro",
  };
  const event = (
    delta: Record<string, unknown>,
    finish_reason: string | null = null,
    usage?: unknown,
  ) => {
    events.push({
      ...envelope,
      choices: [{ index: 0, delta, finish_reason, ...(usage === undefined ? {} : { usage }) }],
    });
  };
  event({ role: "assistant", content: "" });
  for (const [field, value] of [
    ["reasoning_content", options.reasoning],
    ["content", options.text],
    ["refusal", options.refusal],
  ] as const) {
    if (value === undefined) continue;
    const chars = [...value],
      at = Math.floor(chars.length / 2);
    event({ [field]: chars.slice(0, at).join("") });
    event({ [field]: chars.slice(at).join("") });
  }
  for (const [index, call] of (options.calls ?? []).entries()) {
    event({
      tool_calls: [
        { index, id: call.id, type: "function", function: { name: call.name, arguments: "" } },
      ],
    });
    const at = Math.floor(call.arguments.length / 2);
    for (const part of [call.arguments.slice(0, at), call.arguments.slice(at)])
      event({ tool_calls: [{ index, function: { arguments: part } }] });
  }
  const usage =
    options.usage === undefined
      ? {
          prompt_tokens: 20,
          completion_tokens: 8,
          total_tokens: 28,
          prompt_tokens_details: { cached_tokens: 3, cache_write_tokens: 2 },
          completion_tokens_details: { reasoning_tokens: 4 },
        }
      : options.usage;
  event({}, options.finishReason ?? (options.calls?.length ? "tool_calls" : "stop"), usage);
  events.push({ ...envelope, choices: [], usage });
  return `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}data: [DONE]\n\n`;
}

export function kimiFixtureTransport(streams: readonly string[]): {
  readonly transport: KimiTransport;
  readonly requests: Record<string, unknown>[];
  readonly rawRequests: string[];
} {
  const requests: Record<string, unknown>[] = [],
    rawRequests: string[] = [];
  let next = 0;
  const transport: KimiTransport = async (body) => {
    rawRequests.push(body);
    requests.push(JSON.parse(body) as Record<string, unknown>);
    const stream = streams[next++];
    if (stream === undefined) throw Error("Synthetic Kimi stream exhausted");
    return {
      status: 200,
      contentType: "text/event-stream",
      retryAfter: null,
      async close() {},
      body: {
        async *[Symbol.asyncIterator]() {
          yield new TextEncoder().encode(stream);
        },
      },
    };
  };
  return { transport, requests, rawRequests };
}
