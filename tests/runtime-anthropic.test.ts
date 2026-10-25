import { expect, it, vi } from "vitest";
import { anthropicScenarios, runAnthropicScenario } from "../evals/anthropic/scenario.ts";

it.each(anthropicScenarios)("Anthropic runtime conformance: %s", async (scenario) => {
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("Unexpected real fetch"));
  try {
    await runAnthropicScenario(scenario);
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
  }
});
