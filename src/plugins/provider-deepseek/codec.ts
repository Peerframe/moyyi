import {
  type ContentPart,
  canonicalizeJson,
  checkUsage,
  type ModelErrorKind,
  type ModelProfile,
  type ModelRequest,
  type ModelStreamEvent,
  type ToolCallId,
  UNKNOWN_USAGE,
  type Usage,
} from "../../contracts/index.ts";

export const DEEPSEEK_API_PROFILE = "deepseek-responses-text-v1-2026-10-25";
export const deepSeekProfile: ModelProfile = {
  origin: { provider: "deepseek", model: "deepseek-flash" },
  contextWindowTokens: 1_000_000,
  maxOutputTokens: 8192,
  parallelToolCalls: true,
  reasoning: "visible",
  promptCache: "automatic",
  editFormat: "search_replace",
};
const encoder = new TextEncoder();
const MAX_ITEMS = 1024;
const MAX_PARTS = 1024;
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_AUXILIARY_REASONING_BYTES = 64 * 1024;
type ObjectValue = Record<string, unknown>;

/** Render only the documented text/function subset. Replay payloads have no authority here. */
export function buildDeepSeekRequest(request: ModelRequest): Record<string, unknown> {
  const value = JSON.parse(canonicalizeJson(request)) as ModelRequest;
  keys(object(value), ["origin", "system", "messages", "tools", "maxOutputTokens"]);
  keys(object(value.origin), ["provider", "model"]);
  requireCondition(
    value.origin.provider === "deepseek" && value.origin.model === "deepseek-flash",
    "Unsupported model origin",
  );
  requireCondition(
    Number.isSafeInteger(value.maxOutputTokens) &&
      value.maxOutputTokens > 0 &&
      value.maxOutputTokens <= deepSeekProfile.maxOutputTokens,
    "Invalid output token limit",
  );
  const instructions = value.system.map((part) => textPart(part)).join("\n\n");
  const names = new Set<string>();
  const tools = value.tools.map((tool) => {
    keys(object(tool), ["name", "description", "inputSchema"]);
    name(tool.name);
    requireCondition(!names.has(tool.name), "Duplicate tool name");
    names.add(tool.name);
    requireCondition(typeof tool.description === "string", "Invalid tool description");
    object(tool.inputSchema);
    return {
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    };
  });
  const input: ObjectValue[] = [];
  const pending = new Map<string, string>();
  const localIds = new Set<string>();
  const providerIds = new Set<string>();
  for (const message of value.messages) {
    keys(object(message), ["role", "content", "replay", "stopReason"]);
    requireCondition(message.role === "user" || message.role === "assistant", "Unsupported role");
    requireCondition(message.content.length > 0, "Empty history message");
    if (message.role === "assistant") {
      requireCondition(pending.size === 0, "Tool results must precede the next assistant");
      const complete = message.stopReason === "end_turn" || message.stopReason === "tool_use";
      requireCondition(
        tools.length ? complete : message.stopReason === undefined || complete,
        "Interrupted or unproven assistant history cannot be continued",
      );
      if (tools.length)
        requireCondition(
          message.content.some(
            (part) => part.type === "reasoning" && part.kind === "visible" && part.text.length > 0,
          ),
          "Complete visible reasoning is required for tool-enabled history",
        );
      const hasCall = message.content.some((part) => part.type === "tool_call");
      requireCondition(
        (message.stopReason !== "tool_use" || hasCall) &&
          (message.stopReason !== "end_turn" || !hasCall),
        "Assistant stop reason does not match its calls",
      );
    }
    for (const part of message.content) {
      if (part.type === "text") {
        keys(object(part), ["type", "text"]);
        input.push({
          type: "message",
          role: message.role,
          content: [
            {
              type: message.role === "user" ? "input_text" : "output_text",
              text: string(part.text),
            },
          ],
        });
      } else if (part.type === "reasoning" && message.role === "assistant") {
        keys(object(part), ["type", "kind", "text"]);
        requireCondition(part.kind === "visible", "Only full visible reasoning is supported");
        input.push({
          type: "reasoning",
          content: [{ type: "reasoning_text", text: string(part.text) }],
        });
      } else if (part.type === "tool_call" && message.role === "assistant") {
        keys(object(part), [
          "type",
          "callId",
          "providerCallId",
          "providerItemId",
          "name",
          "rawArguments",
          "argumentsSource",
        ]);
        const providerId = identifier(part.providerCallId);
        requireCondition(
          typeof part.callId === "string" && part.callId.length > 0 && part.callId.length <= 512,
          "Invalid local call ID",
        );
        if (part.providerItemId !== null) identifier(part.providerItemId);
        requireCondition(
          !localIds.has(part.callId) && !providerIds.has(providerId),
          "Duplicate call ID",
        );
        requireCondition(
          part.argumentsSource === "verbatim" || part.argumentsSource === "json_serialized",
          "Invalid argument source",
        );
        requireCondition(typeof part.rawArguments === "string", "Invalid raw arguments");
        name(part.name);
        localIds.add(part.callId);
        providerIds.add(providerId);
        pending.set(part.callId, providerId);
        input.push({
          type: "function_call",
          call_id: providerId,
          name: part.name,
          arguments: part.rawArguments,
        });
      } else if (part.type === "tool_result" && message.role === "user") {
        keys(object(part), ["type", "callId", "status", "content"]);
        const callId = pending.get(part.callId);
        requireCondition(callId !== undefined, "Unpaired or duplicate tool result");
        requireCondition(
          ["succeeded", "failed", "denied", "cancelled", "unknown"].includes(part.status),
          "Invalid result status",
        );
        input.push({
          type: "function_call_output",
          call_id: callId,
          output: canonicalizeJson({
            status: part.status,
            content: part.content.map((part) => textPart(part)),
          }),
        });
        pending.delete(part.callId);
      } else throw new CodecError("Unsupported history content or role");
    }
  }
  requireCondition(pending.size === 0, "Every tool call needs a result");
  requireCondition(input.length > 0 || instructions.length > 0, "Empty model request");
  const body = {
    model: "deepseek-flash",
    stream: true,
    reasoning: { effort: "high" },
    max_output_tokens: value.maxOutputTokens,
    ...(instructions ? { instructions } : {}),
    input,
    ...(tools.length ? { tools, tool_choice: "auto" } : {}),
  };
  requireCondition(
    encoder.encode(canonicalizeJson(body)).byteLength <= MAX_BYTES,
    "Model request exceeds byte limit",
  );
  return body;
}

