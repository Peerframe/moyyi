import { mkdirSync, writeFileSync } from "node:fs";
import { anthropicScenarios, runAnthropicScenario } from "./scenario.ts";

const results = [];
for (const id of anthropicScenarios) {
  await runAnthropicScenario(id);
  results.push({ id, passed: true });
}
mkdirSync("evals/results", { recursive: true });
writeFileSync(
  "evals/results/anthropic.json",
  `${JSON.stringify({ source: "synthetic SSE, real runtime/files/SQLite", results }, null, 2)}\n`,
);
console.log(
  `${results.length}/${results.length} offline Anthropic scenarios passed; no live request or model-quality claim.`,
);
