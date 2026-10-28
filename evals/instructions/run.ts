import { mkdirSync, writeFileSync } from "node:fs";
import { runAnswerReviewScenario } from "./answer-review.ts";
import { runWorkspaceNavigationScenario } from "./navigation.ts";
import { instructionScenarios, runInstructionScenario } from "./scenario.ts";

const originalFetch = globalThis.fetch;
let networkRequests = 0;
globalThis.fetch = async () => {
  networkRequests++;
  throw Error("Real network is forbidden in instruction conformance");
};
const results = [];
try {
  for (const id of instructionScenarios) {
    await runInstructionScenario(id);
    results.push({ id, passed: true });
  }
  results.push({
    id: "workspace-navigation-to-artifact",
    ...(await runWorkspaceNavigationScenario()),
    passed: true,
  });
  for (const invalidReference of [false, true]) {
    results.push({
      id: `isolated-evidence-${invalidReference ? "invalid-reference" : "complete"}`,
      ...(await runAnswerReviewScenario(invalidReference)),
      passed: true,
    });
  }
  if (networkRequests !== 0) throw Error("Instruction conformance attempted network access");
} finally {
  globalThis.fetch = originalFetch;
}
mkdirSync("evals/results", { recursive: true });
writeFileSync(
  "evals/results/instructions.json",
  `${JSON.stringify({ source: "scripted model with actual runtime, SQLite and synthetic files", networkRequests, results }, null, 2)}\n`,
);
console.log(
  `${results.length}/${results.length} offline instruction conformance scenarios passed; not a model instruction-following score.`,
);
