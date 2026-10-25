import { createHash } from "node:crypto";
import {
  bindReplay,
  type ContentPart,
  canonicalizeJson,
  checkUsage,
  type JsonValue,
  type ModelMessage,
  type ModelProfile,
  type ModelRequest,
  type ModelStreamEvent,
  parseStrictJson,
  type ReplayEnvelope,
  type StopReason,
  type ToolCallId,
  UNKNOWN_USAGE,
  type Usage,
  validateReplay,
} from "../../contracts/index.ts";
import { type AnthropicOptions, AnthropicWireError } from "./types.ts";

export const ANTHROPIC_API_VERSION = "2023-06-01";
export const ANTHROPIC_API_PROFILE = "anthropic-messages-text-v1-2023-06-01";
export const anthropicProfile: ModelProfile = {
  origin: { provider: "anthropic", model: "claude-sonnet-5-5" },
  contextWindowTokens: 1_000_000,
  maxOutputTokens: 8192,
  parallelToolCalls: true,
  reasoning: "opaque",
  promptCache: "explicit",
  editFormat: "search_replace",
};
const origin = {
  ...anthropicProfile.origin,
  apiProfile: ANTHROPIC_API_PROFILE,
  modelRevision: anthropicProfile.origin.model,
};
const MAX_BYTES = 1024 * 1024,
  MAX_BLOCKS = 1024;
type Obj = Record<string, unknown>;
const hash = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const digest = (value: unknown) => hash(canonicalizeJson(value));
const fail = (message: string): never => {
  throw new AnthropicWireError("protocol", message);
};
function requireValue(ok: unknown, message: string): asserts ok {
  if (!ok) fail(message);
}
function object(value: unknown): Obj {
  requireValue(value && typeof value === "object" && !Array.isArray(value), "Expected object");
  return value as Obj;
}
function text(value: unknown): string {
  requireValue(typeof value === "string", "Expected string");
  return value;
}
function identifier(value: unknown): string {
  const s = text(value);
  requireValue(/^[a-zA-Z0-9_-]{1,256}$/.test(s), "Invalid identifier");
  return s;
}
function name(value: unknown): string {
  const s = text(value);
  requireValue(/^[a-zA-Z0-9_-]{1,64}$/.test(s), "Invalid tool name");
  return s;
}
function exact(value: Obj, allowed: string[]) {
  requireValue(
    Object.keys(value).every((key) => allowed.includes(key)),
    "Unsupported fields",
  );
}

interface ReplayPayload {
  blocks: Obj[];
  responseId: string;
  prefixHash: string;
  accountScope: string;
  invalidated: string[];
}
function payload(envelope: ReplayEnvelope): ReplayPayload {
  const value = object(parseStrictJson(envelope.payload, MAX_BYTES));
  exact(value, ["blocks", "responseId", "prefixHash", "accountScope", "invalidated"]);
  requireValue(
    Array.isArray(value.blocks) && value.blocks.length <= MAX_BLOCKS,
    "Invalid replay blocks",
  );
  requireValue(
    Array.isArray(value.invalidated) &&
      value.invalidated.length <= 2048 &&
      value.invalidated.every((id) => typeof id === "string" && /^sha256:[a-f0-9]{64}$/.test(id)),
    "Invalid replay invalidation ledger",
  );
  identifier(value.responseId);
  text(value.prefixHash);
  text(value.accountScope);
  return value as unknown as ReplayPayload;
}
function replayKey(envelope: ReplayEnvelope) {
  return digest(envelope);
}
function verifiedReplay(message: ModelMessage, options: AnthropicOptions): ReplayPayload {
  requireValue(
    message.replay &&
      (message.stopReason === "end_turn" || message.stopReason === "tool_use") &&
      validateReplay(message.replay, message, origin, 1, hash).valid,
    "No complete bound replay proof",
  );
  const saved = payload(message.replay);
  requireValue(saved.accountScope === options.accountScope, "Replay account changed");
  const normalized = saved.blocks.map((block, index) => {
    const normalized = normalizeBlock(object(block), saved.responseId);
    const original = message.content[index];
    if (
      normalized.type === "tool_call" &&
      original?.type === "tool_call" &&
      canonicalizeJson(parseStrictJson(original.rawArguments, MAX_BYTES)) ===
        canonicalizeJson(block.input)
    )
      return {
        ...normalized,
        rawArguments: original.rawArguments,
        argumentsSource: original.argumentsSource,
      };
    return normalized;
  });
  requireValue(
    canonicalizeJson(normalized) === canonicalizeJson(message.content),
    "Replay payload/content mismatch",
  );
  return saved;
}
export interface AnthropicRequest {
  readonly body: Obj;
  readonly prefixHash: string;
  readonly invalidated: readonly string[];
}

