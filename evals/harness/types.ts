/**
 * Eval tasks are judged on final state, never on the transcript. The checker is hidden from
 * the agent: it runs after the agent finishes, against the workspace it left behind.
 */
export interface EvalTask {
  readonly id: string;
  readonly title: string;
  readonly category: TaskCategory;
  /** "real": rewritten from something the owner actually asked for; "invented": made up. */
  readonly source: "real" | "invented";
  /** Where a real task came from, without private details. */
  readonly origin?: string;
  /** Failure modes the task is designed to expose. */
  readonly probes: readonly FailureProbe[];
  /**
   * `complete`: the task can be done. `stop_and_report`: it cannot be done as asked, and the
   * right outcome is to stop, leave protected files alone and say so.
   */
  readonly expect: "complete" | "stop_and_report";
  /** Written the way the owner would type it. */
  readonly instruction: string;
  /** Directory copied into a fresh workspace for every trial. */
  readonly fixtureDir: string;
  readonly budget: Budget;
  check(workspace: string): Promise<CheckResult>;
  /**
   * A correct solution applied directly to a workspace. Used only by the harness's own tests,
   * to prove the checker passes a right answer. Never shown to an agent.
   */
  reference(workspace: string): Promise<void>;
}

export type TaskCategory = "coding" | "website" | "documents" | "data" | "files" | "research";

export type FailureProbe =
  /** Claims to be done when part of the request is missing. */
  | "false_done"
  /** Changes or deletes things it was told to keep. */
  | "collateral_damage"
  /** Loses a constraint stated early in the request. */
  | "forgotten_constraint"
  /** Keeps trying instead of stopping and reporting. */
  | "no_stop";

export interface Budget {
  readonly timeoutMs: number;
  readonly maxModelRequests: number;
}

export interface CheckResult {
  readonly passed: boolean;
  readonly details: string;
}

/** Anything that can attempt a task: moyyi itself, a baseline harness, or a test double. */
export interface AgentUnderTest {
  readonly name: string;
  run(input: AgentInput): Promise<AgentReport>;
}

export interface AgentInput {
  readonly workspace: string;
  readonly instruction: string;
  readonly budget: Budget;
  readonly signal: AbortSignal;
}

export interface AgentReport {
  /** What the agent told the user: true = "done", false = "could not", null = said nothing. */
  readonly claimedSuccess: boolean | null;
  readonly modelRequests?: number;
  readonly costUsd?: number;
}

export interface TrialResult {
  readonly taskId: string;
  readonly agent: string;
  readonly trial: number;
  readonly passed: boolean;
  readonly claimedSuccess: boolean | null;
  /** Claimed done but the checker failed: the most trust-damaging outcome. */
  readonly falseSuccess: boolean;
  /** Changes detected outside the workspace. Must be empty. */
  readonly forbiddenEffects: readonly string[];
  readonly timedOut: boolean;
  readonly durationMs: number;
  readonly details: string;
}

export interface SuiteSummary {
  readonly agent: string;
  readonly trialsPerTask: number;
  readonly tasks: number;
  /** Mean single-trial pass rate. */
  readonly passAt1: number;
  /** Share of tasks where every trial passed (pass^k). */
  readonly passAllK: number;
  readonly falseSuccesses: number;
  readonly forbiddenEffects: number;
}
