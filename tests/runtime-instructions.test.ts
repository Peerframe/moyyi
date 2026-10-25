import { expect, it, vi } from "vitest";
import { instructionScenarios, runInstructionScenario } from "../evals/instructions/scenario.ts";

it.each(instructionScenarios)("instruction runtime conformance: %s", async (scenario) => {
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("Unexpected real fetch"));
  try {
    await runInstructionScenario(scenario);
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
  }
});
