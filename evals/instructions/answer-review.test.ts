import { describe, expect, it } from "vitest";
import { runAnswerReviewScenario } from "./answer-review.ts";

describe("isolated evidence through actual runtime and files", () => {
  it("delivers opposite source lifetimes to the two isolated stages without a draft", async () => {
    expect(await runAnswerReviewScenario()).toMatchObject({
      requests: 4,
      semanticQuality: "not measured",
    });
  });
  it("refuses fabricated provenance before any final request and does not retry", async () => {
    expect(await runAnswerReviewScenario(true)).toMatchObject({ requests: 3, noReplay: true });
  });
});
