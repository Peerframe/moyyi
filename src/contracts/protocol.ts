import type {
  ActionDigest,
  ContentPart,
  EffectId,
  EffectRecord,
  RunId,
  SessionId,
  TranscriptEntry,
} from "./persisted/index.ts";

/**
 * The only entry point for clients (CLI, programmatic callers, future GUI). It is a message
 * protocol rather than a function API so the runtime can later move behind a process boundary
 * by changing the transport only.
 */
export type ClientCommand =
  | { readonly type: "session.create"; readonly workspaceRoot: string }
  | { readonly type: "session.load"; readonly sessionId: SessionId }
  | {
      readonly type: "run.start";
      readonly sessionId: SessionId;
      readonly input: readonly ContentPart[];
    }
  | { readonly type: "run.steer"; readonly runId: RunId; readonly input: readonly ContentPart[] }
  | { readonly type: "run.cancel"; readonly runId: RunId }
  | {
      readonly type: "approval.respond";
      readonly effectId: EffectId;
      /** Must match the digest that was shown; a stale approval is rejected. */
      readonly digest: ActionDigest;
      readonly decision: "approve" | "deny";
    };

export type RuntimeEvent =
  | { readonly type: "session.ready"; readonly sessionId: SessionId }
  | { readonly type: "run.started"; readonly runId: RunId; readonly sessionId: SessionId }
  | { readonly type: "assistant.delta"; readonly runId: RunId; readonly text: string }
  | { readonly type: "entry.appended"; readonly entry: TranscriptEntry }
  | {
      readonly type: "approval.requested";
      readonly effectId: EffectId;
      readonly digest: ActionDigest;
      readonly summary: string;
      readonly preview?: string;
    }
  | { readonly type: "effect.updated"; readonly effect: EffectRecord }
  | { readonly type: "run.finished"; readonly runId: RunId; readonly outcome: RunOutcome }
  | { readonly type: "command.rejected"; readonly command: string; readonly reason: string };

export type RunOutcome =
  | { readonly kind: "completed" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "budget_exhausted"; readonly budget: string }
  | { readonly kind: "failed"; readonly reason: string };
