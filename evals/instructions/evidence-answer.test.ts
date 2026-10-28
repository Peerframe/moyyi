import { describe, expect, it } from "vitest";
import { runEvidenceAnswerScenario } from "./evidence-answer.ts";

describe("direct evidence answer with actual runtime and unrelated source files", () => {
  for (const dataflow of [false, true])
    it(`preserves opposing ${dataflow ? "dataflow" : "lifecycle"} evidence without the draft`, async () => {
      expect(await runEvidenceAnswerScenario(dataflow)).toMatchObject({
        requests: 3,
        sourceUnchanged: true,
        noReplay: true,
        semanticQuality: "not measured",
      });
    });
});
