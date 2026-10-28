import {
  type ActionHasher,
  type ArgumentValidator,
  type ClientCommand,
  type Clock,
  type ContentPart,
  type ContextBuilder,
  type ContextInput,
  type ContextSection,
  canonicalizeJson,
  type EffectId,
  type EffectRecord,
  type EntryBody,
  type EntryId,
  type IdSource,
  isTerminal,
  type ModelClient,
  type ModelProfile,
  type ModelRequest,
  type PermissionPolicy,
  type PreconditionVerifier,
  type PreparedAction,
  type RenderedRequestRef,
  type RunId,
  type RunLimits,
  type RunOutcome,
  type RuntimeEvent,
  type Scheduler,
  type SessionId,
  type SessionSnapshot,
  type SessionStore,
  type ToolCallPart,
  type ToolDefinition,
  type ToolResultPart,
  type TranscriptEntry,
  type WebAccessFactory,
  type WorkspaceDocumentsFactory,
  type WorkspaceFilesFactory,
  type WorkspaceProcessesFactory,
  type WorkspaceWritesFactory,
} from "../contracts/index.ts";
import { type ExecutionHost, executeCalls } from "./executor.ts";
import { recoverSession } from "./recovery.ts";
import { consumeResponse, type Response } from "./response.ts";

export const DEFAULT_LIMITS: RunLimits = Object.freeze({
  maxModelRequests: 12,
  timeoutMs: 60_000,
  maxInputBytes: 64 * 1024,
  maxModelResponseBytes: 1024 * 1024,
  maxToolOutputBytes: 32 * 1024,
  maxRetries: 2,
  maxParallelReads: 4,
});

export interface CoreDeps {
  readonly model: ModelClient;
  readonly profile: ModelProfile;
  readonly tools: readonly ToolDefinition[];
  readonly store: SessionStore;
  readonly context: ContextBuilder;
  readonly policy: PermissionPolicy;
  readonly validator: ArgumentValidator;
  readonly preconditions: PreconditionVerifier;
  readonly hasher: ActionHasher;
  readonly scheduler: Scheduler;
  readonly clock: Clock;
  readonly ids: IdSource;
  readonly emit: (event: RuntimeEvent) => void;
  readonly collect?: (
    workspaceRoot: string,
    signal: AbortSignal,
  ) => Promise<readonly ContextSection[]>;
  readonly limits?: Partial<RunLimits>;
  /** Experimental fresh-session evidence-only final answer; shares the existing run budget. */
  readonly evidenceAnswer?: boolean;
  readonly files?: WorkspaceFilesFactory;
  readonly documents?: WorkspaceDocumentsFactory;
  readonly processes?: WorkspaceProcessesFactory;
  readonly writes?: WorkspaceWritesFactory;
  readonly web?: WebAccessFactory;
}

interface Running {
  readonly kind: "conversation" | "compaction";
  readonly id: RunId;
  readonly sessionId: SessionId;
  readonly workspaceRoot: string;
  readonly controller: AbortController;
  readonly effects: Map<EffectId, EffectRecord>;
  readonly resultIds: Set<string>;
  head: EntryId | null;
  queue: Promise<void>;
  done: Promise<void>;
  deadlineExpired: boolean;
  requests: number;
  leased: boolean;
  finishing: boolean;
  steeringRevision: number;
  pendingSteering: number;
  stopTimer: () => void;
  startedAt: number;
}
interface PendingApproval {
  readonly run: Running;
  readonly digest: string;
  readonly revision: number;
  readonly resolve: (accepted: boolean) => void;
}

/** Owns execution and persistence ordering. External work is reached only through ports. */
export class AgentCore {
  readonly #deps: CoreDeps;
  readonly #limits: RunLimits;
  readonly #running = new Map<RunId, Running>();
  readonly #starting = new Set<SessionId>();
  readonly #approvals = new Map<EffectId, PendingApproval>();
  #closed = false;

