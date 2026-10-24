import type { ModelStreamEvent } from "./model.ts";

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
  for (const [position, event] of events.entries()) {
    if (event.type === "completed" || event.type === "error") continue;
    if (event.index < 0 || !Number.isInteger(event.index)) {
      violations.push(`position ${position}: invalid part index ${event.index}`);
      continue;
    }
    if (completedParts.has(event.index)) {
      violations.push(`position ${position}: part ${event.index} changed after it completed`);
    }
    if (event.type === "part_completed") completedParts.add(event.index);
  }

  const terminal = terminalAt === -1 ? undefined : events[terminalAt];
  if (terminal?.type === "completed" && terminal.stopReason === "tool_use") {
    const hasToolCall = events.some(
      (e) => e.type === "part_completed" && e.part.type === "tool_call",
    );
    if (!hasToolCall) violations.push("stopReason is tool_use but no tool call completed");
  }
  return violations;
}
