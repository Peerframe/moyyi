import type { RunOutcome } from "../contracts/index.ts";
import type { Response } from "./response.ts";

/**
 * Pure decisions the run loop makes around each model request: which phase the next request
 * belongs to, the fixed notice text the model sees about its budget, and how a response that
 * ends the run maps to an outcome. Keeping them here makes the request budget testable as a
 * table and keeps model-visible wording out of the loop's control flow.
 */

export type EvidenceAnswerReason = "draft ready" | "investigation time elapsed" | "last request";

export interface RequestPlanInput {
  readonly maxModelRequests: number;
  /** Requests already sent in this run, including retries. */
  readonly requests: number;
  readonly evidenceAnswerEnabled: boolean;
  /** The previous tool-free response was a complete draft answer. */
  readonly draftReady: boolean;
  /** The investigation phase deadline has passed. */
  readonly investigationExpired: boolean;
}

export interface RequestPlan {
  /** Requests left including the one being planned. */
  readonly remaining: number;
  /** No tools may run in this request; it is reserved for the answer. */
  readonly finalRequest: boolean;
  /** Present when this request is the fresh, tool-free evidence answer. */
  readonly evidenceAnswer?: EvidenceAnswerReason;
}

/** Callers check `requests < maxModelRequests` first; this plans the request about to be sent. */
export function planRequest(input: RequestPlanInput): RequestPlan {
  const remaining = input.maxModelRequests - input.requests;
  const reason: EvidenceAnswerReason | undefined = !input.evidenceAnswerEnabled
    ? undefined
    : input.draftReady
      ? "draft ready"
      : input.investigationExpired
        ? "investigation time elapsed"
        : remaining === 1
          ? "last request"
          : undefined;
  return {
    remaining,
    finalRequest: remaining === 1 || reason !== undefined,
    ...(reason ? { evidenceAnswer: reason } : {}),
  };
}

export function evidenceAnswerNotice(reason: EvidenceAnswerReason): string {
  return (
    `Evidence answer: ${reason}. ` +
    "One tool-free answer from the original question and recorded observations follows within the existing budget. " +
    "Earlier assistant text is retained as investigation, not supplied to this request. This is not task acceptance."
  );
}

export function requestBudgetNotice(plan: RequestPlan, maxModelRequests: number): string {
  const { remaining, finalRequest } = plan;
  return (
    `Model request budget: attempt ${maxModelRequests - remaining + 1} of ${maxModelRequests}; ` +
    `${remaining} request(s) remaining including this one. ` +
    `${finalRequest ? 0 : remaining - 1} tool-enabled request(s) remain before the answer-only final request. ` +
    (finalRequest
      ? "This is the final request. New tool calls are disabled. Give the user your final answer " +
        "using only evidence already available. Distinguish verified findings, incomplete work " +
        "and uncertainty; do not invent results or claim unperformed actions. If evidence is " +
        "insufficient, explain the partial result and what remains unverified."
      : remaining === 2
        ? "This is the last tool-enabled request. Complete any still-required artifact creation " +
          "and verification in this tool batch; the next request cannot use tools. A proposed " +
          "artifact in chat is not a created file. Retries consume this same budget. This notice " +
          "does not grant permissions or override user constraints."
        : "Reserve the final request for an answer. Gather necessary evidence; group independent " +
          "reads; finish early when ready. Retries use this budget. Existing permissions and " +
          "user constraints apply.")
  );
}

/** Fixed tool-result text for calls the loop pairs without executing them. */
export const unexecutedCallText = {
  investigationElapsed: "Investigation time elapsed; tool was not executed.",
  finalRequest: "Tool was not executed: the final model request is reserved for an answer.",
  incompleteTurn: "Tool was not executed: assistant did not complete a tool-use turn.",
} as const;

export interface AnswerState {
  /** The provider reported a finished turn (`end_turn` or `refusal`). */
  readonly completeStop: boolean;
  /** At least one nonblank text or refusal part. */
  readonly hasAnswer: boolean;
}

export function answerState(response: Response): AnswerState {
  return {
    completeStop: ["end_turn", "refusal"].includes(response.stopReason),
    hasAnswer: response.parts.some(
      (part) => (part.type === "text" || part.type === "refusal") && part.text.trim().length > 0,
    ),
  };
}

/**
 * Outcome of a response that ends the run without executing tools. A stream terminal is not
 * necessarily an answer: errors, output caps, incomplete stops, unpaired calls and empty text
 * are never reported as completed.
 */
export function finishedOutcome(
  response: Response,
  finalRequest: boolean,
  callCount: number,
): RunOutcome {
  const { completeStop, hasAnswer } = answerState(response);
  if (response.error) return { kind: "failed", reason: response.error.message };
  // The provider's output ceiling remains the cause even on the last allowed request.
  if (response.stopReason === "max_tokens")
    return { kind: "budget_exhausted", budget: "model_output_tokens" };
  if (finalRequest && (!completeStop || !hasAnswer))
    return { kind: "budget_exhausted", budget: "model_requests" };
  if (!completeStop)
    return {
      kind: "failed",
      reason: `Model response did not complete (stop reason: ${response.stopReason})`,
    };
  if (callCount)
    return { kind: "failed", reason: "Model response ended without completing its tool calls" };
  if (!hasAnswer) return { kind: "failed", reason: "Model response contained no answer text" };
  return { kind: "completed" };
}