  constructor(deps: CoreDeps) {
    this.#deps = deps;
    this.#limits = { ...DEFAULT_LIMITS, ...deps.limits };
    for (const [name, value] of Object.entries(this.#limits)) {
      if (!Number.isSafeInteger(value) || value < (name === "maxRetries" ? 0 : 1))
        throw new Error(`Invalid limit: ${name}`);
    }
    if (this.#limits.maxToolOutputBytes < 64)
      throw new Error("Tool output limit must be at least 64 bytes");
    if (new Set(deps.tools.map((tool) => tool.name)).size !== deps.tools.length)
      throw new Error("Duplicate tool names");
    if (deps.evidenceAnswer !== undefined && typeof deps.evidenceAnswer !== "boolean")
      throw new Error("Evidence answer must be a boolean");
    if (
      deps.evidenceAnswer &&
      (!deps.context.buildEvidenceAnswer || this.#limits.maxModelRequests < 2)
    )
      throw new Error("Evidence answer requires a context port and at least two total requests");
  }

  async recover(): Promise<void> {
    if (this.#running.size) throw new Error("Recovery cannot run while active");
    for (const sessionId of await this.#deps.store.listSessions()) {
      const snapshot = await this.#deps.store.loadSession(sessionId);
      if (snapshot) await recoverSession(snapshot, this.#deps, this.#limits);
    }
  }

  async send(command: ClientCommand): Promise<void> {
    try {
      if (this.#closed) throw new Error("Runtime is closed");
      switch (command.type) {
        case "session.create": {
          const sessionId = this.#deps.ids.next("session") as SessionId;
          await this.#deps.store.commit({
            entries: [],
            effects: [],
            durability: "normal",
            sessions: [{ sessionId, workspaceRoot: command.workspaceRoot, headEntryId: null }],
          });
          this.#emit({ type: "session.ready", sessionId });
          break;
        }
        case "session.load": {
          const snapshot = await this.#session(command.sessionId);
          this.#emit({ type: "session.ready", sessionId: snapshot.sessionId });
          for (const entry of snapshot.entries) this.#emit({ type: "entry.appended", entry });
          break;
        }
        case "session.compact":
          await this.#start(command.sessionId, [], true);
          break;
        case "run.start":
          await this.#start(command.sessionId, command.input);
          break;
        case "run.cancel":
          this.#run(command.runId).controller.abort();
          break;
        case "run.steer": {
          const run = this.#run(command.runId);
          if (this.#deps.evidenceAnswer)
            throw new Error(
              "Evidence answer cannot accept steering. Cancel and start a new self-contained session.",
            );
          if (run.kind === "compaction")
            throw new Error("Compaction cannot accept steering; wait or cancel it");
          if (run.controller.signal.aborted || run.finishing) throw new Error("Run is stopping");
          const content = userContent(command.input, this.#limits.maxInputBytes);
          run.pendingSteering++;
          try {
            await this.#append(run, { kind: "user_message", steering: true, content });
          } finally {
            run.pendingSteering--;
          }
          break;
        }
        case "approval.respond": {
          const pending = this.#approvals.get(command.effectId);
          if (!pending || pending.digest !== command.digest)
            throw new Error("Unknown or stale approval digest");
          if (
            pending.run.controller.signal.aborted ||
            pending.revision !== (this.#deps.policy.revision?.() ?? 0)
          ) {
            pending.resolve(false);
            throw new Error("Approval was revoked or cancelled");
          }
          if (command.decision !== "approve" && command.decision !== "deny")
            throw new Error("Invalid approval decision");
          pending.resolve(command.decision === "approve");
          break;
        }
      }
    } catch (error) {
      this.#emit({ type: "command.rejected", command: command.type, reason: errorMessage(error) });
    }
  }

  async idle(): Promise<void> {
    while (this.#running.size)
      await Promise.all([...this.#running.values()].map((run) => run.done));
  }
  async close(): Promise<void> {
    this.#closed = true;
    for (const run of this.#running.values()) run.controller.abort();
    await this.idle();
  }
  async #session(id: SessionId): Promise<SessionSnapshot> {
    const snapshot = await this.#deps.store.loadSession(id);
    if (!snapshot) throw new Error("Session does not exist");
    return snapshot;
  }
  #run(id: RunId): Running {
    const run = this.#running.get(id);
    if (!run) throw new Error("Run is not active");
    return run;
  }

  async #start(
    sessionId: SessionId,
    input: readonly ContentPart[],
    compact = false,
  ): Promise<void> {
    if (
      this.#starting.has(sessionId) ||
      [...this.#running.values()].some((run) => run.sessionId === sessionId)
    )
      throw new Error("Session already has an active run");
    this.#starting.add(sessionId);
    try {
      const content = compact ? [] : userContent(input, this.#limits.maxInputBytes);
      const snapshot = await this.#session(sessionId);
      if (
        !compact &&
        this.#deps.evidenceAnswer &&
        snapshot.entries.some((entry) => entry.body.kind === "user_message")
      )
        throw new Error(
          "Evidence answer requires a new session. Disable it to continue this conversation; history was not changed.",
        );
      if (snapshot.runs.some((run) => run.status === "active"))
        throw new Error("Session requires startup recovery");
      if (this.#closed) throw new Error("Runtime is closing");
      const id = this.#deps.ids.next("run") as RunId;
      const run: Running = {
        kind: compact ? "compaction" : "conversation",
        id,
        sessionId,
        workspaceRoot: snapshot.workspaceRoot,
        head: snapshot.headEntryId,
        controller: new AbortController(),
        effects: new Map(),
        resultIds: new Set(),
        queue: Promise.resolve(),
        done: Promise.resolve(),
        deadlineExpired: false,
        requests: 0,
        leased: false,
        finishing: false,
        steeringRevision: 0,
        pendingSteering: 0,
        stopTimer: () => {},
        startedAt: Date.parse(this.#deps.clock.now()),
      };
      const entry = compact
        ? undefined
        : this.#entry(run, { kind: "user_message", steering: false, content });
      await this.#deps.store.commit({
        entries: entry ? [entry] : [],
        effects: [],
        durability: "normal",
        sessions: [
          { sessionId, workspaceRoot: run.workspaceRoot, headEntryId: entry?.id ?? run.head },
        ],
        runs: [{ runId: id, sessionId, status: "active" }],
      });
      if (entry) run.head = entry.id;
      this.#running.set(id, run);
      run.startedAt = Date.parse(this.#deps.clock.now());
      run.stopTimer = this.#deps.scheduler.deadline(this.#limits.timeoutMs, () => {
        run.deadlineExpired = true;
        run.controller.abort();
      });
      run.done = Promise.resolve()
        .then(() => this.#drive(run))
        .finally(() => {
          run.stopTimer();
          this.#running.delete(id);
        });
      if (entry) this.#emit({ type: "entry.appended", entry });
      this.#emit({ type: "run.started", runId: id, sessionId });
    } finally {
      this.#starting.delete(sessionId);
    }
  }

  async #drive(run: Running): Promise<void> {
    let outcome: RunOutcome;
    try {
      outcome = run.kind === "compaction" ? await this.#compact(run) : await this.#loop(run);
    } catch (error) {
      outcome = { kind: "failed", reason: errorMessage(error) };
    }
    // Once the summary/head transaction succeeds, a deadline during that commit cannot
    // turn the published result into a claim that compaction was prevented.
    const compactionPublished = run.kind === "compaction" && outcome.kind === "completed";
    run.finishing = true;
    run.stopTimer();
    if (run.deadlineExpired && !compactionPublished)
      outcome = { kind: "budget_exhausted", budget: "time" };
    try {
      await run.queue;
      const snapshot = await this.#session(run.sessionId);
      for (const effect of snapshot.effects.filter((effect) => effect.runId === run.id)) {
        run.effects.set(effect.id, effect);
        if (!isTerminal(effect.state) && effect.state !== "unknown") {
          await this.#record(run, {
            ...effect,
            state: effect.state === "started" ? "unknown" : "cancelled",
            updatedAt: this.#deps.clock.now(),
            evidence: "Run stopped before settlement",
          });
        }
      }
      const latest = await this.#session(run.sessionId);
      for (const entry of latest.entries) {
        if (entry.runId === run.id && entry.body.kind === "tool_results")
          for (const result of entry.body.results) run.resultIds.add(result.callId);
      }
      const byCall = new Map([...run.effects.values()].map((effect) => [effect.callId, effect]));
      const missing: ToolResultPart[] = [];
      for (const entry of latest.entries) {
        if (entry.runId !== run.id || entry.body.kind !== "assistant_message") continue;
        for (const part of entry.body.content) {
          if (part.type !== "tool_call" || run.resultIds.has(part.callId)) continue;
          const effect = byCall.get(part.callId);
          missing.push({
            type: "tool_result",
            callId: part.callId,
            status:
              effect?.state === "unknown" || effect?.state === "started" ? "unknown" : "cancelled",
            content: [
              {
                type: "text",
                text: "Run stopped; no automatic retry. Verify unknown effects before trying again.",
              },
            ],
          });
        }
      }
      if (missing.length) await this.#append(run, { kind: "tool_results", results: missing });
      const unsettled = [...run.effects.values()].some((effect) => !isTerminal(effect.state));
      if (unsettled && outcome.kind === "completed")
        outcome = { kind: "failed", reason: "An effect outcome is unknown" };
      const keepLease = [...run.effects.values()].some(
        (effect) =>
          !isTerminal(effect.state) &&
          ["workspace_write", "process"].includes(effect.profile.class),
      );
      await this.#deps.store.commit({
        entries: [],
        effects: [],
        durability: "normal",
        runs: [
          {
            runId: run.id,
            sessionId: run.sessionId,
            status: outcome.kind === "completed" ? "completed" : "interrupted",
          },
        ],
        leases:
          run.leased && !keepLease
            ? [{ kind: "release", runId: run.id, workspaceRoot: run.workspaceRoot }]
            : [],
      });
    } catch (error) {
      outcome = { kind: "failed", reason: `Persistence/settlement failed: ${errorMessage(error)}` };
    }
    if (run.deadlineExpired && !compactionPublished)
      outcome = { kind: "budget_exhausted", budget: "time" };
    this.#emit({ type: "run.finished", runId: run.id, outcome });
  }

  async #recordRequest(
    request: ModelRequest,
    rendererVersion: string,
  ): Promise<RenderedRequestRef> {
    const blob = (value: unknown) =>
      this.#deps.store.putBlob(new TextEncoder().encode(canonicalizeJson(value)));
    return {
      rendererVersion,
      system: await blob({
        origin: request.origin,
        maxOutputTokens: request.maxOutputTokens,
        ...(request.toolChoice === undefined ? {} : { toolChoice: request.toolChoice }),
        content: request.system,
      }),
      tools: await blob(request.tools),
      messages: await Promise.all(request.messages.map(blob)),
    };
  }

  async #collect(run: Running): Promise<readonly ContextSection[]> {
    try {
      return (await this.#deps.collect?.(run.workspaceRoot, run.controller.signal)) ?? [];
    } catch (error) {
      if (run.controller.signal.aborted) return [];
      throw error;
    }
  }

  async #compact(run: Running): Promise<RunOutcome> {
    const snapshot = await this.#session(run.sessionId);
    const input: ContextInput = {
      path: pathToHead(snapshot),
      profile: this.#deps.profile,
      tools: this.#deps.tools.map(({ name, description, inputSchema }) => ({
        name,
        description,
        inputSchema,
      })),
      sections: await this.#collect(run),
      unsettledEffects: snapshot.effects.filter((effect) => !isTerminal(effect.state)),
    };
    if (run.controller.signal.aborted) return { kind: "cancelled" };
    const plan = this.#deps.context.planCompaction?.(input);
    if (!plan)
      throw new Error(
        "No safe older history to compact; latest two user turns and unresolved actions are retained",
      );
    const rendered = await this.#recordRequest(plan.request, "moyyi-compaction-v1");
    if (run.controller.signal.aborted) return { kind: "cancelled" };
    if (run.requests >= this.#limits.maxModelRequests)
      return { kind: "budget_exhausted", budget: "model_requests" };
    run.requests++;
    const response = await consumeResponse(
      this.#deps.model,
      plan.request,
      run.controller.signal,
      this.#limits.maxModelResponseBytes,
      () => {},
    );
    const cancelled = run.controller.signal.aborted;
    const audit = this.#entry(run, {
      kind: "assistant_message",
      origin: this.#deps.profile.origin,
      content: response.parts,
      stopReason: response.error || cancelled ? "interrupted" : response.stopReason,
      providerStopReason: response.providerStopReason,
      usage: response.usage,
      request: rendered,
      ...(!response.error && !cancelled && response.replay ? { replay: response.replay } : {}),
    });
    const entries: TranscriptEntry[] = [audit];
    // Even a protocol-violating summary call is paired in its audit branch, never executed.
    const calls = response.parts.filter((part): part is ToolCallPart => part.type === "tool_call");
    if (calls.length)
      entries.push({
        ...this.#entry(run, {
          kind: "tool_results",
          results: calls.map((call) => ({
            type: "tool_result",
            callId: call.callId,
            status: "cancelled",
            content: [{ type: "text", text: "Compaction never executes tools." }],
          })),
        }),
        parentId: audit.id,
      });
    let outcome: RunOutcome = cancelled
      ? { kind: "cancelled" }
      : {
          kind: "failed",
          reason:
            response.error?.message ??
            "Compaction requires complete text, optional reasoning, and no tools or refusal",
        };
    let compaction: TranscriptEntry | undefined;
    if (
      !cancelled &&
      !response.error &&
      response.stopReason === "end_turn" &&
      response.parts.length > 0 &&
      response.parts.every((part) => part.type === "text" || part.type === "reasoning") &&
      response.parts.some((part) => part.type === "text" && part.text.trim().length > 0)
    ) {
      const candidate = this.#entry(run, {
        kind: "compaction",
        replaces: plan.replaces,
        summary: response.parts.filter((part) => part.type === "text"),
        producedBy: { origin: this.#deps.profile.origin, promptVersion: plan.promptVersion },
      });
      try {
        const projected = this.#deps.context.build({
          ...input,
          path: [...input.path, candidate],
          sections: input.sections.filter((section) => section.optional !== true),
        });
        if (
          projected.report.estimatedTokens === undefined ||
          projected.report.estimatedTokens >= plan.originalTokens
        )
          throw new Error("Summary does not reduce the context; history was not changed");
        compaction = candidate;
        outcome = { kind: "completed" };
      } catch (error) {
        outcome = { kind: "failed", reason: errorMessage(error) };
      }
    }
    // The summary response is an audit sibling, not part of the current conversation path.
    // Publish its compaction and session head together, or retain the old head in full.
    await this.#serialize(run, async () => {
      const current = await this.#session(run.sessionId);
      if (current.headEntryId !== snapshot.headEntryId) {
        compaction = undefined;
        outcome = {
          kind: "failed",
          reason: "Session changed during compaction; history was not replaced",
        };
      }
      if (run.controller.signal.aborted) {
        compaction = undefined;
        outcome = { kind: "cancelled" };
      }
      if (compaction) entries.push(compaction);
      await this.#deps.store.commit({
        entries,
        effects: [],
        durability: "normal",
        sessions: compaction
          ? [
              {
                sessionId: run.sessionId,
                workspaceRoot: run.workspaceRoot,
                headEntryId: compaction.id,
              },
            ]
          : [],
      });
      if (compaction) run.head = compaction.id;
      for (const entry of entries) this.#emit({ type: "entry.appended", entry });
    });
    return outcome;
  }

  async #loop(run: Running): Promise<RunOutcome> {
    let retries = 0;
    let draftReady = false;
    while (!run.controller.signal.aborted) {
      if (run.requests >= this.#limits.maxModelRequests) {
        run.finishing = true;
        return { kind: "budget_exhausted", budget: "model_requests" };
      }
      await run.queue;
      const remaining = this.#limits.maxModelRequests - run.requests;
      // A safe request boundary, not a second deadline: never interrupt/retry a slow request
      // to create another allowance. The original timer can still prevent a final answer.
      const timeToAnswer =
        this.#deps.evidenceAnswer === true &&
        run.requests > 0 &&
        Date.parse(this.#deps.clock.now()) - run.startedAt >= this.#limits.timeoutMs / 2;
      const evidenceAnswer =
        this.#deps.evidenceAnswer === true && (draftReady || remaining === 1 || timeToAnswer);
      const finalRequest = remaining === 1 || evidenceAnswer;
      if (evidenceAnswer)
        await this.#append(run, {
          kind: "notice",
          code: "evidence_answer",
          text:
            `Evidence answer: ${draftReady ? "draft ready" : timeToAnswer ? "half of the run time elapsed" : "last request"}. ` +
            "One tool-free answer from the original question and recorded observations follows within the existing budget. " +
            "Earlier assistant text is retained as investigation, not supplied to this request. This is not task acceptance.",
        });
      await this.#append(run, {
        kind: "notice",
        code: "model_request_budget",
        text:
          `Model request budget: attempt ${run.requests + 1} of ${this.#limits.maxModelRequests}; ` +
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
                "user constraints apply."),
      });
      const snapshot = await this.#session(run.sessionId);
      const consumedSteering = snapshot.entries.filter(
        (entry) =>
          entry.runId === run.id && entry.body.kind === "user_message" && entry.body.steering,
      ).length;
      const sections = await this.#collect(run);
      if (run.controller.signal.aborted) break;
      const contextInput: ContextInput = {
        path: pathToHead(snapshot),
        profile: this.#deps.profile,
        tools: this.#deps.tools.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
        sections,
        ...(finalRequest ? { toolChoice: "none" as const } : {}),
        unsettledEffects: snapshot.effects.filter((effect) => !isTerminal(effect.state)),
      };
      const built = evidenceAnswer
        ? this.#deps.context.buildEvidenceAnswer?.(contextInput)
        : this.#deps.context.build(contextInput);
      if (!built) throw new Error("Evidence answer context port is unavailable");
      // The core's final-attempt constraint also applies to custom context builders/providers.
      const request: ModelRequest = finalRequest
        ? { ...built.request, toolChoice: "none" }
        : built.request;
      const rendered = await this.#recordRequest(
        request,
        evidenceAnswer ? "moyyi-evidence-answer-v1" : "moyyi-core-v2",
      );
      if (run.controller.signal.aborted) break;
      run.requests++;
      const response = await consumeResponse(
        this.#deps.model,
        request,
        run.controller.signal,
        this.#limits.maxModelResponseBytes,
        (text) => this.#emit({ type: "assistant.delta", runId: run.id, text }),
      );
      const used = new Set(
        snapshot.entries.flatMap((entry) =>
          entry.body.kind === "assistant_message"
            ? entry.body.content
                .filter((part) => part.type === "tool_call")
                .map((part) => part.callId)
            : [],
        ),
      );
      rejectRepeatedCalls(response, used);
      // Every attempted request retains its usage and request reference, including retries.
      const interrupted = !!response.error || run.controller.signal.aborted;
      await this.#append(run, {
        kind: "assistant_message",
        origin: this.#deps.profile.origin,
        content: response.parts,
        stopReason: interrupted ? "interrupted" : response.stopReason,
        providerStopReason: response.providerStopReason,
        usage: response.usage,
        request: rendered,
        ...(!interrupted && response.replay ? { replay: response.replay } : {}),
      });
      if (
        response.error &&
        !response.partial &&
        !response.error.partialOutput &&
        !run.controller.signal.aborted &&
        !finalRequest &&
        !this.#deps.evidenceAnswer &&
        ["rate_limited", "overloaded", "network"].includes(response.error.kind) &&
        retries < this.#limits.maxRetries
      ) {
        retries++;
        await this.#append(run, {
          kind: "notice",
          code: "model_retry",
          text: `Retry ${retries}: ${response.error.kind}`,
        });
        const delay = response.error.retryAfterMs ?? 100 * 2 ** (retries - 1);
        try {
          await this.#deps.scheduler.sleep(
            Math.max(0, Math.min(30_000, Number.isFinite(delay) ? delay : 100)),
            run.controller.signal,
          );
        } catch (error) {
          if (run.controller.signal.aborted) break;
          throw error;
        }
        continue;
      }
      const calls = response.parts.filter(
        (part): part is ToolCallPart => part.type === "tool_call",
      );
      if (finalRequest && !interrupted && !run.controller.signal.aborted && calls.length) {
        // Pair even a provider-violating call without prepare, approval, journal or execution.
        await this.#append(run, {
          kind: "tool_results",
          results: calls.map((call) => ({
            type: "tool_result",
            callId: call.callId,
            status: "denied",
            content: [
              {
                type: "text",
                text: "Tool was not executed: the final model request is reserved for an answer.",
              },
            ],
          })),
        });
        if (run.controller.signal.aborted) break;
        run.finishing = true;
        return {
          kind: "budget_exhausted",
          budget: response.stopReason === "max_tokens" ? "model_output_tokens" : "model_requests",
        };
      }
      if (interrupted || run.controller.signal.aborted || response.stopReason !== "tool_use") {
        if (calls.length)
          await this.#append(run, {
            kind: "tool_results",
            results: calls.map((call) => ({
              type: "tool_result",
              callId: call.callId,
              status: run.controller.signal.aborted ? "cancelled" : "failed",
              content: [
                {
                  type: "text",
                  text: "Tool was not executed: assistant did not complete a tool-use turn.",
                },
              ],
            })),
          });
        if (run.controller.signal.aborted) break;
        const completeStop = ["end_turn", "refusal"].includes(response.stopReason);
        const hasAnswer = response.parts.some(
          (part) =>
            (part.type === "text" || part.type === "refusal") && part.text.trim().length > 0,
        );
        // A stream terminal is not necessarily a complete answer. Pending steering remains
        // recorded, but cannot turn a truncated/empty response into an automatic continuation.
        if (!response.error && completeStop && hasAnswer && calls.length === 0) {
          await run.queue;
          if (run.pendingSteering > 0 || run.steeringRevision > consumedSteering) {
            retries = 0;
            continue;
          }
          if (
            this.#deps.evidenceAnswer &&
            !finalRequest &&
            response.stopReason === "end_turn" &&
            !response.parts.some((part) => part.type === "refusal")
          ) {
            draftReady = true;
            retries = 0;
            continue;
          }
        }
        run.finishing = true;
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
        if (calls.length)
          return {
            kind: "failed",
            reason: "Model response ended without completing its tool calls",
          };
        if (!hasAnswer)
          return { kind: "failed", reason: "Model response contained no answer text" };
        return { kind: "completed" };
      }
      retries = 0;
      const host: ExecutionHost = {
        runId: run.id,
        workspaceRoot: run.workspaceRoot,
        signal: run.controller.signal,
        tools: this.#deps.tools,
        policy: this.#deps.policy,
        validator: this.#deps.validator,
        preconditions: this.#deps.preconditions,
        hasher: this.#deps.hasher,
        limits: this.#limits,
        ...(this.#deps.files ? { files: this.#deps.files } : {}),
        ...(this.#deps.processes ? { processes: this.#deps.processes } : {}),
        ...(this.#deps.documents ? { documents: this.#deps.documents } : {}),
        ...(this.#deps.writes ? { writes: this.#deps.writes } : {}),
        ...(this.#deps.web ? { web: this.#deps.web } : {}),
        now: () => this.#deps.clock.now(),
        nextEffectId: () => this.#deps.ids.next("effect") as EffectId,
        record: (effect, result) => this.#record(run, effect, result),
        ensureLease: () => this.#ensureLease(run),
        approve: (effect, action) => this.#approve(run, effect, action),
      };
      const results = await executeCalls(calls, host);
      const missing = results.filter((result) => !run.resultIds.has(result.callId));
      if (missing.length) await this.#append(run, { kind: "tool_results", results: missing });
      if (results.some((result) => result.status === "unknown"))
        return { kind: "failed", reason: "Tool outcome unknown; verify before retrying" };
    }
    return run.deadlineExpired
      ? { kind: "budget_exhausted", budget: "time" }
      : { kind: "cancelled" };
  }

  #entry(run: Running, body: EntryBody): TranscriptEntry {
    return {
      id: this.#deps.ids.next("entry") as EntryId,
      parentId: run.head,
      sessionId: run.sessionId,
      runId: run.id,
      createdAt: this.#deps.clock.now(),
      body,
    };
  }
  #serialize(run: Running, operation: () => Promise<void>): Promise<void> {
    const result = run.queue.then(operation);
    run.queue = result.catch(() => {});
    return result;
  }
  #append(run: Running, body: EntryBody): Promise<void> {
    return this.#serialize(run, async () => {
      const entry = this.#entry(run, body);
      await this.#deps.store.commit({
        entries: [entry],
        effects: [],
        durability: "normal",
        sessions: [
          { sessionId: run.sessionId, workspaceRoot: run.workspaceRoot, headEntryId: entry.id },
        ],
      });
      run.head = entry.id;
      if (body.kind === "user_message" && body.steering) run.steeringRevision++;
      if (body.kind === "tool_results")
        for (const result of body.results) run.resultIds.add(result.callId);
      this.#emit({ type: "entry.appended", entry });
    });
  }
  #record(run: Running, effect: EffectRecord, result?: ToolResultPart): Promise<void> {
    return this.#serialize(run, async () => {
      const entry = result
        ? this.#entry(run, { kind: "tool_results", results: [result] })
        : undefined;
      await this.#deps.store.commit({
        entries: entry ? [entry] : [],
        effects: [effect],
        durability: effect.state === "started" ? "before_side_effect" : "normal",
        ...(entry
          ? {
              sessions: [
                {
                  sessionId: run.sessionId,
                  workspaceRoot: run.workspaceRoot,
                  headEntryId: entry.id,
                },
              ],
            }
          : {}),
      });
      run.effects.set(effect.id, effect);
      if (entry && result) {
        run.head = entry.id;
        run.resultIds.add(result.callId);
        this.#emit({ type: "entry.appended", entry });
      }
      this.#emit({ type: "effect.updated", effect });
    });
  }
  #ensureLease(run: Running): Promise<void> {
    return this.#serialize(run, async () => {
      if (run.leased) return;
      await this.#deps.store.commit({
        entries: [],
        effects: [],
        durability: "normal",
        leases: [{ kind: "acquire", runId: run.id, workspaceRoot: run.workspaceRoot }],
      });
      run.leased = true;
    });
  }
  #approve(run: Running, effect: EffectRecord, action: PreparedAction): Promise<boolean> {
    if (run.controller.signal.aborted) return Promise.resolve(false);
    return new Promise((resolve) => {
      const finish = (accepted: boolean) => {
        this.#approvals.delete(effect.id);
        run.controller.signal.removeEventListener("abort", abort);
        resolve(accepted);
      };
      const abort = () => finish(false);
      this.#approvals.set(effect.id, {
        run,
        digest: action.digest,
        revision: this.#deps.policy.revision?.() ?? 0,
        resolve: finish,
      });
      run.controller.signal.addEventListener("abort", abort, { once: true });
      this.#emit({
        type: "approval.requested",
        effectId: effect.id,
        digest: action.digest,
        summary: action.summary,
        ...(action.preview === undefined ? {} : { preview: action.preview }),
      });
    });
  }
  #emit(event: RuntimeEvent): void {
    this.#deps.emit(event);
  }
}

