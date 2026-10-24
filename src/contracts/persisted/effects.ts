import type { ActionDigest, EffectId, RunId, Timestamp, ToolCallId } from "./ids.ts";

/**
 * Every tool declares what kind of effect it can have. Approval, journaling, sandboxing and
 * recovery requirements are derived from this profile instead of being decided per tool.
 */
export interface EffectProfile {
  readonly class: EffectClass;
  /** How a completed effect can be undone by the user, if at all. */
  readonly reversibility: "not_applicable" | "snapshot" | "none";
  /** How an interrupted effect can be checked after a crash. */
  readonly verification: "not_applicable" | "precondition" | "postcheck" | "none";
}

export type EffectClass =
  /** Observes state only. */
  | "read"
  /** Changes files inside an authorized workspace. */
  | "workspace_write"
  /** Runs a process whose effects cannot be enumerated in advance. */
  | "process"
  /** Changes state outside the machine (network writes, messages, purchases). */
  | "external";

/**
 * Journal state of one effect. A record is written in `intended` before anything runs, and the
 * transition to `started` is committed before the side effect begins. A crash after `started`
 * therefore always surfaces as `unknown`; it is never replayed automatically.
 */
export type EffectState =
  | "intended"
  | "awaiting_approval"
  | "approved"
  | "denied"
  | "started"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "unknown";

export const effectTransitions: Readonly<Record<EffectState, readonly EffectState[]>> = {
  intended: ["awaiting_approval", "approved", "denied", "cancelled"],
  awaiting_approval: ["approved", "denied", "cancelled"],
  // Re-approval is required when preconditions changed after approval.
  approved: ["started", "awaiting_approval", "cancelled"],
  denied: [],
  started: ["succeeded", "failed", "unknown"],
  succeeded: [],
  failed: [],
  cancelled: [],
  // Reconciliation may resolve an unknown effect once evidence is found.
  unknown: ["succeeded", "failed"],
};

export function canTransition(from: EffectState, to: EffectState): boolean {
  return effectTransitions[from].includes(to);
}

export function isTerminal(state: EffectState): boolean {
  return effectTransitions[state].length === 0;
}

export interface EffectRecord {
  readonly id: EffectId;
  readonly runId: RunId;
  readonly callId: ToolCallId;
  readonly tool: string;
  readonly profile: EffectProfile;
  readonly digest: ActionDigest;
  readonly state: EffectState;
  readonly updatedAt: Timestamp;
  /** Free-form evidence from execution or reconciliation, shown to the user. */
  readonly evidence?: string;
}
