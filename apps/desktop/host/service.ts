import { Buffer } from "node:buffer";
import { realpath, stat } from "node:fs/promises";
import type {
  ActionDigest,
  ClientCommand,
  EffectId,
  RunId,
  RuntimeEvent,
  SessionId,
  TranscriptEntry,
} from "moyyi/contracts";
import { createRuntime, ReadOnlyPolicy, type Runtime, type RuntimeOptions } from "moyyi/runtime";
import type {
  DesktopApproval,
  DesktopCommand,
  DesktopMessage,
  DesktopSessionSummary,
  DesktopState,
} from "../shared.ts";
import { parseDesktopCommand } from "./validation.ts";

export interface DesktopHostOptions {
  readonly runtimeOptions: () => RuntimeOptions | Promise<RuntimeOptions>;
  readonly maxOutputTokens?: number;
  readonly connection?: DesktopState["connection"];
}

export interface DesktopHost {
  getState(): DesktopState;
  subscribe(listener: (state: DesktopState) => void): () => void;
  /** Resolves on command handling, not run completion; rejected commands also update state.error. */
  dispatch(command: unknown): Promise<DesktopState>;
  close(): Promise<void>;
}

const DISPLAY_TEXT = 16_384;
const MESSAGE_BYTES = 262_144;
const clip = (text: string, maximum = DISPLAY_TEXT) =>
  text.length <= maximum
    ? text
    : `${text.slice(0, maximum)}\n[Display truncated; full text remains in history.]`;

class Host implements DesktopHost {
  private runtime: Runtime | undefined;
  private unsubscribe: (() => void) | undefined;
  private readonly listeners = new Set<(state: DesktopState) => void>();
  private readonly knownSessions = new Map<string, DesktopSessionSummary>();
  private readonly approvals = new Map<string, DesktopApproval>();
  private readonly replying = new Set<string>();
  private readonly effectRuns = new Map<string, string>();
  private readonly toolNames = new Map<string, string>();
  private readonly entryIds = new Set<string>();
  private operation: Promise<void> | undefined;
  private closing: Promise<void> | undefined;
  private pendingWorkspace: string | undefined;
  private expectedSession: string | undefined;
  private commandError: string | null = null;
  private pluginWarning: string | null = null;
  private state: DesktopState;
  private readonly options: RuntimeOptions;

  constructor(
    options: RuntimeOptions,
    display: Pick<DesktopHostOptions, "connection" | "maxOutputTokens">,
  ) {
    this.options = options;
    this.state = {
      status: "ready",
      connection: display.connection ?? { ready: true },
      sessions: { items: [], offset: 0, hasMore: false },
      activeSessionId: null,
      workspaceRoot: null,
      model: options.model ? { ...options.model } : null,
      budgets: {
        maxRequests: options.limits?.maxModelRequests ?? null,
        timeoutMs: options.limits?.timeoutMs ?? null,
        maxOutputTokens: display.maxOutputTokens ?? null,
      },
      askEachRead: false,
      messages: [],
      historyTruncated: false,
      streamText: "",
      run: null,
      outcome: null,
      pendingApproval: null,
      error: null,
    };
  }

  async initialize(): Promise<void> {
    await this.open(false);
    await this.send({ type: "session.list", offset: 0, limit: 20 });
  }

  getState(): DesktopState {
    return structuredClone(this.state);
  }