/** Keep only signed reasoning whose original, actual wire prefix and account still match. */
export function buildAnthropicRequest(
  request: ModelRequest,
  options: AnthropicOptions,
): AnthropicRequest {
  requireValue(
    typeof options.accountScope === "string" &&
      /^[a-zA-Z0-9_.:-]{1,128}$/.test(options.accountScope),
    "A non-secret accountScope is required",
  );
  const value = JSON.parse(canonicalizeJson(request)) as ModelRequest;
  requireValue(
    canonicalizeJson(value.origin) === canonicalizeJson(anthropicProfile.origin),
    "Unsupported model",
  );
  requireValue(
    Number.isSafeInteger(value.maxOutputTokens) &&
      value.maxOutputTokens > 0 &&
      value.maxOutputTokens <= anthropicProfile.maxOutputTokens,
    "Invalid output budget",
  );
  requireValue(value.messages.length <= 4096 && value.tools.length <= 128, "Request item limit");
  const system = value.system.map((part) => {
    requireValue(part.type === "text", "Only text system content is supported");
    return { type: "text", text: part.text };
  });
  const names = new Set<string>();
  const tools = value.tools.map((tool) => {
    name(tool.name);
    requireValue(!names.has(tool.name), "Duplicate tool name");
    names.add(tool.name);
    object(tool.inputSchema);
    text(tool.description);
    return { name: tool.name, description: tool.description, input_schema: tool.inputSchema };
  });
  const invalidated = new Set<string>();
  const precedingReplays: string[] = [];
  let previousRole: ModelMessage["role"] | undefined;
  // Inspect the whole durable history before rendering any old thinking. Refusal, truncation
  // and failures cannot carry a trustworthy replay ledger. Their absence of proof is a barrier
  // for earlier signatures. Consecutive users conservatively cover empty interrupted responses,
  // which ContextBuilder renders as user notices; no notice text is interpreted as authority.
  for (const message of value.messages) {
    let barrier = message.role === "user" && previousRole === "user";
    if (message.role === "assistant") {
      if (message.replay) precedingReplays.push(replayKey(message.replay));
      try {
        for (const key of verifiedReplay(message, options).invalidated) invalidated.add(key);
      } catch {
        barrier = true;
      }
    }
    if (barrier) for (const key of precedingReplays) invalidated.add(key);
    previousRole = message.role;
  }
  const messages: Obj[] = [],
    pending = new Map<string, string>(),
    used = new Set<string>(),
    wireIds = new Set<string>();
  for (const message of value.messages) {
    requireValue(message.role === "user" || message.role === "assistant", "Unsupported role");
    requireValue(Array.isArray(message.content) && message.content.length > 0, "Empty message");
    const common: Obj[] = [];
    if (message.role === "assistant")
      requireValue(pending.size === 0, "Tool results missing before assistant");
    for (const part of message.content as readonly ContentPart[]) {
      if (part.type === "text" || part.type === "refusal")
        common.push({ type: "text", text: text(part.text) });
      else if (part.type === "reasoning" && message.role === "assistant") {
        /* only a bound replay may supply thinking */
      } else if (part.type === "tool_call" && message.role === "assistant") {
        name(part.name);
        const id = identifier(part.providerCallId);
        requireValue(!used.has(part.callId) && !wireIds.has(id), "Repeated tool ID");
        used.add(part.callId);
        wireIds.add(id);
        pending.set(part.callId, id);
        const input = object(parseStrictJson(part.rawArguments, MAX_BYTES));
        common.push({ type: "tool_use", id, name: part.name, input });
      } else if (part.type === "tool_result" && message.role === "user") {
        const id = pending.get(part.callId);
        requireValue(id, "Unpaired tool result");
        pending.delete(part.callId);
        requireValue(
          part.content.every((item) => item.type === "text"),
          "Only text tool results are supported",
        );
        common.push({
          type: "tool_result",
          tool_use_id: id,
          is_error: part.status !== "succeeded",
          content: [{ type: "text", text: `Tool status: ${part.status}\n` }, ...part.content],
        });
      } else fail("Unsupported content part");
    }
    if (message.role === "user") {
      requireValue(pending.size === 0, "Incomplete tool-result group");
      const firstText = common.findIndex((block) => block.type !== "tool_result");
      requireValue(
        firstText < 0 || common.slice(firstText).every((block) => block.type !== "tool_result"),
        "Tool results must precede user text",
      );
    }
    if (message.role === "assistant" && message.stopReason === "interrupted")
      requireValue(
        !message.content.some((part) => part.type === "tool_call"),
        "Interrupted tool calls cannot continue",
      );
    let blocks = common;
    if (message.role === "assistant" && message.replay) {
      const key = replayKey(message.replay);
      try {
        requireValue(!invalidated.has(key), "Stale replay");
        const saved = verifiedReplay(message, options);
        requireValue(
          saved.prefixHash === digest({ system, tools, messages }),
          "Replay prefix changed",
        );
        blocks = saved.blocks;
      } catch {
        invalidated.add(key);
      }
    }
    requireValue(
      blocks.length > 0,
      "Cannot continue a reasoning-only message without valid replay",
    );
    messages.push({ role: message.role, content: blocks });
  }
  requireValue(pending.size === 0, "Tool results are missing");
  requireValue(
    messages.length > 0 && messages.at(-1)?.role === "user",
    "Request must end in a user message",
  );
  requireValue(invalidated.size <= 2048, "Replay invalidation ledger limit");
  const body = {
    model: anthropicProfile.origin.model,
    system,
    tools,
    messages,
    max_tokens: value.maxOutputTokens,
    thinking: { type: "adaptive" },
    stream: true,
  };
  requireValue(
    new TextEncoder().encode(canonicalizeJson(body)).byteLength <= 4 * MAX_BYTES,
    "Request byte limit",
  );
  return {
    body,
    prefixHash: digest({ system, tools, messages }),
    invalidated: [...invalidated].sort(),
  };
}

