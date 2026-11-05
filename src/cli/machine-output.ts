import type { RuntimeEvent, SessionId } from "../contracts/index.ts";

export type OutputFormat = "text" | "json" | "stream-json";

/** Event types a script following one prompt can use; host diagnostics are not included. */
const STREAMED = new Set<RuntimeEvent["type"]>([
  "session.ready",
  "run.started",
  "assistant.delta",
  "entry.appended",
  "approval.requested",
  "effect.updated",
  "run.finished",
  "command.rejected",
]);

/**
 * Machine-readable output for one-shot runs. `stream-json` writes each relevant protocol event as
 * one JSON line as it happens; `json` writes one summary object when the session ends.
 */
export function machineOutput(
  format: Exclude<OutputFormat, "text">,
  write: (line: string) => void,
) {
  let sessionId: SessionId | undefined;
  let runId: string | undefined;
  let outcome: unknown = null;
  let answer = "";
  let requests = 0;
  const tokens = { input: 0, output: 0, cacheRead: 0, unreported: 0 };
  const effects = new Map<string, { tool: string; state: string }>();
  return {
    observe(event: RuntimeEvent) {
      if (format === "stream-json") {
        if (STREAMED.has(event.type)) write(`${JSON.stringify(event)}\n`);
        return;
      }
      if (event.type === "session.ready") sessionId = event.sessionId;
      else if (event.type === "run.started" && event.sessionId === sessionId) runId = event.runId;
      else if (event.type === "effect.updated" && event.effect.runId === runId)
        effects.set(event.effect.id, { tool: event.effect.tool, state: event.effect.state });
      else if (event.type === "run.finished" && event.runId === runId) outcome = event.outcome;
      else if (
        event.type === "entry.appended" &&
        event.entry.runId === runId &&
        event.entry.body.kind === "assistant_message"
      ) {
        const body = event.entry.body;
        requests++;
        if (body.usage.status === "unknown" || body.usage.outputTokens === null)
          tokens.unreported++;
        else {
          tokens.input += body.usage.inputTokens ?? 0;
          tokens.output += body.usage.outputTokens ?? 0;
          tokens.cacheRead += body.usage.cacheReadTokens ?? 0;
        }
        const text = body.content
          .filter((part) => part.type === "text" || part.type === "refusal")
          .map((part) => part.text)
          .join("");
        if (text.trim()) answer = text;
      }
    },
    finish(exitCode: number) {
      if (format !== "json") return;
      write(
        `${JSON.stringify({
          sessionId: sessionId ?? null,
          runId: runId ?? null,
          outcome,
          exitCode,
          answer,
          usage: { requests, ...tokens },
          effects: [...effects.entries()].map(([id, effect]) => ({ id, ...effect })),
        })}\n`,
      );
    },
  };
}