export function pathToHead(snapshot: SessionSnapshot): readonly TranscriptEntry[] {
  const map = new Map(snapshot.entries.map((entry) => [entry.id, entry]));
  const path: TranscriptEntry[] = [],
    seen = new Set<EntryId>();
  let cursor = snapshot.headEntryId;
  while (cursor !== null) {
    const entry = map.get(cursor);
    if (!entry || seen.has(cursor)) throw new Error("Broken session path");
    seen.add(cursor);
    path.push(entry);
    cursor = entry.parentId;
  }
  return path.reverse();
}
function userContent(input: readonly ContentPart[], maximum: number): readonly ContentPart[] {
  const encoded = canonicalizeJson(input);
  if (!input.length || new TextEncoder().encode(encoded).byteLength > maximum)
    throw new Error("User input exceeds limits or is empty");
  if (input.some((part) => part.type !== "text" && part.type !== "image"))
    throw new Error("User input accepts only text and images");
  return JSON.parse(encoded) as ContentPart[];
}
function rejectRepeatedCalls(response: Response, seen: Set<string>): void {
  response.parts = response.parts.map((part) => {
    if (part.type !== "tool_call") return part;
    if (!seen.has(part.callId)) {
      seen.add(part.callId);
      return part;
    }
    response.error = {
      kind: "protocol",
      message: "Repeated tool call identity",
      partialOutput: true,
      usage: response.usage,
    };
    response.partial = true;
    return { type: "text", text: `Rejected repeated tool call: ${canonicalizeJson(part)}` };
  });
}
export function errorMessage(error: unknown): string {
  try {
    return (error instanceof Error ? error.message : String(error)).slice(0, 1024).toWellFormed();
  } catch {
    return "Unreportable runtime error";
  }
}
