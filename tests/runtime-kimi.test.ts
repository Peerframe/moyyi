import { expect, it, vi } from "vitest";
import { kimiScenarios, runKimiScenario } from "../evals/kimi/scenario.ts";

it.each(kimiScenarios)("Kimi runtime conformance: %s", async (scenario) => {
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("Unexpected real fetch"));
  try {
    await runKimiScenario(scenario);
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
  }
});
