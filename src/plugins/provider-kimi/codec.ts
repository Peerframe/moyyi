import {
  type ContentPart,
  canonicalizeJson,
  checkUsage,
  type ModelErrorKind,
  type ModelProfile,
  type ModelRequest,
  type ModelStreamEvent,
  type StopReason,
  type ToolCallId,
  UNKNOWN_USAGE,
  type Usage,
} from "../../contracts/index.ts";
import { type KimiOptions, resolveKimiReasoningEffort } from "./options.ts";

export { KIMI_API_PROFILE } from "./options.ts";
export const kimiProfile: ModelProfile = {
  origin: { provider: "kimi", model: "kimi-k3.1-pro" },
  contextWindowTokens: 1_048_576,
  maxOutputTokens: 8192,
  parallelToolCalls: true,
  reasoning: "visible",
  promptCache: "automatic",
  editFormat: "search_replace",
};

type ObjectValue = Record<string, unknown>;
const encoder = new TextEncoder();
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_CALLS = 1024;

/** K3.1 Preserved Thinking requires complete visible reasoning beside every assistant turn. */
export function buildKimiRequest(request: ModelRequest, options: KimiOptions = {}): ObjectValue {
  const effort = resolveKimiReasoningEffort(options.reasoningEffort);
  const value = JSON.parse(canonicalizeJson(request)) as ModelRequest;
  keys(object(value), ["origin", "system", "messages", "tools", "maxOutputTokens", "toolChoice"]);
  keys(object(value.origin), ["provider", "model"]);
  requireCondition(
    value.origin.provider === "kimi" && value.origin.model === "kimi-k3.1-pro",
    "Unsupported model origin",
  );
  requireCondition(
    Number.isSafeInteger(value.maxOutputTokens) &&
      value.maxOutputTokens > 0 &&
      value.maxOutputTokens <= kimiProfile.maxOutputTokens,
    "Invalid output token limit",
  );
  requireCondition(
    value.toolChoice === undefined || value.toolChoice === "none",
    "Unsupported tool choice",
  );
  const instructions = value.system.map(textPart).join("\n\n");
  const toolNames = new Set<string>();
  const tools = value.tools.map((tool) => {
    keys(object(tool), ["name", "description", "inputSchema"]);
    name(tool.name);
    requireCondition(!toolNames.has(tool.name), "Duplicate tool name");
    toolNames.add(tool.name);
    string(tool.description);
    object(tool.inputSchema);
    return {
      type: "function",
      function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
    };
  });
  const messages: ObjectValue[] = instructions ? [{ role: "system", content: instructions }] : [];
  const pending = new Map<string, string>();
  const localIds = new Set<string>();
  for (const message of value.messages) {
    keys(object(message), ["role", "origin", "content", "replay", "stopReason"]);
    requireCondition(message.role === "user" || message.role === "assistant", "Unsupported role");
    if (message.origin !== undefined) {
      requireCondition(message.role === "assistant", "Only assistant history has model origin");
      keys(object(message.origin), ["provider", "model"]);
      requireCondition(
        string(message.origin.provider).length > 0 && string(message.origin.model).length > 0,
        "Invalid historical model origin",
      );
    }
    const foreign = message.origin !== undefined && message.origin.provider !== "kimi";
    requireCondition(
      Array.isArray(message.content) && message.content.length > 0,
      "Empty history message",
    );
    if (message.role === "assistant") {
      requireCondition(pending.size === 0, "Tool results must precede the next assistant");
      requireCondition(
        message.stopReason === "end_turn" ||
          message.stopReason === "tool_use" ||
          message.stopReason === "refusal",
        "Interrupted or unproven assistant history cannot be continued",
      );
      const text: string[] = [];
      let reasoning = "";
      let sawText = false,
        sawReasoning = false,
        sawRefusal = false;
      const calls: ObjectValue[] = [];
      const providerIds = new Set<string>();
      for (const part of message.content) {
        if (part.type === "text" || part.type === "refusal") {
          keys(object(part), ["type", "text"]);
          // Chat has no documented refusal input field; preserve its text in assistant content.
          text.push(string(part.text));
          sawText = true;
          sawRefusal ||= part.type === "refusal";
        } else if (part.type === "reasoning") {
          if (foreign) {
            keys(
              object(part),
              part.kind === "opaque" ? ["type", "kind"] : ["type", "kind", "text"],
            );
            requireCondition(
              ["visible", "summary", "opaque"].includes(part.kind),
              "Invalid reasoning kind",
            );
            if (part.kind !== "opaque") string(part.text);
            continue;
          }
          keys(object(part), ["type", "kind", "text"]);
          requireCondition(part.kind === "visible", "Only full visible reasoning is supported");
          reasoning += string(part.text);
          sawReasoning = true;
        } else if (part.type === "tool_call") {
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
          if (foreign && part.providerItemId !== null) identifier(part.providerItemId);
          else requireCondition(part.providerItemId === null, "Unsupported function item ID");
          requireCondition(
            !localIds.has(part.callId) && !providerIds.has(providerId),
            "Duplicate call ID",
          );
          requireCondition(
            part.argumentsSource === "verbatim" || part.argumentsSource === "json_serialized",
            "Invalid argument source",
          );
          name(part.name);
          string(part.rawArguments);
          localIds.add(part.callId);
          providerIds.add(providerId);
          pending.set(part.callId, providerId);
          calls.push({
            id: providerId,
            type: "function",
            function: { name: part.name, arguments: part.rawArguments },
          });
        } else throw new CodecError("Unsupported assistant content");
      }
      requireCondition(
        (message.stopReason === "tool_use") === calls.length > 0,
        "Assistant stop reason does not match its calls",
      );
      requireCondition(
        !sawRefusal || message.stopReason === "refusal",
        "Refusal requires a refusal outcome",
      );
      requireCondition(!calls.length || !sawRefusal, "Refused response cannot contain calls");
      if (foreign)
        requireCondition(
          sawText || calls.length > 0,
          "Foreign assistant history has no transferable content",
        );
      messages.push({
        role: "assistant",
        content: sawText ? text.join("\n\n") : null,
        ...(sawReasoning ? { reasoning_content: reasoning } : {}),
        ...(calls.length ? { tool_calls: calls } : {}),
      });
    } else {
      // Consecutive text parts form one user message; tool results keep their own wire role.
      let text: string[] = [];
      const flush = () => {
        if (text.length) {
          messages.push({ role: "user", content: text.join("\n\n") });
          text = [];
        }
      };
      for (const part of message.content) {
        if (part.type === "text") {
          requireCondition(pending.size === 0, "Tool results must precede new user content");
          text.push(textPart(part));
        } else if (part.type === "tool_result") {
          flush();
          keys(object(part), ["type", "callId", "status", "content"]);
          const providerId = pending.get(part.callId);
          requireCondition(providerId !== undefined, "Unpaired or duplicate tool result");
          requireCondition(
            ["succeeded", "failed", "denied", "cancelled", "unknown"].includes(part.status),
            "Invalid result status",
          );
          messages.push({
            role: "tool",
            tool_call_id: providerId,
            content: `Tool result status: ${part.status}\n\n${part.content.map(textPart).join("\n\n")}`,
          });
          pending.delete(part.callId);
        } else throw new CodecError("Unsupported user content");
      }
      flush();
    }
  }
  requireCondition(pending.size === 0, "Every tool call needs a result");
  requireCondition(messages.length > 0, "Empty model request");
  const body = {
    model: kimiProfile.origin.model,
    stream: true,
    n: 1,
    reasoning_effort: effort,
    max_completion_tokens: value.maxOutputTokens,
    stream_options: { include_usage: true },
    messages,
    ...(tools.length ? { tools, tool_choice: "auto" } : {}),
    ...(value.toolChoice === "none" ? { tool_choice: "none" } : {}),
  };
  requireCondition(
    encoder.encode(canonicalizeJson(body)).byteLength <= 4 * 1024 * 1024,
    "Model request exceeds byte limit",
  );
  return body;
}

