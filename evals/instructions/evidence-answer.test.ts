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
  for (const dataflow of [false, true])
    it(`reserves final-answer time while preserving ${dataflow ? "dataflow" : "lifecycle"} observations`, async () => {
      expect(await runEvidenceAnswerScenario(dataflow, true)).toMatchObject({
        requests: 3,
        investigationMs: 100_000,
        elapsedMs: 150_000,
        timeoutMs: 300_000,
        sourceUnchanged: true,
        noReplay: true,
        semanticQuality: "not measured",
      });
    });
});
