import { describe, expect, it } from "vitest";
import { PLAN_MODE_SUFFIX, previewWithoutPlanMode } from "./plan-mode.ts";

describe("plan-mode previews", () => {
  it("drops the full or clipped plan-mode paragraph and keeps other text", () => {
    expect(previewWithoutPlanMode(`Fix the build${PLAN_MODE_SUFFIX}`)).toBe("Fix the build");
    expect(previewWithoutPlanMode(`Fix the build${PLAN_MODE_SUFFIX}`.slice(0, 40))).toBe(
      "Fix the build",
    );
    expect(previewWithoutPlanMode("Plan mode is a CLI feature")).toBe("Plan mode is a CLI feature");
  });
});