type TextState = { readonly index: number; text: string; seen: boolean };
type CallState = { readonly id: string; name: string; arguments: string; readonly index: number };

/** Decode the documented text/function subset. A finish_reason alone never settles a turn. */
export async function* decodeKimiEvents(
  events: AsyncIterable<unknown>,
  signal: AbortSignal,
  toolChoice?: "none",
): AsyncIterable<ModelStreamEvent> {
  let responseId: string | undefined, finishReason: string | undefined;
  let bytes = 0,
    partial = false,
    roleSeen = false,
    sawDone = false,
    sawUsageTail = false;
  let usage: Usage = UNKNOWN_USAGE;
  const reasoning: TextState = { index: 0, text: "", seen: false };
  const text: TextState = { index: 1, text: "", seen: false };
  const refusal: TextState = { index: 2, text: "", seen: false };
  const calls = new Map<number, CallState>();
  const callIds = new Set<string>();
  const active = () => {
    if (signal.aborted) throw new CodecError("Kimi request cancelled", "cancelled");
  };
  try {
    active();
    for await (const raw of events) {
      active();
      requireCondition(!sawDone, "Event after stream completion");
      if (raw === "[DONE]") {
        requireCondition(
          finishReason !== undefined && sawUsageTail,
          "Missing finish or usage tail before stream completion",
        );
        sawDone = true;
        continue;
      }
      const encoded = canonicalizeJson(raw);
      bytes += encoder.encode(encoded).byteLength;
      requireCondition(bytes <= MAX_BYTES, "Response exceeds semantic byte limit");
      const event = object(JSON.parse(encoded));
      requireCondition(event.object === "chat.completion.chunk", "Invalid chunk object");
      const id = identifier(event.id);
      requireCondition(responseId === undefined || responseId === id, "Response ID changed");
      requireCondition(event.model === kimiProfile.origin.model, "Unexpected model identity");
      responseId = id;
      const choices = array(event.choices);
      requireCondition(choices.length <= 1, "Only one response choice is supported");
      if (!choices.length) {
        requireCondition(
          finishReason !== undefined && !sawUsageTail && Object.hasOwn(event, "usage"),
          "Unexpected usage tail",
        );
        usage = mergeUsage(usage, normalizeUsage(event.usage));
        sawUsageTail = true;
        continue;
      }
      requireCondition(finishReason === undefined && !sawUsageTail, "Content after finish reason");
      const choice = object(choices[0]);
      requireCondition(choice.index === 0, "Unexpected choice index");
      const delta = object(choice.delta);
      keys(delta, ["role", "content", "reasoning_content", "refusal", "tool_calls"]);
      requireCondition(roleSeen || delta.role === "assistant", "Missing assistant role");
      if (delta.role !== undefined) {
        requireCondition(
          delta.role === "assistant" && !roleSeen,
          "Invalid or repeated assistant role",
        );
        roleSeen = true;
      }
      for (const [field, state, kind] of [
        ["reasoning_content", reasoning, "reasoning"],
        ["content", text, "text"],
        ["refusal", refusal, "refusal"],
      ] as const) {
        if (delta[field] === undefined || delta[field] === null) continue;
        const value = string(delta[field]);
        // Empty role envelopes do not fabricate text or hide a tool-only response.
        if (!value) continue;
        state.text += value;
        state.seen = true;
        partial = true;
        if (kind === "reasoning")
          yield { type: "reasoning_delta", index: state.index, kind: "visible", text: value };
        else if (kind === "text") yield { type: "text_delta", index: state.index, text: value };
        else yield { type: "refusal_delta", index: state.index, text: value };
      }
      if (delta.tool_calls !== undefined && delta.tool_calls !== null) {
        requireCondition(toolChoice !== "none", "Tool call returned while tool choice is none");
        for (const rawCall of array(delta.tool_calls)) {
          const call = object(rawCall);
          keys(call, ["index", "id", "type", "function"]);
          const index = integer(call.index, MAX_CALLS);
          const fn = object(call.function);
          keys(fn, ["name", "arguments"]);
          let state = calls.get(index);
          if (!state) {
            requireCondition(index === calls.size, "Function indices must be contiguous");
            const id = identifier(call.id);
            requireCondition(
              call.type === "function" && !callIds.has(id),
              "Invalid or duplicate function identity",
            );
            state = { id, name: "", arguments: "", index: index + 3 };
            calls.set(index, state);
            callIds.add(id);
          } else {
            requireCondition(
              call.id === undefined || call.id === state.id,
              "Function identity changed",
            );
            requireCondition(
              call.type === undefined || call.type === "function",
              "Function type changed",
            );
          }
          if (fn.name !== undefined) {
            state.name += string(fn.name);
            requireCondition(state.name.length <= 128, "Function name exceeds limit");
          }
          if (fn.arguments !== undefined) {
            const value = string(fn.arguments);
            state.arguments += value;
            partial = true;
            yield { type: "tool_call_delta", index: state.index, argumentsDelta: value };
          }
        }
      }
      if (event.usage !== undefined && event.usage !== null)
        usage = mergeUsage(usage, normalizeUsage(event.usage));
      if (choice.usage !== undefined && choice.usage !== null)
        usage = mergeUsage(usage, normalizeUsage(choice.usage));
      if (choice.finish_reason !== null && choice.finish_reason !== undefined) {
        requireCondition(
          ["stop", "tool_calls", "length", "content_filter"].includes(string(choice.finish_reason)),
          "Unsupported finish reason",
        );
        finishReason = string(choice.finish_reason);
      }
    }
    active();
    if (!sawDone) throw new CodecError("Kimi stream ended before completion", "stream_interrupted");
    requireCondition(
      responseId !== undefined && finishReason !== undefined,
      "Missing response identity or finish reason",
    );
    requireCondition(finishReason !== "tool_calls" || calls.size > 0, "Tool finish has no calls");
    requireCondition(finishReason !== "stop" || calls.size === 0, "Normal finish contains calls");
    requireCondition(
      !refusal.seen || finishReason !== "tool_calls",
      "Refused response requests tool execution",
    );
    const reason: StopReason =
      finishReason === "length"
        ? "max_tokens"
        : finishReason === "content_filter" || refusal.seen
          ? "refusal"
          : finishReason === "tool_calls"
            ? "tool_use"
            : "end_turn";
    if (finishReason === "content_filter" && !refusal.seen) {
      // This is an explicit protocol fact, not an invented quote or substitute model answer.
      refusal.text = "Kimi stopped this response with content_filter.";
      refusal.seen = true;
    }
    // Keep verbatim arguments even when truncated. The shared core executes calls only for
    // tool_use; max_tokens/refusal are terminal outcomes, never execution permission.
    for (const call of calls.values()) {
      name(call.name);
      requireCondition(
        reason !== "tool_use" || call.arguments.length > 0,
        "Missing function arguments",
      );
    }
    for (const [state, part] of [
      [reasoning, { type: "reasoning", kind: "visible", text: reasoning.text }],
      [text, { type: "text", text: text.text }],
      [refusal, { type: "refusal", text: refusal.text }],
    ] as const) {
      if (state.seen) {
        active();
        partial = true;
        yield { type: "part_completed", index: state.index, part };
      }
    }
    for (const call of calls.values()) {
      active();
      partial = true;
      yield {
        type: "part_completed",
        index: call.index,
        part: {
          type: "tool_call",
          callId: `kimi:${JSON.stringify([responseId, call.id])}` as ToolCallId,
          providerCallId: call.id,
          providerItemId: null,
          name: call.name,
          rawArguments: call.arguments,
          argumentsSource: "verbatim",
        },
      };
    }
    active();
    yield {
      type: "completed",
      stopReason: reason,
      providerStopReason: { finishReason, model: kimiProfile.origin.model, responseId },
      usage: usage.status === "unknown" ? usage : { ...usage, status: "final" },
    };
  } catch (error) {
    const kind = signal.aborted ? "cancelled" : failureKind(error);
    yield {
      type: "error",
      error: {
        kind,
        message: signal.aborted
          ? "Kimi request cancelled"
          : error instanceof CodecError
            ? error.message
            : "Kimi transport or stream failed",
        partialOutput: partial,
        usage,
      },
    };
  }
}

