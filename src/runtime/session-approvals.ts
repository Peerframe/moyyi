import type {
  EffectId,
  PolicyDecision,
  RunId,
  RuntimeEvent,
  SessionId,
} from "../contracts/index.ts";

/** A remembered approval: a whole tool, or for `shell` one exact command line. */
export interface SessionRule {
  readonly tool: string;
  readonly command?: string;
}

const MAX_RULES_PER_SESSION = 64;

function commandOf(tool: string, args: unknown): string | undefined {
  if (tool !== "shell" || typeof args !== "object" || args === null) return undefined;
  const command = (args as { command?: unknown }).command;
  return typeof command === "string" ? command : undefined;
}

/**
 * "Always allow in this session": the owner approves one displayed action and asks that
 * similar actions in the same session stop asking. Rules live only in this runtime's memory and
 * are dropped when the session is loaded again or the runtime closes. A rule can only turn the
 * base policy's `ask` into `allow`; it never overrides a denial, a missing grant or a stricter
 * plugin rule, and revoking a grant still denies.
 */
export class SessionApprovals {
  readonly #runSession = new Map<RunId, SessionId>();
  readonly #effectRun = new Map<EffectId, RunId>();
  readonly #asked = new Map<EffectId, SessionRule>();
  readonly #rules = new Map<SessionId, SessionRule[]>();

  observe(event: RuntimeEvent): void {
    if (event.type === "run.started") this.#runSession.set(event.runId, event.sessionId);
    else if (event.type === "effect.updated")
      this.#effectRun.set(event.effect.id, event.effect.runId);
    else if (event.type === "run.finished") {
      this.#runSession.delete(event.runId);
      for (const [effect, run] of this.#effectRun)
        if (run === event.runId) {
          this.#effectRun.delete(effect);
          this.#asked.delete(effect);
        }
    }
  }

  /** The session an effect's run belongs to, when this runtime started that run. */
  sessionOf(effectId: EffectId): SessionId | undefined {
    return this.#session(effectId);
  }

  #session(effectId: EffectId): SessionId | undefined {
    const run = this.#effectRun.get(effectId);
    return run === undefined ? undefined : this.#runSession.get(run);
  }

  /** Applies remembered rules to the base policy's execute decision. */
  lift(decision: PolicyDecision, tool: string, effectId: EffectId, args: unknown): PolicyDecision {
    if (decision.kind !== "ask") return decision;
    const command = commandOf(tool, args);
    // Shell rules need the exact command; a shell call without one is never remembered.
    if (tool === "shell" && command === undefined) return decision;
    this.#asked.set(effectId, { tool, ...(command === undefined ? {} : { command }) });
    const session = this.#session(effectId);
    const rules = session === undefined ? undefined : this.#rules.get(session);
    return rules?.some(
      (rule) => rule.tool === tool && (rule.command === undefined || rule.command === command),
    )
      ? { kind: "allow" }
      : decision;
  }

  /** Remembers the rule for an approval that was just accepted; returns it, if any. */
  remember(effectId: EffectId): SessionRule | undefined {
    const rule = this.#asked.get(effectId);
    const session = this.#session(effectId);
    if (!rule || session === undefined) return undefined;
    const rules = this.#rules.get(session) ?? [];
    if (
      !rules.some((item) => item.tool === rule.tool && item.command === rule.command) &&
      rules.length < MAX_RULES_PER_SESSION
    )
      rules.push(rule);
    this.#rules.set(session, rules);
    return rule;
  }

  forget(session: SessionId): void {
    this.#rules.delete(session);
  }

  rules(session: SessionId): readonly SessionRule[] {
    return [...(this.#rules.get(session) ?? [])];
  }
}
