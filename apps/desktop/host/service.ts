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
import {
  createRuntime,
  discoverNodeToolchain,
  type Runtime,
  type RuntimeOptions,
  WebPolicy,
} from "moyyi/runtime";
import {
  DEFAULT_DESKTOP_SETTINGS,
  type DesktopApproval,
  type DesktopCommand,
  type DesktopMessage,
  type DesktopPermissions,
  type DesktopSessionSummary,
  type DesktopSettings,
  type DesktopState,
  type DesktopWebAccess,
} from "../shared.ts";
import { inspectEffectFile } from "./effects.ts";
import { FileBoundaryError, inspectMaterials } from "./materials.ts";
import { DesktopPolicy } from "./permissions.ts";
import { inspectReport, reportTarget } from "./reports.ts";
import { parseDesktopCommand } from "./validation.ts";
import {
  appendWebSource,
  EMPTY_WEB_ACCESS,
  normalizeDesktopWebAccess,
  projectWebSource,
} from "./web.ts";

export interface DesktopHostOptions {
  readonly runtimeOptions: () => RuntimeOptions | Promise<RuntimeOptions>;
  readonly maxOutputTokens?: number;
  readonly connection?: DesktopState["connection"];
  readonly settings?: DesktopSettings;
  readonly configure?: (
    settings: DesktopSettings,
    apiKey?: string,
  ) => Promise<{
    settings: DesktopSettings;
    runtimeOptions: RuntimeOptions;
    connection: DesktopState["connection"];
  }>;
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
  private options: RuntimeOptions;
  private readonly configure: DesktopHostOptions["configure"];
  private refresh: Promise<void> | undefined;
  private resultsDestination: "both" | "artifacts" | "effects" = "both";

