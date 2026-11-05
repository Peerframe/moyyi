import type { ToolContext } from "./tools.ts";

export interface SubagentRequest {
  /** Short label for the delegated task, shown to the owner. */
  readonly description: string;
  /** Complete, self-contained brief for the sub-agent. */
  readonly prompt: string;
}

export interface SubagentResult {
  /** The child session holding the sub-agent's full, recorded history. */
  readonly sessionId: string;
  readonly outcome: "completed" | "cancelled" | "budget_exhausted" | "failed";
  readonly reason?: string;
  /** The sub-agent's final answer text, bounded to the tool output limit. */
  readonly text: string;
  readonly truncated: boolean;
}

/** Runs one read-only sub-agent; supplied only to the `agent` tool at execution. */
export interface SubagentAccess {
  run(request: SubagentRequest): Promise<SubagentResult>;
}

export interface SubagentAccessFactory {
  create(context: ToolContext, assertAuthorized: () => void): SubagentAccess;
}
