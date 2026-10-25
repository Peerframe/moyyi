/** Handwritten protocol fixtures, not service recordings or proof of live API acceptance. */
export type FixtureItem =
  | { readonly type: "reasoning"; readonly text: string }
  | { readonly type: "message"; readonly text: string }
  | {
      readonly type: "function_call";
      readonly callId: string;
      readonly name: string;
      readonly arguments: string;
    };

export interface FixtureOptions {
  readonly responseId?: string;
  readonly reportedModel?: string;
  readonly status?: "completed" | "incomplete" | "failed";
  readonly incompleteReason?: string;
  readonly usage?: unknown;
  readonly error?: { readonly code: string; readonly message: string };
}

/** A complete lifecycle, with gaps in sequence numbers and text split across two deltas. */
export function deepSeekFixture(
  items: readonly FixtureItem[],
  options: FixtureOptions = {},
): Record<string, unknown>[] {
  const responseId = options.responseId ?? "fixture_response_1";
  const model = options.reportedModel ?? "deepseek-flash";
  const status = options.status ?? "completed";
  const events: Record<string, unknown>[] = [];
  const output: Record<string, unknown>[] = [];
  let sequence = 0;
  const event = (type: string, fields: Record<string, unknown>) => {
    events.push({ type, sequence_number: sequence, ...JSON.parse(JSON.stringify(fields)) });
    sequence += 2;
  };
  const response = (status: string) => ({ id: responseId, object: "response", model, status });
  event("response.created", { response: { ...response("in_progress"), output: [], usage: null } });
  event("response.in_progress", {
    response: { ...response("in_progress"), output: [], usage: null },
  });
  for (const [index, item] of items.entries()) {
    const id = `${responseId}_item_${index}`;
    const base = { id, type: item.type };
    if (item.type === "function_call") {
      const call = { ...base, call_id: item.callId, name: item.name };
      event("response.output_item.added", {
        output_index: index,
        item: { ...call, status: "in_progress", arguments: "" },
      });
      const split = Math.floor(item.arguments.length / 2);
      for (const delta of [item.arguments.slice(0, split), item.arguments.slice(split)])
        event("response.function_call_arguments.delta", {
          output_index: index,
          item_id: id,
          delta,
        });
      event("response.function_call_arguments.done", {
        output_index: index,
        item_id: id,
        arguments: item.arguments,
      });
      const full = { ...call, status: "completed", arguments: item.arguments };
      output.push(full);
      event("response.output_item.done", { output_index: index, item: full });
    } else {
      const kind = item.type === "reasoning" ? "reasoning_text" : "output_text";
      const envelope = item.type === "message" ? { role: "assistant" } : { summary: [] };
      event("response.output_item.added", {
        output_index: index,
        item: { ...base, ...envelope, status: "in_progress", content: [] },
      });
      const fields = { output_index: index, item_id: id, content_index: 0 };
      event("response.content_part.added", { ...fields, part: { type: kind, text: "" } });
      const characters = [...item.text];
      const split = Math.floor(characters.length / 2);
      for (const delta of [characters.slice(0, split).join(""), characters.slice(split).join("")])
        event(`response.${kind}.delta`, { ...fields, delta });
      event(`response.${kind}.done`, { ...fields, text: item.text });
      const part = { type: kind, text: item.text };
      event("response.content_part.done", { ...fields, part });
      const full = { ...base, ...envelope, status: "completed", content: [part] };
      output.push(full);
      event("response.output_item.done", { output_index: index, item: full });
    }
  }
  event(`response.${status}`, {
    response: {
      ...response(status),
      output,
      usage:
        options.usage === undefined
          ? {
              input_tokens: 20,
              input_tokens_details: { cached_tokens: 4 },
              output_tokens: 8,
              output_tokens_details: { reasoning_tokens: 3 },
              total_tokens: 28,
            }
          : options.usage,
      error:
        status === "failed"
          ? (options.error ?? { code: "server_error", message: "Synthetic failure" })
          : null,
      incomplete_details:
        status === "incomplete"
          ? { reason: options.incompleteReason ?? "max_output_tokens" }
          : null,
    },
  });
  return events;
}

export function deepSeekTextFixture(
  text = "Synthetic answer.",
  options: FixtureOptions = {},
): Record<string, unknown>[] {
  return deepSeekFixture(
    [
      { type: "reasoning", text: "Review the supplied facts." },
      { type: "message", text },
    ],
    options,
  );
}

export function deepSeekToolFixture(
  name = "read",
  args = '{"path":"README.md"}',
  options: FixtureOptions = {},
): Record<string, unknown>[] {
  return deepSeekFixture(
    [
      { type: "reasoning", text: "Inspect the authorized workspace file." },
      { type: "function_call", callId: "fixture_call_1", name, arguments: args },
    ],
    options,
  );
}

/** Frame synthetic events for an injected HTTP transport. No credentials or filesystem I/O. */
export function deepSeekFixtureSse(events: readonly Record<string, unknown>[]): string {
  return events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
}
