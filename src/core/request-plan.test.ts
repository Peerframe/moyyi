import { describe, expect, it } from "vitest";
import { type ContentPart, type StopReason, UNKNOWN_USAGE } from "../contracts/index.ts";
import {
  answerState,
  evidenceAnswerNotice,
  finishedOutcome,
  planRequest,
  type RequestPlanInput,
  requestBudgetNotice,
} from "./request-plan.ts";
import type { Response } from "./response.ts";

const base: RequestPlanInput = {
  maxModelRequests: 4,
  requests: 0,
  evidenceAnswerEnabled: false,
  draftReady: false,
  investigationExpired: false,
};

function response(
  stopReason: StopReason,
  parts: ContentPart[] = [{ type: "text", text: "answer" }],
  error?: Response["error"],
): Response {
  return {
    parts,
    partial: false,
    stopReason,
    providerStopReason: null,
    usage: UNKNOWN_USAGE,
    signalInterrupted: false,
    settled: Promise.resolve(),
    ...(error ? { error } : {}),
  };
}

describe("request phase plan", () => {
  it("reserves only the last request for the answer when evidence answer is off", () => {
    expect([0, 1, 2, 3].map((requests) => planRequest({ ...base, requests }))).toEqual([
      { remaining: 4, finalRequest: false },
      { remaining: 3, finalRequest: false },
      { remaining: 2, finalRequest: false },
      { remaining: 1, finalRequest: true },
    ]);
  });

  it("ignores draft and deadline signals unless evidence answer is enabled", () => {
    expect(planRequest({ ...base, draftReady: true, investigationExpired: true })).toEqual({
      remaining: 4,
      finalRequest: false,
    });
  });

  it("starts the evidence answer early, naming the first applicable reason", () => {
    const on = { ...base, evidenceAnswerEnabled: true };
    expect(planRequest({ ...on, requests: 1 })).toEqual({ remaining: 3, finalRequest: false });
    expect(planRequest({ ...on, requests: 3 })).toEqual({
      remaining: 1,
      finalRequest: true,
      evidenceAnswer: "last request",
    });
    expect(planRequest({ ...on, requests: 1, investigationExpired: true })).toEqual({
      remaining: 3,
      finalRequest: true,
      evidenceAnswer: "investigation time elapsed",
    });
    expect(
      planRequest({ ...on, requests: 3, draftReady: true, investigationExpired: true }),
    ).toEqual({ remaining: 1, finalRequest: true, evidenceAnswer: "draft ready" });
  });
});

describe("model-visible budget notices", () => {
  it("counts attempts and tool-enabled requests from the plan", () => {
    const first = requestBudgetNotice(planRequest(base), 4);
    expect(first).toMatch(
      /^Model request budget: attempt 1 of 4; 4 request\(s\) remaining including this one\. 3 tool-enabled request\(s\) remain/u,
    );
    expect(first).toContain("Reserve the final request for an answer.");
    const lastTools = requestBudgetNotice(planRequest({ ...base, requests: 2 }), 4);
    expect(lastTools).toContain("attempt 3 of 4; 2 request(s) remaining");
    expect(lastTools).toContain("This is the last tool-enabled request.");
    const final = requestBudgetNotice(planRequest({ ...base, requests: 3 }), 4);
    expect(final).toContain("attempt 4 of 4; 1 request(s) remaining including this one. 0 tool");
    expect(final).toContain("This is the final request. New tool calls are disabled.");
  });

  it("reports zero tool-enabled requests when an evidence answer starts early", () => {
    const plan = planRequest({ ...base, evidenceAnswerEnabled: true, draftReady: true });
    expect(requestBudgetNotice(plan, 4)).toContain(
      "attempt 1 of 4; 4 request(s) remaining including this one. 0 tool-enabled",
    );
    expect(evidenceAnswerNotice("draft ready")).toMatch(
      /^Evidence answer: draft ready\. One tool-free answer .* This is not task acceptance\.$/u,
    );
  });
});

describe("finished response outcome", () => {
  it("completes only a finished turn with nonblank answer text and no calls", () => {
    expect(finishedOutcome(response("end_turn"), false, 0)).toEqual({ kind: "completed" });
    expect(
      finishedOutcome(response("refusal", [{ type: "refusal", text: "no" }]), true, 0),
    ).toEqual({ kind: "completed" });
  });

  it("never reports an error, cap, incomplete stop, unpaired call or blank text as completed", () => {
    const blank = response("end_turn", [{ type: "text", text: "  " }]);
    expect(
      finishedOutcome(
        response("end_turn", [], {
          kind: "network",
          message: "lost",
          partialOutput: false,
          usage: UNKNOWN_USAGE,
        }),
        false,
        0,
      ),
    ).toEqual({ kind: "failed", reason: "lost" });
    expect(finishedOutcome(response("max_tokens"), true, 0)).toEqual({
      kind: "budget_exhausted",
      budget: "model_output_tokens",
    });
    expect(finishedOutcome(blank, true, 0)).toEqual({
      kind: "budget_exhausted",
      budget: "model_requests",
    });
    expect(finishedOutcome(response("other"), false, 0)).toEqual({
      kind: "failed",
      reason: "Model response did not complete (stop reason: other)",
    });
    expect(finishedOutcome(response("end_turn"), false, 1)).toEqual({
      kind: "failed",
      reason: "Model response ended without completing its tool calls",
    });
    expect(finishedOutcome(blank, false, 0)).toEqual({
      kind: "failed",
      reason: "Model response contained no answer text",
    });
  });

  it("does not count reasoning as an answer", () => {
    expect(
      answerState(response("end_turn", [{ type: "reasoning", kind: "visible", text: "thinking" }])),
    ).toEqual({ completeStop: true, hasAnswer: false });
  });
});

describe("opt-in final-answer accounting", () => {
  it("appends the accounting request only to the answer-only notice", async () => {
    const { FINAL_ACCOUNTING } = await import("./request-plan.ts");
    const final = planRequest({ ...base, requests: 3 });
    const middle = planRequest({ ...base, requests: 1 });
    expect(requestBudgetNotice(final, 4, true).endsWith(FINAL_ACCOUNTING)).toBe(true);
    expect(requestBudgetNotice(final, 4)).not.toContain("account for it");
    expect(requestBudgetNotice(middle, 4, true)).toBe(requestBudgetNotice(middle, 4));
  });
});
