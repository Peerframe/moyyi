import { mkdirSync, writeFileSync } from "node:fs";
import { runWebScenario, webScenarios } from "./scenario.ts";

const results = [];
for (const id of webScenarios) {
  await runWebScenario(id);
  results.push({ id, passed: true });
}
mkdirSync("evals/results", { recursive: true });
writeFileSync(
  "evals/results/web.json",
  `${JSON.stringify({ source: "synthetic DNS/HTTP and scripted model", results }, null, 2)}\n`,
);
console.log(
  `${results.length}/${results.length} offline web conformance scenarios passed; not a model injection-resistance score.`,
);