  constructor(
    options: RuntimeOptions,
    display: Pick<DesktopHostOptions, "connection" | "maxOutputTokens" | "settings" | "configure">,
  ) {
    this.options = options;
    this.configure = display.configure;
    this.state = {
      status: "ready",
      connection: display.connection ?? { ready: true },
      settings: display.settings ?? DEFAULT_DESKTOP_SETTINGS,
      materials: [],
      reportTarget: null,
      permissions: { writes: false, checks: false },
      webAccess: EMPTY_WEB_ACCESS,
      sources: { items: [], truncated: false },
      openedHistory: false,
      effects: { items: [], offset: 0, hasMore: false },
      effectInspection: null,
      artifacts: { items: [], offset: 0, hasMore: false },
      artifactPreview: null,
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

  private async open(
    askEachRead: boolean,
    target: string | null = null,
    permissions: DesktopPermissions = { writes: false, checks: false },
    webAccess: DesktopWebAccess = EMPTY_WEB_ACCESS,
  ): Promise<void> {
    const access = normalizeDesktopWebAccess(webAccess);
    this.update({ webAccess: EMPTY_WEB_ACCESS });
    if (this.runtime) {
      await this.runtime.close();
      this.unsubscribe?.();
      this.runtime = undefined;
    }
    if (this.state.status !== "ready") throw Error("Desktop host is closing");
    // Connection composition never supplies effect grants; only explicit desktop actions can.
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
      ...((target || permissions.writes) && this.state.workspaceRoot
        ? { workspaceWrites: { roots: [this.state.workspaceRoot], approval: "ask" as const } }
        : {}),
      ...(permissions.checks && this.state.workspaceRoot
        ? {
            workspaceProcesses: {
              roots: [this.state.workspaceRoot],
              approval: "ask" as const,
              workspaceAccess: "read-only" as const,
              ...(await discoverNodeToolchain()),
            },
          }
        : {}),
      ...(access.allowedOrigins.length ? { web: { ...access, approval: "ask" as const } } : {}),
      policy: access.allowedOrigins.length
        ? new WebPolicy({
            previous: new DesktopPolicy(permissions, askEachRead, target),
            fetch: true,
            approval: "ask",
          })
        : new DesktopPolicy(permissions, askEachRead, target),
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
      reportTarget: target,
      permissions,
      webAccess: access,
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
    return error instanceof BoundaryError || error instanceof FileBoundaryError
      ? error.message
      : "Desktop operation failed safely";
  }

  private excluded(): readonly string[] {
    return [
      ...(this.options.protectedPaths ?? []),
      ...(this.options.dataDirectory ? [this.options.dataDirectory] : []),
    ];
  }

  private selected(sessionId: string): string {
    if (sessionId !== this.state.activeSessionId || !this.state.workspaceRoot)
      throw new BoundaryError("Session is not selected");
    return this.state.workspaceRoot;
  }

  private async refreshArtifacts(
    offset: number,
    destination: "both" | "artifacts" | "effects" = "both",
  ): Promise<void> {
    if (!this.state.activeSessionId || !this.runtime) return;
    await this.runtime.idle();
    if (this.state.status !== "ready") return;
    this.resultsDestination = destination;
    await this.send({
      type: "session.results",
      sessionId: this.state.activeSessionId as SessionId,
      offset,
      limit: 20,
    });
  }

  private scheduleArtifacts(): void {
    if (this.state.status !== "ready" || !this.runtime) return;
    const runtime = this.runtime,
      session = this.state.activeSessionId;
    const task = (async () => {
      await runtime.idle();
      if (
        this.runtime === runtime &&
        this.state.activeSessionId === session &&
        this.state.status === "ready"
      )
        await this.refreshArtifacts(0);
    })()
      .catch(() => {
        if (this.state.status === "ready")
          this.update({ error: "Report history could not be refreshed" });
      })
      .finally(() => {
        if (this.refresh === task) this.refresh = undefined;
      });
    this.refresh = task;
  }

  private async reloadSelected(): Promise<void> {
    const sessionId = this.state.activeSessionId,
      workspace = this.state.workspaceRoot;
    if (!sessionId || !workspace) {
      await this.send({ type: "session.list", offset: 0, limit: 20 });
      return;
    }
    this.entryIds.clear();
    this.toolNames.clear();
    this.pendingWorkspace = workspace;
    this.expectedSession = sessionId;
    this.update({
      messages: [],
      sources: { items: [], truncated: false },
      streamText: "",
      historyTruncated: false,
      artifactPreview: null,
      effectInspection: null,
      pendingApproval: null,
    });
    try {
      await this.send({ type: "session.load", sessionId: sessionId as SessionId });
    } finally {
      this.pendingWorkspace = undefined;
      this.expectedSession = undefined;
    }
    await this.refreshArtifacts(0);
  }

  private async changeReport(target: string | null): Promise<void> {
    try {
      await this.open(
        this.state.askEachRead,
        target,
        { writes: false, checks: false },
        this.state.webAccess,
      );
      await this.reloadSelected();
    } catch {
      this.update({ reportTarget: null });
      if (this.state.status === "ready") {
        await this.open(this.state.askEachRead);
        await this.reloadSelected();
      }
      throw new BoundaryError(
        "Report permission could not be changed; no report permission was retained",
      );
    }
  }

  private async perform(command: Exclude<DesktopCommand, { type: "close" }>): Promise<void> {
    if (command.type !== "approve" && command.type !== "cancel") {
      await this.refresh;
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
      if (
        !this.runtime ||
        command.askEachRead !== this.state.askEachRead ||
        this.state.reportTarget !== null ||
        this.state.permissions.writes ||
        this.state.permissions.checks ||
        this.state.webAccess.allowedOrigins.length > 0 ||
        this.state.webAccess.dns !== "system"
      )
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
        materials: [],
        reportTarget: null,
        permissions: { writes: false, checks: false },
        webAccess: EMPTY_WEB_ACCESS,
        sources: { items: [], truncated: false },
        openedHistory: command.type === "load",
        effects: { items: [], offset: 0, hasMore: false },
        effectInspection: null,
        artifacts: { items: [], offset: 0, hasMore: false },
        artifactPreview: null,
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
      await this.refreshArtifacts(0);
      return;
    }
    if (command.type === "configure") {
      if (!this.configure)
        throw new BoundaryError("Desktop settings cannot be changed by this host");
      const previous = this.options;
      const previousSettings = this.state.settings,
        previousConnection = this.state.connection;
      await this.runtime?.close();
      this.unsubscribe?.();
      this.runtime = undefined;
      this.update({
        reportTarget: null,
        permissions: { writes: false, checks: false },
        pendingApproval: null,
        artifactPreview: null,
        effectInspection: null,
      });
      this.update({ webAccess: EMPTY_WEB_ACCESS });
      let saved = false;
      try {
        const configured = await this.configure(command.settings, command.apiKey);
        saved = true;
        this.update({ settings: configured.settings });
        if (
          !configured.runtimeOptions.dataDirectory ||
          configured.runtimeOptions.dataDirectory !== previous.dataDirectory ||
          configured.runtimeOptions.store
        )
          throw Error("Configuration changed store ownership");
        this.options = configured.runtimeOptions;
        this.update({
          settings: configured.settings,
          connection: configured.connection,
          model: this.options.model ? { ...this.options.model } : null,
          budgets: {
            maxRequests: this.options.limits?.maxModelRequests ?? null,
            timeoutMs: this.options.limits?.timeoutMs ?? null,
            maxOutputTokens: this.state.budgets.maxOutputTokens,
          },
        });
        await this.open(this.state.askEachRead);
        await this.reloadSelected();
      } catch {
        if (saved) {
          this.update({
            connection: {
              ready: false,
              message: "Settings were saved, but the runtime must be reopened",
            },
          });
          throw new BoundaryError(
            "Settings were saved, but the runtime could not reopen; existing conversations were retained",
          );
        }
        this.options = previous;
        this.update({
          settings: previousSettings,
          connection: previousConnection,
          model: previous.model ? { ...previous.model } : null,
          budgets: {
            maxRequests: previous.limits?.maxModelRequests ?? null,
            timeoutMs: previous.limits?.timeoutMs ?? null,
            maxOutputTokens: this.state.budgets.maxOutputTokens,
          },
        });
        if (this.state.status === "ready") {
          try {
            await this.open(this.state.askEachRead);
            await this.reloadSelected();
          } catch {
            this.update({
              connection: { ready: false, message: "Desktop runtime must be reopened" },
            });
          }
        }
        throw new BoundaryError(
          "Desktop settings could not be applied; existing conversations were retained",
        );
      }
      return;
    }
    if (command.type === "permissions") {
      this.selected(command.sessionId);
      this.update({
        reportTarget: null,
        permissions: { writes: false, checks: false },
        pendingApproval: null,
        effectInspection: null,
      });
      try {
        await this.open(
          this.state.askEachRead,
          null,
          {
            writes: command.writes,
            checks: command.checks,
          },
          this.state.webAccess,
        );
        await this.reloadSelected();
      } catch {
        this.update({ permissions: { writes: false, checks: false } });
        if (this.state.status === "ready") {
          await this.open(this.state.askEachRead);
          await this.reloadSelected();
        }
        throw new BoundaryError(
          "Desktop permissions could not be enabled; no effect permissions were retained",
        );
      }
      return;
    }
    if (command.type === "web.permissions") {
      this.selected(command.sessionId);
      const access = normalizeDesktopWebAccess({
        allowedOrigins: command.allowedOrigins,
        dns: command.dns,
      });
      const target = this.state.reportTarget;
      const permissions = this.state.permissions;
      this.update({ webAccess: EMPTY_WEB_ACCESS, pendingApproval: null });
      try {
        await this.open(this.state.askEachRead, target, permissions, access);
        await this.reloadSelected();
      } catch {
        this.update({ webAccess: EMPTY_WEB_ACCESS });
        if (this.state.status === "ready") {
          await this.open(this.state.askEachRead, target, permissions);
          await this.reloadSelected();
        }
        throw new BoundaryError(
          "Web access could not be changed; no network permission was retained",
        );
      }
      return;
    }
    if (command.type === "effects") {
      this.selected(command.sessionId);
      await this.refreshArtifacts(command.offset, "effects");
      return;
    }
    if (command.type === "effect.inspect") {
      const workspace = this.selected(command.sessionId);
      this.update({ effectInspection: null });
      const effect = this.state.effects.items.find((item) => item.effectId === command.effectId);
      if (!effect) throw new BoundaryError("Select a recorded operation first");
      this.update({ effectInspection: inspectEffectFile(workspace, effect, this.excluded()) });
      return;
    }
    if (command.type === "materials") {
      const workspace = this.selected(command.sessionId);
      if (command.paths.length)
        this.update({ materials: inspectMaterials(workspace, command.paths, this.excluded()) });
      return;
    }
    if (command.type === "material.remove") {
      this.selected(command.sessionId);
      this.update({ materials: this.state.materials.filter((item) => item.path !== command.path) });
      return;
    }
    if (command.type === "report.target" || command.type === "report.clear") {
      const workspace = this.selected(command.sessionId);
      if (command.type === "report.target" && command.path === null) return;
      const target =
        command.type === "report.clear"
          ? null
          : reportTarget(workspace, command.path as string, this.excluded());
      await this.changeReport(target);
      return;
    }
    if (command.type === "artifacts") {
      this.selected(command.sessionId);
      await this.refreshArtifacts(command.offset, "artifacts");
      return;
    }
    if (command.type === "artifact.close") {
      this.update({ artifactPreview: null });
      return;
    }
    if (command.type === "artifact.open") {
      const workspace = this.selected(command.sessionId);
      const artifact = this.state.artifacts.items.find(
        (item) => item.effectId === command.effectId,
      );
      this.update({ artifactPreview: null });
      if (!artifact) throw new BoundaryError("Select a recorded report first");
      const checked = inspectReport(workspace, artifact, this.excluded());
      this.update({
        artifacts: {
          ...this.state.artifacts,
          items: this.state.artifacts.items.map((item) =>
            item.effectId === artifact.effectId ? { ...item, state: checked.state } : item,
          ),
        },
        artifactPreview: checked.preview ?? null,
      });
      if (checked.state !== "current")
        throw new BoundaryError(`Report is ${checked.state}; the recorded version was not opened`);
      return;
    }
    if (command.type === "list") {
      await this.send({ type: "session.list", offset: command.offset, limit: 20 });
      return;
    }
    if (command.type === "start") {
      const workspace = this.selected(command.sessionId);
      if (!this.state.connection.ready)
        throw new BoundaryError("The model connection is unavailable");
      const input = [{ type: "text" as const, text: command.text }];
      if (this.state.materials.length) {
        const current = inspectMaterials(
          workspace,
          this.state.materials.map((item) => item.path),
          this.excluded(),
        );
        if (JSON.stringify(current) !== JSON.stringify(this.state.materials))
          throw new BoundaryError("Selected documents changed; select them again before sending");
        input.push({
          type: "text",
          text: `Selected workspace documents (file identity only; contents have not been extracted):\n${JSON.stringify(current)}`,
        });
      }
      if (this.state.reportTarget)
        input.push({
          type: "text",
          text: `Selected new report destination: ${JSON.stringify(this.state.reportTarget)}. Only create at this exact relative path is enabled, with approval; existing files cannot be edited or overwritten.`,
        });
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
      for (const result of body.results) {
        const source = projectWebSource(
          entry.id,
          entry.createdAt,
          result,
          this.toolNames.get(result.callId),
        );
        if (source) this.update({ sources: appendWebSource(this.state.sources, source) });
        else if (this.toolNames.get(result.callId) === "web_fetch" && result.status === "succeeded")
          this.update({ sources: { ...this.state.sources, truncated: true } });
      }
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
    } else if (body.kind === "notice")
      this.add({
        id: entry.id,
        role: "notice",
        text:
          body.code === "evidence_answer"
            ? "调查阶段结束，正在用原问题和实际工具证据独立成文。先前回答保留为调查记录；仍使用本轮原预算，完成后也需核对事实。"
            : body.text,
      });
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
        this.update({
          run: { id: event.runId, state: "running" },
          outcome: null,
          streamText: "",
          artifactPreview: null,
          effectInspection: null,
        });
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
        if (this.state.effects.offset === 0) {
          const previous = this.state.effects.items;
          const projected = {
            effectId: event.effect.id,
            runId: event.effect.runId,
            tool: event.effect.tool,
            state: event.effect.state,
            updatedAt: event.effect.updatedAt,
            receipt: null,
          };
          const items = [
            projected,
            ...previous.filter((item) => item.effectId !== projected.effectId),
          ];
          this.update({
            effects: {
              offset: 0,
              hasMore: this.state.effects.hasMore || items.length > 20,
              items: items.slice(0, 20),
            },
          });
        }
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
          ...(event.preview === undefined ? {} : { preview: event.preview }),
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
        this.scheduleArtifacts();
        break;
      case "command.rejected":
        this.commandError =
          event.reason ===
          "Evidence answer requires a new session. Disable it to continue this conversation; history was not changed."
            ? "独立证据成文仅适用于新会话。请新建会话，或在模型设置中关闭后继续；历史未修改。"
            : event.reason ===
                "Evidence answer cannot accept steering. Cancel and start a new self-contained session."
              ? "独立证据成文不支持追加指令。请取消后在新会话提出完整问题；没有补发请求。"
              : "The runtime rejected this command; refresh the current state before trying again";
        this.update({ error: this.commandError });
        break;
      case "plugin.status":
        if (event.state === "failed") {
          this.pluginWarning = "A runtime plugin is unavailable; some capabilities may not work";
          this.update({ error: this.pluginWarning });
        }
        break;
      case "session.results":
        if (
          event.page.sessionId !== this.state.activeSessionId ||
          event.page.workspaceRoot !== this.state.workspaceRoot
        )
          return;
        this.update({
          ...(this.resultsDestination !== "artifacts"
            ? {
                effects: {
                  offset: event.page.offset,
                  hasMore: event.page.hasMore,
                  items: event.page.effects,
                },
                effectInspection: null,
              }
            : {}),
          ...(this.resultsDestination !== "effects"
            ? {
                artifacts: {
                  offset: event.page.offset,
                  hasMore: event.page.hasMore,
                  items: event.page.effects.flatMap((effect) =>
                    effect.tool === "create" &&
                    effect.state === "succeeded" &&
                    effect.receipt?.kind === "file" &&
                    effect.receipt.beforeHash === null &&
                    effect.receipt.afterHash !== null
                      ? [
                          {
                            effectId: effect.effectId,
                            path: effect.receipt.path,
                            afterHash: effect.receipt.afterHash,
                            state: "unchecked" as const,
                          },
                        ]
                      : [],
                  ),
                },
                artifactPreview: null,
              }
            : {}),
        });
        break;
    }
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.update({ status: "closing", webAccess: EMPTY_WEB_ACCESS });
    this.closing = (async () => {
      try {
        await this.operation?.catch(() => {});
        await this.runtime?.close();
      } finally {
        this.unsubscribe?.();
        this.runtime = undefined;
        this.approvals.clear();
        this.update({
          status: "closed",
          run: null,
          pendingApproval: null,
          reportTarget: null,
          permissions: { writes: false, checks: false },
          effectInspection: null,
        });
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
