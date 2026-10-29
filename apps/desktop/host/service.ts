import { initializationError } from "./initialization.ts";
import type { DesktopHost, DesktopHostOptions } from "./types.ts";

export { DesktopInitializationError } from "./initialization.ts";
export type { DesktopHost, DesktopHostOptions } from "./types.ts";

import type { ClientCommand, RuntimeEvent, SessionId, SessionQuery } from "moyyi/contracts";
import type { Runtime, RuntimeOptions } from "moyyi/runtime";
import type {
  DesktopApproval,
  DesktopCommand,
  DesktopPermissions,
  DesktopSessionSummary,
  DesktopState,
  DesktopWebAccess,
} from "../shared.ts";
import { BoundaryError, type HostContext, HostFeatures } from "./feature.ts";
import { hostFeatures } from "./feature-registry.ts";
import { changeReport, openRuntime, reloadSelected } from "./lifecycle.ts";
import { ManagedMaterials } from "./managed-materials.ts";
import { FileBoundaryError } from "./materials.ts";
import { initialState } from "./state.ts";
import { type HostTransition, transitionPatch } from "./transitions.ts";
import { parseDesktopCommand } from "./validation.ts";
import { EMPTY_WEB_ACCESS } from "./web.ts";

class Host implements DesktopHost, HostContext {
  readonly features = new HostFeatures(hostFeatures);
  runtime: Runtime | undefined;
  materialAbort: AbortController | undefined;
  unsubscribe: (() => void) | undefined;
  eventDepth = 0;
  eventChanged = false;
  readonly listeners = new Set<(state: DesktopState) => void>();
  readonly knownSessions = new Map<string, DesktopSessionSummary>();
  readonly approvals = new Map<string, DesktopApproval>();
  readonly replying = new Set<string>();
  readonly effectRuns = new Map<string, string>();
  readonly toolNames = new Map<string, string>();
  readonly entryIds = new Set<string>();
  operation: Promise<void> | undefined;
  closing: Promise<void> | undefined;
  pendingWorkspace: string | undefined;
  expectedSession: string | undefined;
  commandError: string | null = null;
  pluginWarning: string | null = null;
  state: DesktopState;
  eventState: DesktopState;
  options: RuntimeOptions;
  readonly configure: DesktopHostOptions["configure"];
  refresh: Promise<void> | undefined;
  resultsDestination: "both" | "artifacts" | "effects" = "both";

  constructor(
    options: RuntimeOptions,
    display: Pick<DesktopHostOptions, "connection" | "maxOutputTokens" | "settings" | "configure">,
  ) {
    this.options = options;
    this.configure = display.configure;
    this.state = initialState(options, display);
    this.eventState = this.state;
  }

  async initialize(): Promise<void> {
    await this.open(false);
    await this.send({ type: "session.list", offset: 0, limit: 20 });
    await this.catalog();
  }

  getState(): DesktopState {
    return structuredClone(this.state);
  }

  subscribe(listener: (state: DesktopState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  transition(name: HostTransition, change: Partial<DesktopState>): void {
    this.update({ ...transitionPatch(name), ...change });
  }

  update(change: Partial<DesktopState>): void {
    this.state = { ...this.state, ...change };
    if (this.eventDepth) {
      this.eventChanged = true;
      return;
    }
    this.publish();
  }

  publish(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.getState());
      } catch {
        // A view cannot stop recording, cancellation or another view's state delivery.
      }
    }
  }

  fail(message: string): never {
    this.update({ error: message });
    throw Error(message);
  }

  open(
    askEachRead: boolean,
    target: string | null = null,
    permissions: DesktopPermissions = { writes: false, checks: false },
    webAccess: DesktopWebAccess = EMPTY_WEB_ACCESS,
  ): Promise<void> {
    return openRuntime(this, askEachRead, target, permissions, webAccess);
  }

  async send(command: ClientCommand): Promise<void> {
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
    if (command.type === "material.cancel") {
      await this.features.action(this, command);
      return this.getState();
    }
    if (command.type === "close") {
      await this.features.action(this, command);
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

  safeError(error: unknown): string {
    return error instanceof BoundaryError || error instanceof FileBoundaryError
      ? error.message
      : "Desktop operation failed safely";
  }

  excluded(): readonly string[] {
    return [
      ...(this.options.protectedPaths ?? []),
      ...(this.options.dataDirectory ? [this.options.dataDirectory] : []),
    ];
  }

  selected(sessionId: string): string {
    if (sessionId !== this.state.activeSessionId || !this.state.workspaceRoot)
      throw new BoundaryError("Session is not selected");
    return this.state.workspaceRoot;
  }

  async refreshArtifacts(
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

  scheduleArtifacts(): void {
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

  reloadSelected(): Promise<void> {
    return reloadSelected(this);
  }

  changeReport(target: string | null): Promise<void> {
    return changeReport(this, target);
  }

  materialManager(): ManagedMaterials {
    if (!this.runtime?.materials) throw new FileBoundaryError("Managed materials are unavailable");
    return new ManagedMaterials(this.runtime.materials, { excluded: this.excluded() });
  }
  async refreshMaterials(offset = 0): Promise<void> {
    await this.features.refreshMaterials(this, offset);
  }

  async catalog(query: SessionQuery = {}): Promise<void> {
    await this.features.catalog(this, query);
  }

  async perform(command: Exclude<DesktopCommand, { type: "close" }>): Promise<void> {
    if (command.type !== "approve" && command.type !== "cancel") {
      await this.refresh;
      // run.finished is emitted just before core cleanup settles. Do not race the next admission.
      await this.runtime?.idle();
      if (this.state.status !== "ready") throw new BoundaryError("Desktop host is closing");
    }
    if (
      this.state.historyOnly &&
      ["permissions", "web.permissions", "report.target", "report.clear", "materials"].includes(
        command.type,
      )
    )
      throw new BoundaryError(
        "This session is open for history only; restore it and reopen an available workspace first",
      );
    await this.features.action(this, command);
  }

  event(event: RuntimeEvent): void {
    if (event.type === "entry.appended") {
      if (event.entry.sessionId !== this.state.activeSessionId || this.entryIds.has(event.entry.id))
        return;
      this.entryIds.add(event.entry.id);
    }
    this.eventState = this.state;
    this.eventDepth += 1;
    try {
      this.features.event(this, event);
      switch (event.type) {
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
      }
    } finally {
      this.eventDepth -= 1;
      if (this.eventDepth === 0 && this.eventChanged) {
        this.eventChanged = false;
        this.publish();
      }
    }
  }

  close(): Promise<void> {
    this.materialAbort?.abort();
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