function normalizeUsage(raw: unknown): Usage {
  if (raw === undefined || raw === null) return UNKNOWN_USAGE;
  const value = object(raw);
  const count = (value: unknown): number | null =>
    value === undefined || value === null ? null : integer(value);
  const detail = (value: unknown): ObjectValue =>
    value === undefined || value === null ? {} : object(value);
  const inputTokens = count(value.prompt_tokens),
    outputTokens = count(value.completion_tokens),
    total = count(value.total_tokens);
  requireCondition(
    total === null ||
      inputTokens === null ||
      outputTokens === null ||
      total === inputTokens + outputTokens,
    "Inconsistent total token count",
  );
  const inputDetails = detail(value.prompt_tokens_details);
  const counters = {
    inputTokens,
    outputTokens,
    cacheReadTokens: count(inputDetails.cached_tokens),
    cacheWriteTokens: count(inputDetails.cache_write_tokens),
    reasoningTokens: count(detail(value.completion_tokens_details).reasoning_tokens),
  };
  const usage: Usage = {
    status: Object.values(counters).some((value) => value !== null) ? "partial" : "unknown",
    ...counters,
  };
  requireCondition(checkUsage(usage).length === 0, "Invalid usage counters");
  return usage;
}

/** Later snapshots may add observations, but never discard or lower observed token counts. */
function mergeUsage(previous: Usage, next: Usage): Usage {
  const counters = [
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "reasoningTokens",
  ] as const;
  const result = { ...previous };
  for (const counter of counters) {
    const before = previous[counter],
      after = next[counter];
    requireCondition(
      before === null || after === null || after >= before,
      "Usage counter decreased",
    );
    result[counter] = after ?? before;
  }
  result.status = counters.some((key) => result[key] !== null) ? "partial" : "unknown";
  requireCondition(checkUsage(result).length === 0, "Inconsistent usage snapshots");
  return result;
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
function integer(value: unknown, maximum = Number.MAX_SAFE_INTEGER): number {
  requireCondition(
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value < maximum,
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
    "Unsupported content field",
  );
}
function failureKind(error: unknown): ModelErrorKind {
  if (error instanceof CodecError) return error.kind;
  if (
    error &&
    typeof error === "object" &&
    "kind" in error &&
    ["protocol", "network", "cancelled", "stream_interrupted", "auth"].includes(
      error.kind as string,
    )
  )
    return error.kind as ModelErrorKind;
  return "network";
}
