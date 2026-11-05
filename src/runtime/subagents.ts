import type {
  ClientCommand,
  EffectId,
  RunId,
  RunOutcome,
  RuntimeEvent,
  SessionId,
  SessionStore,
  SubagentAccess,
  SubagentAccessFactory,
  SubagentRequest,
  SubagentResult,
  ToolContext,
} from "../contracts/index.ts";
import { pathToHead } from "../core/index.ts";

export interface SubagentLimits {
  /** Model requests per sub-agent run, including its final answer. */
  readonly maxRequests: number;
  readonly timeoutMs: number;
  /** Sub-agents running at once across the runtime. */
  readonly maxConcurrent: number;
  /** Sub-agents one parent run may start. */
  readonly maxPerRun: number;
}

export const DEFAULT_SUBAGENT_LIMITS: SubagentLimits = Object.freeze({
  maxRequests: 12,
  timeoutMs: 300_000,
  maxConcurrent: 4,
  maxPerRun: 16,
});

/** The child core's command entry point; it shares the store, model, policy and context. */
export interface SubagentCore {
  send(command: ClientCommand): Promise<void>;
}

/** Fixed brief wrapper; recorded as the child session's user message. */
export function subagentInput(request: SubagentRequest): string {
  return (
    `Sub-agent task from the main agent: ${request.description}\n\n${request.prompt}\n\n` +
    "You are a sub-agent with read-only tools and a fresh context. Investigate as needed, then " +
    "answer with a concise, self-contained report for the main agent: findings with file paths " +
    "and evidence, and anything you could not verify. Your final answer is returned to the main " +
    "agent; it does not reach the user directly."
  );
}

interface Waiter {
  runId?: RunId;
  finished?: (outcome: RunOutcome) => void;
}

/**
 * Runs read-only sub-agents in child sessions of the same store. The child core sees only
 * read-class tools (never `agent` itself), so a sub-agent cannot write, run commands, use the web
 * or start further sub-agents. Child events still reach clients, so approvals stay visible; the
 * replies that would switch a client's session are not forwarded.
 */
export class SubagentRunner implements SubagentAccessFactory {
  readonly #core: () => SubagentCore | undefined;
  readonly #store: () => SessionStore | undefined;
  readonly #limits: SubagentLimits;
  readonly #sessions = new Map<SessionId, Waiter>();
  readonly #runs = new Map<RunId, Waiter>();
  readonly #effects = new Set<EffectId>();
  readonly #perRun = new Map<RunId, number>();
  #created: SessionId | undefined;
  #creating: Promise<unknown> = Promise.resolve();
  #active = 0;
  readonly #queue: (() => void)[] = [];

  constructor(
    core: () => SubagentCore | undefined,
    store: () => SessionStore | undefined,
    limits: SubagentLimits,
  ) {
    this.#core = core;
    this.#store = store;
    this.#limits = limits;
  }

  /** Observes every child-core event; returns whether it may reach clients. */
  observe(event: RuntimeEvent): boolean {
    switch (event.type) {
      case "session.ready":
        this.#created = event.sessionId;
        return false;
      case "session.listed":
      case "session.results":
      case "command.rejected":
        return false;
      case "run.started": {
        const waiter = this.#sessions.get(event.sessionId);
        if (waiter) {
          waiter.runId = event.runId;
          this.#runs.set(event.runId, waiter);
        }
        return true;
      }
      case "effect.updated":
        this.#effects.add(event.effect.id);
        return true;
      case "run.finished": {
        const waiter = this.#runs.get(event.runId);
        this.#runs.delete(event.runId);
        waiter?.finished?.(event.outcome);
        return true;
      }
      default:
        return true;
    }
  }

  /** Whether an approval belongs to a sub-agent run, so the response goes to the child core. */
  owns(effectId: EffectId): boolean {
    return this.#effects.has(effectId);
  }