function normalizeBlock(block: Obj, responseId: string): ContentPart {
  if (block.type === "text") {
    exact(block, ["type", "text"]);
    return { type: "text", text: text(block.text) };
  }
  if (block.type === "thinking") {
    exact(block, ["type", "thinking", "signature"]);
    requireValue(text(block.signature).length > 0, "Missing thinking signature");
    return { type: "reasoning", kind: "summary", text: text(block.thinking) };
  }
  if (block.type === "redacted_thinking") {
    exact(block, ["type", "data"]);
    requireValue(text(block.data).length > 0, "Missing redacted data");
    return { type: "reasoning", kind: "opaque" };
  }
  if (block.type === "tool_use") {
    exact(block, ["type", "id", "name", "input"]);
    const id = identifier(block.id);
    name(block.name);
    object(block.input);
    return {
      type: "tool_call",
      callId: `anthropic:${responseId}:${id}` as ToolCallId,
      providerCallId: id,
      providerItemId: null,
      name: block.name as string,
      rawArguments: canonicalizeJson(block.input),
      argumentsSource: "json_serialized",
    };
  }
  return fail("Unsupported Anthropic content block");
}

/** Strict Messages SSE lifecycle. Unknown additive top-level events do not grant capabilities. */
export async function* decodeAnthropicEvents(
  events: AsyncIterable<unknown>,
  signal: AbortSignal,
  request: AnthropicRequest,
  options: AnthropicOptions,
): AsyncIterable<ModelStreamEvent> {
  let responseId = "",
    started = false,
    deltaSeen = false,
    ended = false,
    partial = false;
  let reason: string | null = null,
    details: JsonValue = null,
    usage: Usage = UNKNOWN_USAGE;
  const blocks: Obj[] = [],
    parts: ContentPart[] = [],
    ids = new Set<string>();
  let active:
    | { index: number; block: Obj; arguments: string; hasArguments: boolean; signature: boolean }
    | undefined;
  const counters: Record<string, number | null> = {
    input_tokens: null,
    output_tokens: null,
    cache_read_input_tokens: null,
    cache_creation_input_tokens: null,
  };
  const updateUsage = (raw: unknown, final = false) => {
    if (raw !== undefined && raw !== null)
      for (const [key, value] of Object.entries(object(raw)))
        if (key in counters) {
          requireValue(
            Number.isSafeInteger(value) &&
              Number(value) >= 0 &&
              (counters[key] === null || Number(value) >= Number(counters[key])),
            "Invalid or decreasing usage",
          );
          counters[key] = Number(value);
        }
    const input = [
      counters.input_tokens,
      counters.cache_read_input_tokens,
      counters.cache_creation_input_tokens,
    ];
    usage = {
      status: Object.values(counters).some((n) => n !== null)
        ? final
          ? "final"
          : "partial"
        : "unknown",
      inputTokens: input.every((n) => n !== null)
        ? input.reduce<number>((sum, n) => sum + (n ?? 0), 0)
        : null,
      outputTokens: counters.output_tokens ?? null,
      cacheReadTokens: counters.cache_read_input_tokens ?? null,
      cacheWriteTokens: counters.cache_creation_input_tokens ?? null,
      reasoningTokens: null,
    };
    requireValue(checkUsage(usage).length === 0, "Usage cannot be normalized");
  };
  try {
    for await (const raw of events) {
      if (signal.aborted) throw new AnthropicWireError("cancelled", "Anthropic request cancelled");
      const event = object(raw),
        kind = text(event.type);
      if (kind === "ping") continue;
      requireValue(!ended, "Event after message_stop");
      if (kind === "error") {
        const error = object(event.error);
        const type = text(error.type);
        throw new AnthropicWireError(
          type === "overloaded_error"
            ? "overloaded"
            : type === "rate_limit_error"
              ? "rate_limited"
              : type === "authentication_error" || type === "permission_error"
                ? "auth"
                : "protocol",
          "Anthropic reported stream failure",
        );
      }
      if (kind === "message_start") {
        requireValue(!started, "Duplicate message_start");
        const message = object(event.message);
        requireValue(
          message.type === "message" &&
            message.role === "assistant" &&
            message.model === anthropicProfile.origin.model &&
            Array.isArray(message.content) &&
            message.content.length === 0 &&
            message.stop_reason === null,
          "Invalid message identity",
        );
        responseId = identifier(message.id);
        updateUsage(message.usage);
        started = true;
      } else if (kind === "content_block_start") {
        requireValue(
          started &&
            !deltaSeen &&
            !active &&
            event.index === blocks.length &&
            blocks.length < MAX_BLOCKS,
          "Invalid block start/order",
        );
        const block = object(event.content_block);
        const type = text(block.type);
        if (type === "text") {
          exact(block, ["type", "text"]);
          requireValue(block.text === "", "Text start must be empty");
        } else if (type === "thinking") {
          exact(block, ["type", "thinking", "signature"]);
          requireValue(
            block.thinking === "" && (block.signature === undefined || block.signature === ""),
            "Thinking start must be empty",
          );
          block.signature = "";
        } else if (type === "redacted_thinking") normalizeBlock(block, responseId);
        else if (type === "tool_use") {
          exact(block, ["type", "id", "name", "input"]);
          const id = identifier(block.id);
          requireValue(!ids.has(id), "Duplicate tool ID");
          ids.add(id);
          name(block.name);
          object(block.input);
        } else fail("Unsupported block type");
        active = {
          index: blocks.length,
          block,
          arguments: "",
          hasArguments: false,
          signature: false,
        };
      } else if (kind === "content_block_delta") {
        requireValue(
          active && event.index === active.index && !deltaSeen,
          "Delta outside active block",
        );
        const delta = object(event.delta);
        if (delta.type === "text_delta" && active.block.type === "text") {
          const value = text(delta.text);
          active.block.text = text(active.block.text) + value;
          partial = true;
          yield { type: "text_delta", index: active.index, text: value };
        } else if (delta.type === "thinking_delta" && active.block.type === "thinking") {
          requireValue(!active.signature, "Thinking after signature");
          const value = text(delta.thinking);
          active.block.thinking = text(active.block.thinking) + value;
          partial = true;
          yield { type: "reasoning_delta", kind: "summary", index: active.index, text: value };
        } else if (delta.type === "signature_delta" && active.block.type === "thinking") {
          active.block.signature = text(active.block.signature) + text(delta.signature);
          active.signature = true;
        } else if (delta.type === "input_json_delta" && active.block.type === "tool_use") {
          requireValue(
            Object.keys(object(active.block.input)).length === 0,
            "Tool initial input and deltas conflict",
          );
          const value = text(delta.partial_json);
          active.arguments += value;
          active.hasArguments = true;
          partial = true;
          yield { type: "tool_call_delta", index: active.index, argumentsDelta: value };
        } else fail("Invalid block delta");
        requireValue(
          new TextEncoder().encode(canonicalizeJson(active)).byteLength <= MAX_BYTES,
          "Block byte limit",
        );
      } else if (kind === "content_block_stop") {
        requireValue(active && event.index === active.index && !deltaSeen, "Invalid block stop");
        if (active.block.type === "tool_use" && active.hasArguments) {
          try {
            active.block.input = object(parseStrictJson(active.arguments, MAX_BYTES));
          } catch {
            fail("Invalid tool input JSON");
          }
        }
        let part = normalizeBlock(active.block, responseId);
        if (part.type === "tool_call" && active.hasArguments)
          part = { ...part, rawArguments: active.arguments, argumentsSource: "verbatim" };
        blocks.push(active.block);
        parts.push(part);
        partial = true;
        yield { type: "part_completed", index: active.index, part };
        active = undefined;
      } else if (kind === "message_delta") {
        requireValue(started && !active, "Message delta before blocks settle");
        const delta = object(event.delta);
        if (delta.stop_reason !== undefined && delta.stop_reason !== null) {
          requireValue(reason === null, "Duplicate stop reason");
          reason = text(delta.stop_reason);
        }
        if (delta.stop_details !== undefined) details = delta.stop_details as JsonValue;
        updateUsage(event.usage);
        deltaSeen = true;
      } else if (kind === "message_stop") {
        requireValue(started && !active && deltaSeen && reason, "Incomplete message_stop");
        ended = true;
      } else {
        // This narrow profile cannot safely interpret new capability-bearing events.
        fail("Unsupported Anthropic stream event");
      }
    }
    if (signal.aborted) throw new AnthropicWireError("cancelled", "Anthropic request cancelled");
    if (!ended || reason === null)
      throw new AnthropicWireError(
        "stream_interrupted",
        "Anthropic stream ended before message_stop",
      );
    const stop: StopReason =
      reason === "end_turn" || reason === "stop_sequence"
        ? "end_turn"
        : reason === "tool_use"
          ? "tool_use"
          : reason === "max_tokens"
            ? "max_tokens"
            : reason === "refusal"
              ? "refusal"
              : "other";
    requireValue(
      (stop === "tool_use") === parts.some((part) => part.type === "tool_call") ||
        stop === "max_tokens" ||
        stop === "refusal",
      "Stop reason disagrees with tool calls",
    );
    if (stop === "refusal") {
      const explanation =
        details &&
        typeof details === "object" &&
        !Array.isArray(details) &&
        "explanation" in details
          ? details.explanation
          : undefined;
      const part: ContentPart = {
        type: "refusal",
        text:
          typeof explanation === "string"
            ? explanation
            : "The provider stopped this response with a refusal.",
      };
      parts.push(part);
      partial = true;
      yield { type: "part_completed", index: parts.length - 1, part };
    }
    updateUsage(undefined, true);
    // Replaying raw blocks is optional. A refusal has an added common refusal fact, so no replay.
    let replay: ReplayEnvelope | undefined;
    if (stop === "end_turn" || stop === "tool_use") {
      try {
        replay = bindReplay(
          { role: "assistant", content: parts },
          origin,
          1,
          canonicalizeJson({
            blocks,
            responseId,
            prefixHash: request.prefixHash,
            accountScope: options.accountScope,
            invalidated: request.invalidated,
          }),
          hash,
        );
      } catch {
        fail("Anthropic replay exceeds the supported envelope limits");
      }
    }
    yield {
      type: "completed",
      stopReason: stop,
      providerStopReason: { reason, details, model: anthropicProfile.origin.model, responseId },
      usage,
      ...(replay ? { replay } : {}),
    };
  } catch (error) {
    yield {
      type: "error",
      error: {
        kind: signal.aborted
          ? "cancelled"
          : error instanceof AnthropicWireError
            ? error.kind
            : "network",
        message: signal.aborted
          ? "Anthropic request cancelled"
          : error instanceof AnthropicWireError
            ? error.message
            : "Anthropic stream failed",
        partialOutput: partial,
        usage,
      },
    };
  }
}
