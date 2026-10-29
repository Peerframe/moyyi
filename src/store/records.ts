import { checkUsage } from "../contracts/model-conformance.ts";
import {
  type BlobRef,
  type ContentPart,
  type EffectRecord,
  effectTransitions,
  PERSISTED_FORMAT_VERSION,
  type TranscriptEntry,
} from "../contracts/persisted/index.ts";
import { canonicalizeJson, checkReplayEnvelopeShape } from "../contracts/replay.ts";

/** Bounds each canonical UTF-8 record independently of its separately bounded blobs. */
export const MAX_RECORD_BYTES = 4 * 1_048_576;

const blobPattern = /^sha256:[0-9a-f]{64}$/;
const usageFields = [
  "status",
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "reasoningTokens",
];

/** Legacy validation is used only during migration; old payload bytes are never rewritten. */
export function encodeEntry(
  entry: TranscriptEntry,
  formatVersion = PERSISTED_FORMAT_VERSION,
): string {
  if (formatVersion !== 1 && formatVersion !== PERSISTED_FORMAT_VERSION)
    throw new TypeError("Unsupported persisted record format");
  const encoded = encodeJson(entry);
  const value = object(entry, ["id", "sessionId", "parentId", "runId", "createdAt", "body"]);
  identifier(value.id);
  identifier(value.sessionId);
  nullableIdentifier(value.parentId);
  nullableIdentifier(value.runId);
  timestamp(value.createdAt);
  body(value.body, formatVersion);
  return encoded;
}

/** Cross-record identity and state transitions are checked by the store transaction. */
export function encodeEffect(effect: EffectRecord): string {
  const encoded = encodeJson(effect);
  const value = object(
    effect,
    ["id", "runId", "callId", "tool", "profile", "digest", "state", "updatedAt"],
    ["evidence"],
  );
  for (const field of ["id", "runId", "callId", "tool", "digest"]) identifier(value[field]);
  member(value.state, Object.keys(effectTransitions));
  timestamp(value.updatedAt);
  if ("evidence" in value) string(value.evidence);
  const profile = object(value.profile, ["class", "reversibility", "verification"]);
  member(profile.class, ["read", "workspace_write", "process", "external"]);
  member(profile.reversibility, ["not_applicable", "snapshot", "none"]);
  member(profile.verification, ["not_applicable", "precondition", "postcheck", "none"]);
  return encoded;
}

/** Extracts all references from an entry already accepted by encodeEntry; preserves order. */
export function entryBlobRefs(entry: TranscriptEntry): readonly BlobRef[] {
  const refs: BlobRef[] = [];
  function content(parts: readonly ContentPart[]): void {
    for (const part of parts) {
      if (part.type === "image") refs.push(part.blob);
      else if (part.type === "tool_result") content(part.content);
    }
  }
  const value = entry.body;
  if (value.kind === "assistant_message") {
    refs.push(value.request.system, value.request.tools, ...value.request.messages);
    content(value.content);
  } else if (value.kind === "user_message") content(value.content);
  else if (value.kind === "tool_results") {
    content(value.results);
    for (const output of value.outputBlobs ?? []) refs.push(output.blob);
  }
  return refs;
}

function encodeJson(value: unknown): string {
  // This runs before any property reads: getters, undefined and other lossy JS values fail.
  const encoded = canonicalizeJson(value);
  if (new TextEncoder().encode(encoded).byteLength > MAX_RECORD_BYTES) {
    throw new RangeError("Record exceeds its canonical UTF-8 byte limit");
  }
  return encoded;
}

function body(input: unknown, formatVersion: number): void {
  const kind = record(input).kind;
  switch (kind) {
    case "user_message": {
      const value = object(input, ["kind", "content", "steering"]);
      if (typeof value.steering !== "boolean") invalid("steering must be a boolean");
      array(value.content).forEach(part);
      return;
    }
    case "assistant_message": {
      const value = object(
        input,
        ["kind", "origin", "content", "stopReason", "providerStopReason", "usage", "request"],
        ["replay"],
      );
      origin(value.origin);
      array(value.content).forEach(part);
      member(value.stopReason, [
        "end_turn",
        "tool_use",
        "max_tokens",
        "refusal",
        "interrupted",
        "other",
      ]);
      object(value.usage, usageFields);
      const errors = checkUsage(value.usage);
      if (errors.length) invalid(errors.join("; "));
      const request = object(value.request, ["rendererVersion", "system", "tools", "messages"]);
      identifier(request.rendererVersion);
      blob(request.system);
      blob(request.tools);
      array(request.messages).forEach(blob);
      // Eligibility belongs to the originating adapter. Preserve stale bindings and unknown
      // revisions faithfully so storage cannot silently authorize or repair their replay.
      if ("replay" in value) {
        const result = checkReplayEnvelopeShape(value.replay);
        if (!result.valid) invalid(`Invalid replay envelope: ${result.reason}`);
      }
      return;
    }
    case "tool_results": {
      const value = object(input, ["kind", "results"], formatVersion >= 2 ? ["outputBlobs"] : []);
      const results = array(value.results);
      results.forEach(toolResult);
      if ("outputBlobs" in value) {
        const outputs = array(value.outputBlobs);
        if (outputs.length === 0) invalid("Empty tool output reference list");
        const calls = new Set<string>();
        for (const output of outputs) {
          const reference = object(output, ["callId", "blob", "bytes"]);
          identifier(reference.callId);
          blob(reference.blob);
          if (
            !Number.isSafeInteger(reference.bytes) ||
            (reference.bytes as number) < 0 ||
            (reference.bytes as number) > 64 * 1024 * 1024
          )
            invalid("Invalid tool output byte length");
          const callId = reference.callId as string;
          if (calls.has(callId)) invalid("Duplicate tool output reference");
          calls.add(callId);
          const matching = results.filter((result) => record(result).callId === callId);
          if (matching.length !== 1) invalid("Tool output reference requires one matching result");
          if (array(record(matching[0]).content).some((part) => record(part).type !== "text"))
            invalid("Full tool output references require text-only results");
        }
      }
      return;
    }
    case "compaction": {
      const value = object(input, ["kind", "replaces", "summary", "producedBy"]);
      const replaces = object(value.replaces, ["fromEntryId", "toEntryId"]);
      identifier(replaces.fromEntryId);
      identifier(replaces.toEntryId);
      array(value.summary).forEach(text);
      const producedBy = object(value.producedBy, ["origin", "promptVersion"]);
      origin(producedBy.origin);
      identifier(producedBy.promptVersion);
      return;
    }
    case "notice": {
      const value = object(input, ["kind", "code", "text"]);
      identifier(value.code);
      string(value.text);
      return;
    }
    default:
      invalid("Unknown entry body kind");
  }
}

