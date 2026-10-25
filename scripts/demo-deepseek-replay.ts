import assert from "node:assert/strict";
import { assertEquivalent, instruction, runRoundTrip } from "../evals/deepseek/scenario.ts";

console.log(
  "moyyi DeepSeek adapter demo: handwritten synthetic SSE, real workspace files and SQLite, then recorded replay.",
);
console.log(
  "This does not contact DeepSeek or read credentials. The response plan and answer are fixtures.",
);
console.log(`User: ${instruction}`);
try {
  const result = await runRoundTrip({
    observe(phase, event) {
      if (event.type === "assistant.delta") console.log(`[${phase}] Assistant: ${event.text}`);
      if (event.type === "effect.updated" && event.effect.state === "succeeded")
        console.log(`[${phase}] Tool ${event.effect.tool}: succeeded`);
      if (event.type === "run.finished") console.log(`[${phase}] Run: ${event.outcome.kind}`);
    },
  });
  assertEquivalent(result);
  assert.equal(result.first.outcome.kind, "completed");
  assert.deepEqual(
    result.first.results.map((part) => part.status),
    ["succeeded", "succeeded"],
  );
  assert.equal(result.records.length, 3);
  console.log(
    "Verified: list and read ran against real files; three model exchanges were recorded and replayed with identical tool results, effect outcomes and assistant content.",
  );
  console.log(
    "Replay used no transport. Temporary workspace, recordings and both SQLite directories were removed.",
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
