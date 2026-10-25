import { mkdirSync, writeFileSync } from "node:fs";
import { runSkillScenario, skillScenarios } from "./scenario.ts";

const original = globalThis.fetch;
let networkRequests = 0;
globalThis.fetch = async () => {
  networkRequests++;
  throw Error("Real network forbidden in skill conformance");
};
const results = [];
try {
  for (const id of skillScenarios) {
    await runSkillScenario(id);
    results.push({ id, passed: true });
  }
  if (networkRequests) throw Error("Unexpected network requests");
} finally {
  globalThis.fetch = original;
}
mkdirSync("evals/results", { recursive: true });
writeFileSync(
  "evals/results/skills.json",
  `${JSON.stringify({ source: "Scripted model with actual runtime, SQLite and synthetic files; not a model-obedience score", networkRequests, results }, null, 2)}\n`,
);
console.log(
  `${results.length}/${results.length} offline skill conformance scenarios passed; no real model or network calls.`,
);