type PartState = {
  kind: "output_text" | "reasoning_text";
  announced: boolean;
  text: string;
  deltas: boolean;
  textDone: boolean;
  done: boolean;
};
type ItemState = {
  id: string;
  kind: "message" | "reasoning" | "function_call";
  parts: Map<number, PartState>;
  callId?: string;
  name?: string;
  arguments: string;
  argumentsDeltas: boolean;
  argumentsDone: boolean;
  sawAuxiliaryReasoning: boolean;
  done?: ObjectValue;
};

/** Strict semantic assembly after bounded SSE/JSON framing; never executes tools or retries. */
export async function* decodeDeepSeekEvents(
  events: AsyncIterable<unknown>,
  signal: AbortSignal,
): AsyncIterable<ModelStreamEvent> {
  let sequence = -1;
  let responseId: string | undefined;
  let reportedModel: string | undefined;
  let partial = false;
  let bytes = 0;
  let usage: Usage = UNKNOWN_USAGE;
  let terminalSent = false;
  const items = new Map<number, ItemState>();
  const itemIds = new Set<string>();
  const callIds = new Set<string>();
  const active = () => {
    if (signal.aborted) throw new CodecError("Model request cancelled", "cancelled");
  };
  const partIndex = (output: number, content = 0) => output * MAX_PARTS + content;
  const findItem = (event: ObjectValue): [number, ItemState] => {
    const index = integer(event.output_index, MAX_ITEMS);
    const item = items.get(index);
    requireCondition(item !== undefined && !item.done, "Unknown or completed output item");
    requireCondition(event.item_id === item.id, "Output item ID changed");
    return [index, item];
  };
  const finishPart = (output: number, index: number, state: PartState): ModelStreamEvent => {
    requireCondition(!state.done, "Content part completed twice");
    state.done = true;
    partial = true;
    const part: ContentPart =
      state.kind === "output_text"
        ? { type: "text", text: state.text }
        : { type: "reasoning", kind: "visible", text: state.text };
    return { type: "part_completed", index: partIndex(output, index), part };
  };
  const response = (raw: unknown): ObjectValue => {
    const value = object(raw);
    requireCondition(value.object === "response", "Invalid response object");
    const id = identifier(value.id);
    const model = identifier(value.model);
    requireCondition(responseId === undefined || responseId === id, "Response ID changed");
    requireCondition(
      reportedModel === undefined || reportedModel === model,
      "Reported model changed",
    );
    responseId = id;
    reportedModel = model;
    return value;
  };
  const requireVisibleReasoning = (item: ItemState, raw: unknown, full: ObjectValue): void => {
    if (item.kind !== "reasoning") return;
    item.sawAuxiliaryReasoning ||= auxiliaryReasoning(object(raw));
    // Added metadata may disappear before completion. It never substitutes for the full
    // visible reasoning this stateless input profile needs, or authorizes a tool call.
    if (item.sawAuxiliaryReasoning)
      requireCondition(
        array(full.content).some((part) => string(object(part).text).trim().length > 0),
        "Auxiliary reasoning metadata requires visible reasoning content",
      );
  };
  const completeItem = (output: number, raw: unknown): ModelStreamEvent[] => {
    const item = items.get(output);
    requireCondition(item !== undefined && !item.done, "Unknown or completed output item");
    const value = normalizeItem(raw);
    requireCondition(
      value.id === item.id && value.type === item.kind,
      "Output item identity changed",
    );
    requireCondition(
      value.status === "completed" || value.status === "incomplete",
      "Item is not final",
    );
    requireVisibleReasoning(item, raw, value);
    const result: ModelStreamEvent[] = [];
    if (item.kind === "function_call") {
      requireCondition(
        value.call_id === item.callId && value.name === item.name,
        "Function identity changed",
      );
      const args = string(value.arguments);
      requireCondition(
        !item.argumentsDeltas || item.arguments === args,
        "Function arguments changed at completion",
      );
      requireCondition(!item.argumentsDone || item.arguments === args, "Final arguments changed");
      item.arguments = args;
      partial = true;
      result.push({
        type: "part_completed",
        index: partIndex(output),
        part: {
          type: "tool_call",
          callId: `deepseek:${JSON.stringify([responseId, item.callId])}` as ToolCallId,
          providerCallId: item.callId as string,
          providerItemId: item.id,
          name: item.name as string,
          rawArguments: args,
          argumentsSource: "verbatim",
        },
      });
    } else {
      const parts = array(value.content);
      requireCondition(
        parts.length <= MAX_PARTS && parts.length > 0,
        "Invalid final content count",
      );
      requireCondition(
        [...item.parts.keys()].every((index) => index < parts.length),
        "Final item lost content",
      );
      for (const [index, rawPart] of parts.entries()) {
        const full = normalizePart(rawPart, item.kind);
        let state = item.parts.get(index);
        if (!state) {
          state = {
            kind: full.type as PartState["kind"],
            announced: false,
            text: string(full.text),
            deltas: false,
            textDone: true,
            done: false,
          };
          item.parts.set(index, state);
        } else {
          requireCondition(state.kind === full.type, "Content kind changed");
          requireCondition(
            !(state.deltas || state.textDone || state.done) || state.text === full.text,
            "Final text differs from stream",
          );
          state.text = string(full.text);
        }
        if (!state.done) result.push(finishPart(output, index, state));
      }
    }
    item.done = value;
    return result;
  };
  try {
    active();
    for await (const raw of cancellableEvents(events, signal)) {
      active();
      let encoded: string;
      try {
        encoded = canonicalizeJson(raw);
      } catch {
        throw new CodecError("Event is not valid JSON data");
      }
      bytes += encoder.encode(encoded).byteLength;
      requireCondition(bytes <= MAX_BYTES, "Response exceeds semantic byte limit");
      const event = object(JSON.parse(encoded));
      const seq = integer(event.sequence_number);
      requireCondition(seq > sequence, "Event sequence must increase");
      sequence = seq;
      const type = string(event.type);
      if (responseId === undefined)
        requireCondition(type === "response.created", "Missing response.created");
      if (type === "response.created" || type === "response.in_progress") {
        requireCondition(
          type !== "response.created" || responseId === undefined,
          "Duplicate response.created",
        );
        const value = response(event.response);
        requireCondition(value.status === "in_progress", "Invalid response progress status");
        if (value.usage !== undefined && value.usage !== null)
          usage = normalizeUsage(value.usage, false);
      } else if (type === "response.output_item.added") {
        const output = integer(event.output_index, MAX_ITEMS);
        requireCondition(output === items.size, "Output items must be added in index order");
        const value = normalizeItem(event.item);
        const id = identifier(value.id);
        requireCondition(!itemIds.has(id), "Duplicate item ID");
        itemIds.add(id);
        requireCondition(value.status === "in_progress", "Invalid added item status");
        const kind = value.type as ItemState["kind"];
        const item: ItemState = {
          id,
          kind,
          parts: new Map(),
          arguments: "",
          argumentsDeltas: false,
          argumentsDone: false,
          sawAuxiliaryReasoning: kind === "reasoning" && auxiliaryReasoning(object(event.item)),
        };
        if (kind === "function_call") {
          item.callId = identifier(value.call_id);
          item.name = name(value.name);
          requireCondition(!callIds.has(item.callId), "Duplicate provider call ID");
          callIds.add(item.callId);
          requireCondition(value.arguments === "", "Added call has premature arguments");
        } else requireCondition(array(value.content).length === 0, "Added item must start empty");
        items.set(output, item);
      } else if (type === "response.output_item.done") {
        for (const emitted of completeItem(integer(event.output_index, MAX_ITEMS), event.item)) {
          active();
          yield emitted;
        }
      } else if (
        type === "response.function_call_arguments.delta" ||
        type === "response.function_call_arguments.done"
      ) {
        const [output, item] = findItem(event);
        requireCondition(
          item.kind === "function_call" && !item.argumentsDone,
          "Invalid function argument event",
        );
        if (type.endsWith(".delta")) {
          const delta = string(event.delta);
          item.arguments += delta;
          item.argumentsDeltas = true;
          partial = true;
          yield { type: "tool_call_delta", index: partIndex(output), argumentsDelta: delta };
        } else {
          const args = string(event.arguments);
          requireCondition(
            !item.argumentsDeltas || args === item.arguments,
            "Final arguments differ from deltas",
          );
          item.arguments = args;
          item.argumentsDone = true;
        }
      } else if (
        [
          "response.content_part.added",
          "response.content_part.done",
          "response.output_text.delta",
          "response.output_text.done",
          "response.reasoning_text.delta",
          "response.reasoning_text.done",
        ].includes(type)
      ) {
        const [output, item] = findItem(event);
        requireCondition(item.kind !== "function_call", "Content on a function item");
        const index = integer(event.content_index, MAX_PARTS);
        const kind = item.kind === "reasoning" ? "reasoning_text" : "output_text";
        let state = item.parts.get(index);
        if (!state) {
          requireCondition(index === item.parts.size, "Content parts must start in index order");
          state = { kind, announced: false, text: "", deltas: false, textDone: false, done: false };
          item.parts.set(index, state);
        }
        requireCondition(!state.done, "Event after content completion");
        if (type.startsWith("response.content_part.")) {
          const part = normalizePart(event.part, item.kind);
          if (type.endsWith(".added")) {
            requireCondition(
              !state.announced &&
                !state.deltas &&
                !state.textDone &&
                state.text === "" &&
                part.text === "",
              "Invalid content start",
            );
            state.announced = true;
          } else {
            requireCondition(
              !(state.deltas || state.textDone) || state.text === part.text,
              "Completed content differs from stream",
            );
            state.text = string(part.text);
            state.textDone = true;
            yield finishPart(output, index, state);
          }
        } else {
          requireCondition(type.startsWith(`response.${kind}.`), "Delta kind does not match item");
          requireCondition(!state.textDone, "Event after text done");
          emptyOptionalArray(event.logprobs, "Log probabilities are unsupported");
          if (type.endsWith(".delta")) {
            const delta = string(event.delta);
            state.text += delta;
            state.deltas = true;
            partial = true;
            yield kind === "reasoning_text"
              ? {
                  type: "reasoning_delta",
                  index: partIndex(output, index),
                  kind: "visible",
                  text: delta,
                }
              : { type: "text_delta", index: partIndex(output, index), text: delta };
          } else {
            const text = string(event.text);
            requireCondition(!state.deltas || text === state.text, "Done text differs from deltas");
            state.text = text;
            state.textDone = true;
          }
        }
      } else if (
        type === "response.completed" ||
        type === "response.incomplete" ||
        type === "response.failed"
      ) {
        const value = response(event.response);
        const status = type.slice("response.".length);
        requireCondition(value.status === status, "Terminal status mismatch");
        usage = normalizeUsage(value.usage, status !== "failed");
        const output = array(value.output);
        requireCondition(output.length === items.size, "Terminal output count changed");
        for (const [index, rawItem] of output.entries()) {
          const item = items.get(index);
          requireCondition(item !== undefined, "Unknown terminal item");
          const full = normalizeItem(rawItem);
          if (status !== "failed") requireVisibleReasoning(item, rawItem, full);
          if (item.done)
            requireCondition(
              canonicalizeJson(full) === canonicalizeJson(item.done),
              "Terminal output changed a completed item",
            );
          else if (status !== "failed") {
            for (const event of completeItem(index, rawItem)) {
              active();
              yield event;
            }
          } else
            requireCondition(
              full.id === item.id && full.type === item.kind,
              "Failed output identity changed",
            );
          if (status === "completed")
            requireCondition(
              full.status === "completed",
              "Successful response contains incomplete item",
            );
        }
        if (status === "failed") {
          const failure = object(value.error);
          string(failure.code);
          string(failure.message);
          throw new CodecError("DeepSeek reported response failure", failureKind(failure.code));
        }
        requireCondition(
          value.error === undefined || value.error === null,
          "Successful response contains error",
        );
        let reason: "end_turn" | "tool_use" | "max_tokens" | "refusal";
        let incomplete: string | null = null;
        if (status === "incomplete") {
          incomplete = string(object(value.incomplete_details).reason);
          requireCondition(
            incomplete === "max_output_tokens" || incomplete === "content_filter",
            "Unsupported incomplete reason",
          );
          reason = incomplete === "max_output_tokens" ? "max_tokens" : "refusal";
        } else {
          requireCondition(
            value.incomplete_details === undefined || value.incomplete_details === null,
            "Completed response is marked incomplete",
          );
          reason = callIds.size ? "tool_use" : "end_turn";
        }
        active();
        terminalSent = true;
        yield {
          type: "completed",
          stopReason: reason,
          providerStopReason: {
            status,
            incompleteReason: incomplete,
            model: reportedModel as string,
            responseId: responseId as string,
          },
          usage,
        };
        return;
      } else throw new CodecError("Unsupported DeepSeek stream event");
    }
    active();
    throw new CodecError("DeepSeek stream ended without a terminal event", "stream_interrupted");
  } catch (error) {
    // Closing an exhausted transport cannot retroactively add a second terminal outcome.
    if (terminalSent) return;
    const kind = signal.aborted ? "cancelled" : externalKind(error);
    const retryAfterMs = retryAfter(error);
    yield {
      type: "error",
      error: {
        kind,
        message: signal.aborted
          ? "Model request cancelled"
          : error instanceof CodecError
            ? error.message
            : "DeepSeek transport or stream failed",
        partialOutput: partial,
        usage,
        ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      },
    };
  }
}