  create(context: ToolContext, assertAuthorized: () => void): SubagentAccess {
    return Object.freeze({
      run: async (request: SubagentRequest): Promise<SubagentResult> => {
        assertAuthorized();
        const started = this.#perRun.get(context.runId) ?? 0;
        if (started >= this.#limits.maxPerRun)
          throw Error(`This run already started ${this.#limits.maxPerRun} sub-agents`);
        this.#perRun.set(context.runId, started + 1);
        await this.#acquire(context.signal);
        try {
          return await this.#run(context, request);
        } finally {
          this.#release();
        }
      },
    });
  }

  async #acquire(signal: AbortSignal): Promise<void> {
    if (this.#active < this.#limits.maxConcurrent) {
      this.#active++;
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const ready = () => {
        signal.removeEventListener("abort", aborted);
        this.#active++;
        resolve();
      };
      const aborted = () => {
        const index = this.#queue.indexOf(ready);
        if (index >= 0) this.#queue.splice(index, 1);
        reject(Error("Sub-agent cancelled before it started"));
      };
      this.#queue.push(ready);
      signal.addEventListener("abort", aborted, { once: true });
    });
  }

  #release(): void {
    this.#active--;
    this.#queue.shift()?.();
  }

  async #run(context: ToolContext, request: SubagentRequest): Promise<SubagentResult> {
    const core = this.#core();
    const store = this.#store();
    if (!core || !store) throw Error("Sub-agents are unavailable");
    context.signal.throwIfAborted();
    // Creations are serialized so each `session.ready` belongs to exactly one sub-agent.
    const created = this.#creating.then(async () => {
      this.#created = undefined;
      await core.send({ type: "session.create", workspaceRoot: context.workspaceRoot });
      return this.#created as SessionId | undefined;
    });
    this.#creating = created.catch(() => undefined);
    const sessionId = await created;
    if (!sessionId) throw Error("Sub-agent session could not be created");
    const waiter: Waiter = {};
    this.#sessions.set(sessionId, waiter);
    try {
      const outcome = new Promise<RunOutcome>((resolve) => {
        waiter.finished = resolve;
      });
      await core.send({
        type: "run.start",
        sessionId,
        input: [{ type: "text", text: subagentInput(request) }],
      });
      const runId = waiter.runId;
      if (!runId) throw Error("Sub-agent run could not start");
      const cancel = () => void core.send({ type: "run.cancel", runId });
      context.signal.addEventListener("abort", cancel, { once: true });
      if (context.signal.aborted) cancel();
      let result: RunOutcome;
      try {
        result = await outcome;
      } finally {
        context.signal.removeEventListener("abort", cancel);
      }
      const snapshot = await store.loadSession(sessionId);
      const answer = snapshot
        ? pathToHead(snapshot)
            .filter((entry) => entry.runId === runId && entry.body.kind === "assistant_message")
            .flatMap((entry) =>
              entry.body.kind === "assistant_message"
                ? [
                    entry.body.content
                      .filter((part) => part.type === "text" || part.type === "refusal")
                      .map((part) => part.text)
                      .join(""),
                  ]
                : [],
            )
            .filter((text) => text.trim())
            .at(-1)
        : undefined;
      const bounded = boundUtf8(answer ?? "", context.limits.maxOutputBytes);
      return {
        sessionId,
        outcome: result.kind,
        ...(result.kind === "failed"
          ? { reason: result.reason }
          : result.kind === "budget_exhausted"
            ? { reason: `budget exhausted: ${result.budget}` }
            : {}),
        ...bounded,
      };
    } finally {
      this.#sessions.delete(sessionId);
    }
  }
}

function boundUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= maxBytes) return { text, truncated: false };
  let end = maxBytes;
  while (end > 0 && ((bytes[end] as number) & 0xc0) === 0x80) end--;
  return { text: bytes.subarray(0, end).toString("utf8"), truncated: true };
}
