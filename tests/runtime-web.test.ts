import { expect, it, vi } from "vitest";
import { runWebScenario, webScenarios } from "../evals/web/scenario.ts";

it.each(webScenarios)("web runtime conformance: %s", async (scenario) => {
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("Unexpected real fetch"));
  try {
    await runWebScenario(scenario);
    expect(network).not.toHaveBeenCalled();
  } finally {
    network.mockRestore();
  }
});