function part(input: unknown): void {
  switch (record(input).type) {
    case "text":
      text(input);
      return;
    case "refusal": {
      const value = object(input, ["type", "text"]);
      string(value.text);
      return;
    }
    case "image": {
      image(input);
      return;
    }
    case "reasoning": {
      const value = record(input);
      if (value.kind === "opaque") object(input, ["type", "kind"]);
      else {
        object(input, ["type", "kind", "text"]);
        member(value.kind, ["visible", "summary"]);
        string(value.text);
      }
      return;
    }
    case "tool_call": {
      const value = object(input, [
        "type",
        "callId",
        "providerCallId",
        "name",
        "rawArguments",
        "argumentsSource",
        "providerItemId",
      ]);
      identifier(value.callId);
      identifier(value.providerCallId);
      identifier(value.name);
      string(value.rawArguments);
      member(value.argumentsSource, ["verbatim", "json_serialized"]);
      nullableIdentifier(value.providerItemId);
      return;
    }
    case "tool_result":
      toolResult(input);
      return;
    default:
      invalid("Unknown content part type");
  }
}

function toolResult(input: unknown): void {
  const value = object(input, ["type", "callId", "status", "content"]);
  member(value.type, ["tool_result"]);
  identifier(value.callId);
  member(value.status, ["succeeded", "failed", "denied", "cancelled", "unknown"]);
  for (const item of array(value.content)) {
    if (record(item).type === "text") text(item);
    else image(item);
  }
}

function text(input: unknown): void {
  const value = object(input, ["type", "text"]);
  member(value.type, ["text"]);
  string(value.text);
}

function image(input: unknown): void {
  const value = object(input, ["type", "mediaType", "blob"]);
  member(value.type, ["image"]);
  identifier(value.mediaType);
  blob(value.blob);
}

function origin(input: unknown): void {
  const value = object(input, ["provider", "model"]);
  identifier(value.provider);
  identifier(value.model);
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    invalid("Expected an object");
  }
  return value as Record<string, unknown>;
}

function object(
  input: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  const value = record(input);
  if (
    required.some((key) => !Object.hasOwn(value, key)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
  ) {
    invalid("Record has missing or unknown fields");
  }
  return value;
}

function array(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) invalid("Expected an array");
  return value;
}

function string(value: unknown): asserts value is string {
  if (typeof value !== "string") invalid("Expected a string");
}

function identifier(value: unknown): void {
  string(value);
  if (!value.trim() || value.length > 512) invalid("Identifier must contain 1–512 characters");
}

function nullableIdentifier(value: unknown): void {
  if (value !== null) identifier(value);
}

function member(value: unknown, allowed: readonly string[]): void {
  if (typeof value !== "string" || !allowed.includes(value)) invalid("Unknown discriminator");
}

function blob(value: unknown): void {
  if (typeof value !== "string" || !blobPattern.test(value))
    invalid("Invalid sha256 blob reference");
}

function timestamp(value: unknown): void {
  string(value);
  const match =
    /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/.exec(
      value,
    );
  if (!match) invalid("Timestamp must be RFC 3339");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const zone = match[7] as string;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > (monthDays[month - 1] ?? 0) ||
    hour > 23 ||
    minute > 59 ||
    second > 60 ||
    (zone.length > 1 && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4)) > 59))
  )
    invalid("Invalid RFC 3339 calendar date or time");
  if (second === 60) {
    // RFC 3339 permits a positive leap second at the end of a UTC month. This validates
    // its position without claiming knowledge of future leap-second announcements.
    const preceding = new Date(`${value.slice(0, 17)}59${zone.toUpperCase()}`);
    const next = new Date(preceding.getTime() + 1_000);
    if (next.getUTCDate() !== 1 || next.getUTCHours() !== 0 || next.getUTCMinutes() !== 0) {
      invalid("Leap second must fall at the end of a UTC month");
    }
  }
}

function invalid(message: string): never {
  throw new TypeError(message);
}
