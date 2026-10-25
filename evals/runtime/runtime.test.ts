import { describe, it } from "vitest";
import { runRuntimeEvalScenario, runtimeEvalScenarios } from "./scenario.ts";

describe("runtime task evaluation conformance", () => {
  for (const scenario of runtimeEvalScenarios) it(scenario, () => runRuntimeEvalScenario(scenario));
});
