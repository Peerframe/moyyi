import { mkdirSync, writeFileSync } from "node:fs";
import { kimiScenarios, runKimiScenario } from "./scenario.ts";

const results = [];
for (const id of kimiScenarios) {
  await runKimiScenario(id);
  results.push({ id, passed: true });
}
mkdirSync("evals/results", { recursive: true });
writeFileSync(
  "evals/results/kimi.json",
  `${JSON.stringify({ source: "synthetic Chat SSE, real runtime/files/SQLite", results }, null, 2)}\n`,
);
console.log(
  `${results.length}/${results.length} offline Kimi scenarios passed; no live request or model-quality claim.`,
);
