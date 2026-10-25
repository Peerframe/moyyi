import { runRuntimeEvalScenario, runtimeEvalScenarios } from "./scenario.ts";

for (const scenario of runtimeEvalScenarios) {
  await runRuntimeEvalScenario(scenario);
  console.log(`PASS ${scenario}`);
}
console.log(
  `${runtimeEvalScenarios.length} runtime/harness conformance scenarios; synthetic models, real runtime and files, no paid requests. This is not a task-solving score.`,
);