  subscribe(listener: (state: DesktopState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private update(change: Partial<DesktopState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) {
      try {
        listener(this.getState());
      } catch {
        // A view cannot stop recording, cancellation or another view's state delivery.
      }
    }
  }

  private fail(message: string): never {
    this.update({ error: message });
    throw Error(message);
  }

  private async open(askEachRead: boolean): Promise<void> {
    if (this.runtime) {
      await this.runtime.close();
      this.unsubscribe?.();
      this.runtime = undefined;
    }
    if (this.state.status !== "ready") throw Error("Desktop host is closing");
    // The factory is trusted connection composition, but M1 never inherits its effect grants.
    const {
      policy: _policy,
      workspaceWrites: _writes,
      workspaceProcesses: _processes,
      web: _web,
      developmentPlugins: _development,
      ...base
    } = this.options;
    const runtime = await createRuntime({
      ...base,
      policy: new ReadOnlyPolicy({
        requireApproval: askEachRead ? ["read", "list", "search", "read_document"] : [],
      }),
    });
    if (this.state.status !== "ready") {
      await runtime.close();
      throw Error("Desktop host is closing");
    }
    this.runtime = runtime;
    this.unsubscribe = runtime.subscribe((event) => this.event(event));
    this.pluginWarning = runtime.plugins.some((plugin) => plugin.state === "failed")
      ? "A runtime plugin is unavailable; some capabilities may not work"
      : null;
    this.update({
      askEachRead,
      error: this.pluginWarning,
    });
  }

  private async send(command: ClientCommand): Promise<void> {
    if (!this.runtime) throw Error("Desktop runtime is unavailable");
    this.commandError = null;
    await this.runtime.send(command);
    if (this.commandError) throw Error(this.commandError);
  }

  async dispatch(value: unknown): Promise<DesktopState> {
    let command: DesktopCommand;
    this.update({ error: this.pluginWarning });
    try {
      command = parseDesktopCommand(value);
    } catch {
      return this.fail("Invalid desktop command");
    }
    if (command.type === "close") {
      await this.close();
      return this.getState();
    }
    if (this.state.status !== "ready") return this.fail("Desktop host is closed");
    if (command.type !== "approve" && command.type !== "cancel") {
      if (this.operation) return this.fail("Another desktop command is being handled");
      if (this.state.run) return this.fail("Finish or cancel the active run first");
      const operation = this.perform(command);
      this.operation = operation;
      try {
        await operation;
      } catch (error) {
        return this.fail(this.commandError ?? this.safeError(error));
      } finally {
        if (this.operation === operation) this.operation = undefined;
      }
    } else {
      try {
        await this.perform(command);
      } catch (error) {
        return this.fail(this.commandError ?? this.safeError(error));
      }
    }
    return this.getState();
  }

  private safeError(error: unknown): string {
    return error instanceof BoundaryError ? error.message : "Desktop operation failed safely";
  }

  private async perform(command: Exclude<DesktopCommand, { type: "close" }>): Promise<void> {
    if (command.type !== "approve" && command.type !== "cancel") {
      // run.finished is emitted just before core cleanup settles. Do not race the next admission.
      await this.runtime?.idle();
      if (this.state.status !== "ready") throw new BoundaryError("Desktop host is closing");
    }
    if (command.type === "create" || command.type === "load") {
      const record =
        command.type === "load" ? this.knownSessions.get(command.sessionId) : undefined;
      if (command.type === "load" && !record)
        throw new BoundaryError("Select a listed session first");
      const selected =
        command.type === "create"
          ? command.workspaceRoot
          : (record as DesktopSessionSummary).workspaceRoot;
      let workspace: string;
      try {
        workspace = await realpath(selected);
        if (!(await stat(workspace)).isDirectory()) throw Error();
        if (command.type === "load" && workspace !== selected) throw Error();
      } catch {
        throw new BoundaryError("The selected workspace is missing or has changed");
      }
      if (this.state.status !== "ready") throw new BoundaryError("Desktop host is closing");
      if (!this.runtime || command.askEachRead !== this.state.askEachRead)
        await this.open(command.askEachRead);
      this.approvals.clear();
      this.effectRuns.clear();
      this.toolNames.clear();
      this.entryIds.clear();
      this.pendingWorkspace = workspace;
      this.expectedSession = command.type === "load" ? command.sessionId : undefined;
      this.update({
        messages: [],
        streamText: "",
        historyTruncated: false,
        pendingApproval: null,
        outcome: null,
      });
      try {
        await this.send(
          command.type === "create"
            ? { type: "session.create", workspaceRoot: workspace }
            : { type: "session.load", sessionId: command.sessionId as SessionId },
        );
      } finally {
        this.pendingWorkspace = undefined;
        this.expectedSession = undefined;
      }
      return;
    }
    if (command.type === "list") {
      await this.send({ type: "session.list", offset: command.offset, limit: 20 });
      return;
    }
    if (command.type === "start") {
      if (command.sessionId !== this.state.activeSessionId)
        throw new BoundaryError("Session is not selected");
      if (!this.state.connection.ready)
        throw new BoundaryError("The model connection is unavailable");
      const input = [{ type: "text" as const, text: command.text }];
      if (Buffer.byteLength(JSON.stringify(input)) > (this.options.limits?.maxInputBytes ?? 65_536))
        throw new BoundaryError("Message exceeds the configured input limit");
      await this.send({ type: "run.start", sessionId: command.sessionId as SessionId, input });
      return;
    }
    if (command.type === "cancel") {
      if (command.runId !== this.state.run?.id) throw new BoundaryError("Run is not active");
      this.update({ run: { id: command.runId, state: "cancelling" } });
      await this.send({ type: "run.cancel", runId: command.runId as RunId });
      return;
    }
    const pending = this.state.pendingApproval;
    if (
      this.state.run?.state !== "running" ||
      pending?.effectId !== command.effectId ||
      pending.digest !== command.digest ||
      this.replying.has(command.effectId)
    )
      throw new BoundaryError("Approval is unknown, stale or already being handled");
    this.replying.add(command.effectId);
    try {
      await this.send({
        type: "approval.respond",
        effectId: command.effectId as EffectId,
        digest: command.digest as ActionDigest,
        decision: command.decision,
      });
      if (this.approvals.get(command.effectId)?.digest === command.digest)
        this.approvals.delete(command.effectId);
      this.update({ pendingApproval: this.approvals.values().next().value ?? null });
    } finally {
      this.replying.delete(command.effectId);
    }
  }

  private add(message: DesktopMessage): void {
    const text = clip(message.text);
    const messages = [...this.state.messages, { ...message, text }];
    let truncated = this.state.historyTruncated || text !== message.text;
    while (messages.length > 100 || Buffer.byteLength(JSON.stringify(messages)) > MESSAGE_BYTES) {
      messages.shift();
      truncated = true;
    }
    this.update({ messages, historyTruncated: truncated });
  }

  private entry(entry: TranscriptEntry): void {
    if (entry.sessionId !== this.state.activeSessionId || this.entryIds.has(entry.id)) return;
    this.entryIds.add(entry.id);
    const body = entry.body;
    const summary = this.knownSessions.get(entry.sessionId);
    // Loading replays historical entries; keep the catalog's current summary during replay.
    if (summary && !this.expectedSession) {
      let preview = summary.promptPreview;
      if (body.kind === "user_message") {
        preview = body.content.find((part) => part.type === "text")?.text.slice(0, 160) ?? null;
        if (preview && /[\uD800-\uDBFF]$/u.test(preview)) preview = preview.slice(0, -1);
      }
      const next = { ...summary, promptPreview: preview, lastActivityAt: entry.createdAt };
      this.knownSessions.set(entry.sessionId, next);
      this.update({
        sessions: {
          ...this.state.sessions,
          items: this.state.sessions.items.map((item) =>
            item.sessionId === entry.sessionId ? next : item,
          ),
        },
      });
    }
    if (body.kind === "user_message" || body.kind === "assistant_message") {
      const role = body.kind === "user_message" ? "user" : "assistant";
      for (const [index, part] of body.content.entries()) {
        const id = `${entry.id}:${index}`;
        if (part.type === "text" || part.type === "refusal")
          this.add({ id, role, text: part.text });
        else if (part.type === "tool_call") {
          this.toolNames.set(part.callId, part.name);
          this.add({
            id,
            role: "tool",
            tool: part.name,
            state: "requested",
            text: `${part.name} ${part.rawArguments}`,
          });
        } else if (part.type === "image")
          this.add({
            id,
            role: "notice",
            text: "An image is retained in history; this text view does not display it.",
          });
        // Reasoning, replay and request blob references stay in the private runtime/store.
      }
      if (body.kind === "assistant_message") {
        this.update({ streamText: "" });
        if (body.stopReason === "interrupted")
          this.add({
            id: `${entry.id}:interrupted`,
            role: "notice",
            state: "interrupted",
            text: body.content.some(
              (part) => (part.type === "text" || part.type === "refusal") && part.text.trim(),
            )
              ? "This response was interrupted. The text above is partial, not a completed answer."
              : "This response was interrupted before an answer was received.",
          });
        if (body.stopReason === "max_tokens")
          this.add({
            id: `${entry.id}:partial`,
            role: "notice",
            state: "partial",
            text: "The model reached its output limit. Any answer above is partial; no continuation was started.",
          });
      }
    } else if (body.kind === "tool_results") {
      for (const [index, result] of body.results.entries())
        this.add({
          id: `${entry.id}:${index}`,
          role: "tool",
          tool: this.toolNames.get(result.callId) ?? "tool",
          state: result.status,
          text: result.content
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n"),
        });
    } else if (body.kind === "notice") this.add({ id: entry.id, role: "notice", text: body.text });
    else if (body.kind === "compaction")
      this.add({
        id: entry.id,
        role: "notice",
        text: "Earlier conversation was summarized; original entries remain in history.",
      });
  }

  private event(event: RuntimeEvent): void {
    switch (event.type) {
      case "session.ready": {
        if (
          !this.pendingWorkspace ||
          (this.expectedSession && event.sessionId !== this.expectedSession)
        )
          return;
        const summary = this.knownSessions.get(event.sessionId) ?? {
          sessionId: event.sessionId,
          workspaceRoot: this.pendingWorkspace,
          lastActivityAt: null,
          promptPreview: null,
        };
        this.knownSessions.set(event.sessionId, summary);
        let sessions = this.state.sessions;
        if (!this.expectedSession && sessions.offset === 0) {
          const items = [
            summary,
            ...sessions.items.filter((item) => item.sessionId !== event.sessionId),
          ];
          sessions = {
            ...sessions,
            items: items.slice(0, 20),
            hasMore: sessions.hasMore || items.length > 20,
          };
        }
        this.update({
          activeSessionId: event.sessionId,
          workspaceRoot: this.pendingWorkspace,
          sessions,
        });
        break;
      }
      case "session.listed":
        for (const session of event.page.sessions)
          this.knownSessions.set(session.sessionId, session);
        this.update({
          sessions: {
            items: event.page.sessions,
            offset: event.page.offset,
            hasMore: event.page.hasMore,
          },
        });
        break;
      case "run.started":
        if (event.sessionId !== this.state.activeSessionId) return;
        this.update({ run: { id: event.runId, state: "running" }, outcome: null, streamText: "" });
        break;
      case "assistant.delta":
        if (event.runId !== this.state.run?.id) return;
        this.update({ streamText: clip(this.state.streamText + event.text, 32_768) });
        break;
      case "entry.appended":
        this.entry(event.entry);
        break;
      case "effect.updated":
        if (event.effect.runId !== this.state.run?.id) return;
        this.effectRuns.set(event.effect.id, event.effect.runId);
        if (event.effect.state !== "awaiting_approval") {
          this.approvals.delete(event.effect.id);
          this.update({ pendingApproval: this.approvals.values().next().value ?? null });
        }
        break;
      case "approval.requested":
        if (!this.state.run || this.effectRuns.get(event.effectId) !== this.state.run.id) return;
        this.approvals.set(event.effectId, {
          effectId: event.effectId,
          digest: event.digest,
          summary: clip(event.summary),
          ...(event.preview === undefined ? {} : { preview: clip(event.preview) }),
        });
        this.update({ pendingApproval: this.approvals.values().next().value ?? null });
        break;
      case "run.finished":
        if (event.runId !== this.state.run?.id) return;
        this.approvals.clear();
        this.effectRuns.clear();
        this.update({
          run: null,
          pendingApproval: null,
          outcome: {
            kind: event.outcome.kind,
            ...(event.outcome.kind === "failed"
              ? { detail: clip(event.outcome.reason, 1024) }
              : event.outcome.kind === "budget_exhausted"
                ? { detail: event.outcome.budget }
                : {}),
          },
        });
        break;
      case "command.rejected":
        this.commandError =
          "The runtime rejected this command; refresh the current state before trying again";
        this.update({ error: this.commandError });
        break;
      case "plugin.status":
        if (event.state === "failed") {
          this.pluginWarning = "A runtime plugin is unavailable; some capabilities may not work";
          this.update({ error: this.pluginWarning });
        }
        break;
      case "session.results":
        break;
    }
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.update({ status: "closing" });
    this.closing = (async () => {
      try {
        await this.operation?.catch(() => {});
        await this.runtime?.close();
      } finally {
        this.unsubscribe?.();
        this.runtime = undefined;
        this.approvals.clear();
        this.update({ status: "closed", run: null, pendingApproval: null });
        this.listeners.clear();
      }
    })();
    return this.closing;
  }
}

class BoundaryError extends Error {}

export class DesktopInitializationError extends Error {
  readonly kind: "locked" | "unavailable";
  constructor(kind: "locked" | "unavailable") {
    super(
      kind === "locked"
        ? "Desktop store is locked by another process"
        : "Desktop runtime initialization failed",
    );
    this.name = "DesktopInitializationError";
    this.kind = kind;
  }
}

function initializationError(error: unknown): DesktopInitializationError {
  const sqlite = error as { code?: unknown; errcode?: unknown } | null;
  return new DesktopInitializationError(
    sqlite?.code === "ERR_SQLITE_ERROR" && (sqlite.errcode === 5 || sqlite.errcode === 6)
      ? "locked"
      : "unavailable",
  );
}

export async function createDesktopHost(options: DesktopHostOptions): Promise<DesktopHost> {
  let host: Host | undefined;
  try {
    const configured = await options.runtimeOptions();
    if (!configured.dataDirectory || configured.store)
      throw Error("Desktop host requires its own private data directory");
    host = new Host(configured, options);
    await host.initialize();
    return host;
  } catch (error) {
    try {
      await host?.close();
    } catch {
      /* Preserve the original fixed initialization diagnosis. */
    }
    throw initializationError(error);
  }
}
