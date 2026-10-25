import { expect, it, vi } from "vitest";
import { runSkillScenario, skillScenarios } from "../evals/skills/scenario.ts";

it.each(skillScenarios)("skill runtime conformance: %s", async (scenario) => {
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("Unexpected real fetch"));
  try {
    await runSkillScenario(scenario);
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
  }
});