async function* cancellableEvents(
  events: AsyncIterable<unknown>,
  signal: AbortSignal,
): AsyncIterable<unknown> {
  const iterator = events[Symbol.asyncIterator]();
  let exhausted = false;
  try {
    for (;;) {
      if (signal.aborted) throw new CodecError("Model request cancelled", "cancelled");
      let abort = () => {};
      const cancelled = new Promise<never>((_, reject) => {
        abort = () => reject(new CodecError("Model request cancelled", "cancelled"));
        signal.addEventListener("abort", abort, { once: true });
      });
      let next: IteratorResult<unknown>;
      try {
        next = await Promise.race([Promise.resolve().then(() => iterator.next()), cancelled]);
      } finally {
        signal.removeEventListener("abort", abort);
      }
      if (next.done) {
        exhausted = true;
        return;
      }
      yield next.value;
    }
  } finally {
    if (!exhausted && iterator.return) {
      const closing = Promise.resolve().then(() => iterator.return?.());
      // An async generator's return waits behind a pending next. Abort must not wait for it;
      // the transport also receives this signal and owns aborting its physical connection.
      if (signal.aborted) void closing.catch(() => {});
      else await closing;
    }
  }
}

function normalizeItem(raw: unknown): ObjectValue {
  const value = object(raw);
  const type = string(value.type);
  requireCondition(
    ["message", "reasoning", "function_call"].includes(type),
    "Unsupported output item",
  );
  const id = identifier(value.id);
  const status = string(value.status);
  requireCondition(
    ["in_progress", "completed", "incomplete"].includes(status),
    "Invalid item status",
  );
  if (type === "function_call")
    return {
      type,
      id,
      status,
      call_id: identifier(value.call_id),
      name: name(value.name),
      arguments: string(value.arguments),
    };
  if (type === "message") {
    requireCondition(value.role === "assistant", "Invalid output role");
    // This output annotation does not complete the response or authorize tools. Normalize
    // final-answer text to the existing stateless history; commentary remains unsupported.
    requireCondition(
      value.phase === undefined || value.phase === null || value.phase === "final_answer",
      "Unsupported assistant phase",
    );
  } else {
    emptyOptionalArray(value.summary, "Reasoning summaries are unsupported");
    // DeepSeek can attach opaque output metadata to a visible reasoning stream. The
    // documented input profile uses plaintext only; validate and discard this field.
    // Its value can change across added/done, so it is not part of content equality.
    auxiliaryReasoning(value);
  }
  const content = array(value.content);
  requireCondition(content.length <= MAX_PARTS, "Too many content parts");
  return {
    type,
    id,
    status,
    ...(type === "message" ? { role: "assistant" } : {}),
    content: content.map((part) => normalizePart(part, type)),
  };
}
function auxiliaryReasoning(value: ObjectValue): boolean {
  if (value.encrypted_content === undefined || value.encrypted_content === null) return false;
  const text = string(value.encrypted_content);
  requireCondition(
    encoder.encode(text).byteLength <= MAX_AUXILIARY_REASONING_BYTES,
    "Auxiliary reasoning metadata exceeds byte limit",
  );
  return text.length > 0;
}
function normalizePart(raw: unknown, itemKind: string): ObjectValue {
  const value = object(raw);
  const expected = itemKind === "reasoning" ? "reasoning_text" : "output_text";
  requireCondition(value.type === expected, "Unsupported content part");
  emptyOptionalArray(value.annotations, "Annotations are unsupported");
  emptyOptionalArray(value.logprobs, "Log probabilities are unsupported");
  return { type: expected, text: string(value.text) };
}
function normalizeUsage(raw: unknown, final: boolean): Usage {
  if (raw === null || raw === undefined) return UNKNOWN_USAGE;
  const value = object(raw);
  const count = (raw: unknown): number | null =>
    raw === undefined || raw === null ? null : integer(raw);
  const details = (raw: unknown): ObjectValue =>
    raw === undefined || raw === null ? {} : object(raw);
  const inputTokens = count(value.input_tokens);
  const outputTokens = count(value.output_tokens);
  const total = count(value.total_tokens);
  requireCondition(
    total === null ||
      inputTokens === null ||
      outputTokens === null ||
      total === inputTokens + outputTokens,
    "Inconsistent total token count",
  );
  const counters = {
    inputTokens,
    outputTokens,
    cacheReadTokens: count(details(value.input_tokens_details).cached_tokens),
    cacheWriteTokens: null,
    reasoningTokens: count(details(value.output_tokens_details).reasoning_tokens),
  };
  const known = Object.values(counters).some((value) => value !== null);
  const usage: Usage = { status: known ? (final ? "final" : "partial") : "unknown", ...counters };
  requireCondition(checkUsage(usage).length === 0, "Invalid usage counters");
  return usage;
}
class CodecError extends Error {
  readonly kind: ModelErrorKind;
  constructor(message: string, kind: ModelErrorKind = "protocol") {
    super(message);
    this.kind = kind;
  }
}
function requireCondition(value: unknown, message: string): asserts value {
  if (!value) throw new CodecError(message);
}
function object(value: unknown): ObjectValue {
  requireCondition(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "Expected an object",
  );
  return value as ObjectValue;
}
function array(value: unknown): unknown[] {
  requireCondition(Array.isArray(value), "Expected an array");
  return value;
}
function string(value: unknown): string {
  requireCondition(typeof value === "string" && value.isWellFormed(), "Expected valid text");
  return value;
}
function identifier(value: unknown): string {
  const text = string(value);
  requireCondition(/^[A-Za-z0-9_.:-]{1,200}$/.test(text), "Invalid or oversized identifier");
  return text;
}
function name(value: unknown): string {
  const text = string(value);
  requireCondition(/^[A-Za-z0-9_-]{1,128}$/.test(text), "Invalid function name");
  return text;
}
function integer(value: unknown, exclusiveMaximum = Number.MAX_SAFE_INTEGER): number {
  requireCondition(
    typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value < exclusiveMaximum,
    "Invalid nonnegative integer",
  );
  return value;
}
function textPart(part: ContentPart): string {
  requireCondition(part.type === "text", "Only text is supported in this position");
  keys(object(part), ["type", "text"]);
  return string(part.text);
}
function keys(value: ObjectValue, allowed: readonly string[]): void {
  requireCondition(
    Object.keys(value).every((key) => allowed.includes(key)),
    "Unsupported request field",
  );
}
function emptyOptionalArray(value: unknown, message: string): void {
  requireCondition(value === undefined || (Array.isArray(value) && value.length === 0), message);
}
function failureKind(code: unknown): ModelErrorKind {
  if (code === "rate_limit_exceeded") return "rate_limited";
  if (code === "server_error" || code === "server_overloaded") return "overloaded";
  if (code === "invalid_api_key") return "auth";
  if (code === "context_length_exceeded") return "context_overflow";
  return "invalid_request";
}
function externalKind(error: unknown): ModelErrorKind {
  if (error instanceof CodecError) return error.kind;
  const kinds = [
    "rate_limited",
    "overloaded",
    "auth",
    "invalid_request",
    "context_overflow",
    "network",
    "stream_interrupted",
    "protocol",
    "cancelled",
  ];
  return error &&
    typeof error === "object" &&
    "kind" in error &&
    kinds.includes(error.kind as string)
    ? (error.kind as ModelErrorKind)
    : "network";
}
function retryAfter(error: unknown): number | undefined {
  if (!error || typeof error !== "object" || !("retryAfterMs" in error)) return undefined;
  const value = error.retryAfterMs;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}
