import type { ModelStreamEvent } from "./model.ts";
import type { ContentPart, Usage } from "./persisted/index.ts";

export const UNKNOWN_USAGE: Usage = Object.freeze({
  status: "unknown",
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheWriteTokens: null,
  reasoningTokens: null,
});

const tokenCounters = [
  "inputTokens",
  "outputTokens",
  "cacheReadTokens",
  "cacheWriteTokens",
  "reasoningTokens",
] as const;

function isTokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Validates provider counters without turning missing observations into invented zeroes. */
export function checkUsage(usage: unknown): string[] {
  if (usage === null || typeof usage !== "object" || Array.isArray(usage)) {
    return ["usage must be an object"];
  }
  const value = usage as Record<string, unknown>;
  const violations: string[] = [];
  if (value.status !== "unknown" && value.status !== "partial" && value.status !== "final") {
    violations.push("usage.status must be unknown, partial, or final");
  }
  for (const counter of tokenCounters) {
    if (value[counter] !== null && !isTokenCount(value[counter])) {
      violations.push(`usage.${counter} must be a non-negative safe integer or null`);
    }
    if (value.status === "unknown" && value[counter] !== null) {
      violations.push(`usage.status is unknown but ${counter} is not null`);
    }
  }
  // These are subsets of the totals, not additional usage. A known subset still supplies a
  // lower bound when the other cache counter is unknown.
  if (isTokenCount(value.inputTokens)) {
    const read = isTokenCount(value.cacheReadTokens) ? value.cacheReadTokens : 0;
    const write = isTokenCount(value.cacheWriteTokens) ? value.cacheWriteTokens : 0;
    if (read + write > value.inputTokens) {
      violations.push("usage cache read/write subcounts exceed inputTokens");
    }
  }
  if (
    isTokenCount(value.outputTokens) &&
    isTokenCount(value.reasoningTokens) &&
    value.reasoningTokens > value.outputTokens
  ) {
    violations.push("usage.reasoningTokens exceeds outputTokens");
  }
  return violations;
}

type DeltaKind = "text" | "refusal" | "tool_call" | "reasoning:visible" | "reasoning:summary";

function partKind(part: ContentPart): string {
  return part.type === "reasoning" ? `reasoning:${part.kind}` : part.type;
}

/**
 * Checks a recorded stream against the ModelClient contract. Every provider plugin runs its
 * recorded fixtures through this, so all providers fail the same way for the same mistake.
 * Returns human-readable violations; an empty list means the stream conforms.
 */
export function checkModelStream(events: readonly ModelStreamEvent[]): string[] {
  const violations: string[] = [];
  const terminalAt = events.findIndex((e) => e.type === "completed" || e.type === "error");
  if (terminalAt === -1) {
    violations.push("stream has no terminal event (completed or error)");
  } else if (terminalAt !== events.length - 1) {
    violations.push(`events after the terminal event at position ${terminalAt}`);
  }

  const completedParts = new Set<number>();
  const deltaKinds = new Map<number, DeltaKind>();
  let hasOutput = false;
  for (const [position, event] of events.entries()) {
    if (terminalAt !== -1 && position > terminalAt) continue;
    if (event.type === "completed" || event.type === "error") {
      const usage = event.type === "completed" ? event.usage : event.error.usage;
      violations.push(...checkUsage(usage).map((message) => `position ${position}: ${message}`));
      if (event.type === "error" && hasOutput && !event.error.partialOutput) {
        violations.push(`position ${position}: error.partialOutput is false after content output`);
      }
      continue;
    }
    hasOutput = true;
    if (event.index < 0 || !Number.isSafeInteger(event.index)) {
      violations.push(`position ${position}: invalid part index ${event.index}`);
      continue;
    }
    if (completedParts.has(event.index)) {
      violations.push(`position ${position}: part ${event.index} changed after it completed`);
      continue;
    }
    const previousKind = deltaKinds.get(event.index);
    if (event.type === "part_completed") {
      if (previousKind !== undefined && previousKind !== partKind(event.part)) {
        violations.push(
          `position ${position}: part ${event.index} completed as ${partKind(event.part)} after ${previousKind} deltas`,
        );
      }
      completedParts.add(event.index);
      continue;
    }
    let kind: DeltaKind;
    switch (event.type) {
      case "text_delta":
        kind = "text";
        break;
      case "refusal_delta":
        kind = "refusal";
        break;
      case "tool_call_delta":
        kind = "tool_call";
        break;
      case "reasoning_delta":
        if (event.kind !== "visible" && event.kind !== "summary") {
          violations.push(`position ${position}: reasoning delta kind must be visible or summary`);
          continue;
        }
        kind = `reasoning:${event.kind}`;
        break;
    }
    if (previousKind !== undefined && previousKind !== kind) {
      violations.push(
        `position ${position}: part ${event.index} changed delta kind from ${previousKind} to ${kind}`,
      );
    } else {
      deltaKinds.set(event.index, kind);
    }
  }

  const terminal = terminalAt === -1 ? undefined : events[terminalAt];
  if (terminal?.type === "completed") {
    for (const index of deltaKinds.keys()) {
      if (!completedParts.has(index))
        violations.push(`part ${index} has deltas but never completed`);
    }
  }
  if (terminal?.type === "completed" && terminal.stopReason === "tool_use") {
    const hasToolCall = events.some(
      (e) => e.type === "part_completed" && e.part.type === "tool_call",
    );
    if (!hasToolCall) violations.push("stopReason is tool_use but no tool call completed");
  }
  return violations;
}
