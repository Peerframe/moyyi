import { createHash, randomUUID } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { MinimalContextBuilder } from "../context/index.ts";
import {
  type ActionDigest,
  type ClientCommand,
  type Clock,
  canonicalizeJson,
  type IdSource,
  type ModelClient,
  type ModelOrigin,
  type ModelProvider,
  type ModelRecording,
  type ModelRecordingSink,
  type PermissionPolicy,
  type PolicyDecision,
  type PreconditionVerifier,
  type RunLimits,
  type RuntimeEvent,
  type Scheduler,
  type SessionStore,
  type Timestamp,
} from "../contracts/index.ts";
import { AgentCore } from "../core/index.ts";
import { defaultInstructionsPlugin } from "../plugins/default-instructions/index.ts";
import { documentsPlugin } from "../plugins/documents/index.ts";
import { fsPlugin } from "../plugins/fs/index.ts";
import { projectInstructionsPlugin } from "../plugins/project-instructions/index.ts";
import {
  ANTHROPIC_API_PROFILE,
  type AnthropicTransport,
  createAnthropicPlugin,
} from "../plugins/provider-anthropic/index.ts";
import {
  createDeepSeekPlugin,
  DEEPSEEK_API_PROFILE,
  type DeepSeekReasoningEffort,
  type DeepSeekTransport,
  deepSeekApiProfile,
  resolveDeepSeekReasoningEffort,
} from "../plugins/provider-deepseek/index.ts";
import { shellPlugin } from "../plugins/shell/index.ts";
import { skillsPlugin } from "../plugins/skills/index.ts";
import { createWebPlugin } from "../plugins/web/index.ts";
import { workspaceNavigationPlugin } from "../plugins/workspace-navigation/index.ts";
import {
  ReadOnlyPolicy,
  WebPolicy,
  WorkspaceProcessPolicy,
  WorkspaceWritePolicy,
} from "../policy/index.ts";
import { SqliteSessionStore } from "../store/index.ts";
import { type AnthropicHttpOptions, anthropicHttpTransport } from "./anthropic-http.ts";
import { type DeepSeekHttpOptions, deepSeekHttpTransport } from "./deepseek-http.ts";
import { NodeWorkspaceDocuments } from "./documents.ts";
import { NodeWorkspaceFiles } from "./files.ts";
import { collectContext } from "./instructions.ts";
import { FileRecordingSink, RecordingModelClient, ReplayModelClient } from "./model-recording.ts";
import { type PluginEntry, PluginRegistry, type PluginStatus } from "./plugins.ts";
import { WorkspacePreconditions } from "./preconditions.ts";
import { NodeWorkspaceProcesses } from "./processes.ts";
import { type SkillSelection, selectSkills } from "./skills.ts";
import { AjvArgumentValidator } from "./validation.ts";
import { NodeWebAccess, type WebAccessOptions } from "./web.ts";
import type { WebHttpDependencies } from "./web-http.ts";
import { NodeWorkspaceWrites } from "./writes.ts";

export { FileRecordingSink, loadModelRecordings } from "./model-recording.ts";
export type { PluginEntry, PluginStatus } from "./plugins.ts";
// Trusted installed hosts use the same bounded helpers as source checkouts, without reaching
// into package-private module paths. These exports do not grant a runtime any capabilities.
export {
  ANTHROPIC_API_PROFILE,
  DEEPSEEK_API_PROFILE,
  type DeepSeekReasoningEffort,
  deepSeekApiProfile,
  ReadOnlyPolicy,
  WebPolicy,
  WorkspaceProcessPolicy,
  WorkspaceWritePolicy,
};

/**
 * Composition root: loads plugins, wires concrete store, context and policy into the core,
 * and serves the client protocol. Clients talk to this and nothing else.
 */
export interface Runtime {
  /** Load results, so a client can show which plugins failed instead of assuming readiness. */
  readonly plugins: readonly PluginStatus[];
  send(command: ClientCommand): Promise<void>;
  subscribe(listener: (event: RuntimeEvent) => void): () => void;
  /** Wait for current runs; send(run.start) only waits for acceptance. */
  idle(): Promise<void>;
  readonly diagnostics: readonly string[];
  close(): Promise<void>;
}

export interface DevelopmentPlugin {
  readonly name: string;
  /** Explicit trusted code; invoked only at startup or an idle reload. */
  readonly load: () => Promise<PluginEntry>;
}

export interface RuntimeOptions {
  /** Fixed offline document extraction uses the read grant; false disables the tool and port. */
  readonly documents?: false;
  /** Explicit trusted library root and activated names; no automatic scanning or installation. */
  readonly skills?: SkillSelection;
  /** Disable automatic root AGENTS.md reads. Default working instructions remain enabled. */
  readonly projectInstructions?: false;
  /** Explicit opt-in for bounded path-only navigation; omitted or false performs no scan. */
  readonly workspaceNavigation?: boolean;
  readonly developmentPlugins?: readonly DevelopmentPlugin[];
  readonly plugins?: readonly PluginEntry[];
  readonly model?: ModelOrigin;
  readonly dataDirectory?: string;
  /** Injected stores remain owned by their caller. */
  readonly store?: SessionStore;
  readonly policy?: PermissionPolicy;
  readonly preconditions?: PreconditionVerifier;
  readonly limits?: Partial<RunLimits>;
  readonly clock?: Clock;
  readonly ids?: IdSource;
  readonly scheduler?: Scheduler;
  /** Additional absolute host paths to exclude, e.g. a custom store's private data directory. */
  readonly protectedPaths?: readonly string[];
  /** Host-owned, exact selected roots; absent means writes stay unavailable. Lifetime is this runtime. */
  readonly workspaceWrites?: {
    readonly roots: readonly string[];
    readonly approval?: "ask" | "allow";
  };
  /** Separate host opt-in for sandboxed commands; no credential or network inheritance. */
  readonly workspaceProcesses?: {
    /** CLI checks select read-only; existing explicit hosts retain read-write by default. */
    readonly workspaceAccess?: "read-only" | "read-write";
    readonly roots: readonly string[];
    readonly approval?: "ask" | "allow";
    /** Additional trusted, read-only toolchain directories; never model-supplied. */
    readonly executablePaths?: readonly string[];
    /** Explicit read-only libraries required by selected toolchains. */
    readonly readOnlyPaths?: readonly string[];
  };
  /** Explicit host connection only; no environment lookup or network before a model request. */
  readonly deepseek?: DeepSeekHttpOptions | { readonly transport: DeepSeekTransport };
  /** Host-selected for this runtime, including replay. Omission preserves the high default. */
  readonly deepseekReasoningEffort?: DeepSeekReasoningEffort;
  readonly anthropic?:
    | AnthropicHttpOptions
    | { readonly transport: AnthropicTransport; readonly accountScope: string };
  /** Separate tool-network grant; never inferred from a selected model or workspace. */
  readonly web?: WebAccessOptions & { readonly approval?: "ask" | "allow" };
  /** Opt-in diagnostic recording, limited to one sequential request stream per runtime. */
  readonly modelRecording?: {
    readonly sink: ModelRecordingSink;
    readonly apiProfile: string;
    readonly source: "live" | "synthetic";
  };
  /** Replaces the selected provider's client; never falls back to a live request. */
  readonly modelReplay?: {
    readonly records: readonly ModelRecording[];
    readonly apiProfile: string;
  };
}

/** Trusted test-only I/O substitutions; not host-file settings or model/tool arguments. */
export interface RuntimeServices {
  readonly webHttp?: WebHttpDependencies;
}

export async function createRuntime(
  options: RuntimeOptions = {},
  services: RuntimeServices = {},
): Promise<Runtime> {
  if (options.documents !== undefined && options.documents !== false)
    throw Error("Document configuration must be false or omitted");
  const documentsEnabled = options.documents !== false;
  if (options.workspaceNavigation !== undefined && typeof options.workspaceNavigation !== "boolean")
    throw Error("Workspace navigation must be a boolean");
  const workspaceNavigation = options.workspaceNavigation === true;
  const model = options.model ? { ...options.model } : undefined;
  const deepseekReasoningEffort = resolveDeepSeekReasoningEffort(options.deepseekReasoningEffort);
  if (options.deepseekReasoningEffort !== undefined && model?.provider !== "deepseek")
    throw Error("DeepSeek reasoning effort requires a selected DeepSeek model");
  if (options.deepseekReasoningEffort !== undefined && !options.deepseek && !options.modelReplay)
    throw Error("DeepSeek reasoning effort requires a built-in connection or replay");
  // Freeze recording identity before plugin setup can yield to caller mutations.
  const modelRecording = options.modelRecording ? { ...options.modelRecording } : undefined;
  const modelReplay = options.modelReplay ? { ...options.modelReplay } : undefined;
  const skills = selectSkills(options.skills);
  if (options.developmentPlugins?.length && (modelRecording || modelReplay))
    throw Error("Development reload cannot be combined with recording or replay");
  if ((modelRecording && modelReplay) || (modelReplay && (options.deepseek || options.anthropic)))
    throw Error("Replay cannot be combined with live connection or recording options");
  if ((modelRecording || modelReplay || options.deepseek || options.anthropic) && !model)
    throw Error("Model transport/recording requires an explicitly selected model");
  for (const recording of [modelRecording, modelReplay]) {
    if (
      recording &&
      model?.provider === "anthropic" &&
      recording.apiProfile !== ANTHROPIC_API_PROFILE
    )
      throw Error("Anthropic recording profile does not match the configured adapter");
    if (
      recording &&
      model?.provider === "deepseek" &&
      recording.apiProfile !== deepSeekApiProfile(deepseekReasoningEffort)
    )
      throw Error("DeepSeek recording profile does not match the configured adapter");
  }
  const replayClient = modelReplay
    ? new ReplayModelClient(modelReplay.records, { apiProfile: modelReplay.apiProfile })
    : undefined;
  const transport = options.deepseek
    ? "transport" in options.deepseek
      ? options.deepseek.transport
      : deepSeekHttpTransport(options.deepseek)
    : undefined;
  const deepseek =
    transport || (modelReplay && model?.provider === "deepseek")
      ? createDeepSeekPlugin(
          transport ??
            (async () => {
              throw Error("Replay cannot access the network");
            }),
          { reasoningEffort: deepseekReasoningEffort },
        )
      : undefined;
  const anthropicTransport = options.anthropic
    ? "transport" in options.anthropic
      ? options.anthropic.transport
      : anthropicHttpTransport(options.anthropic)
    : undefined;
  const anthropic =
    anthropicTransport || (modelReplay && model?.provider === "anthropic")
      ? createAnthropicPlugin(
          anthropicTransport ??
            (async () => {
              throw Error("Replay cannot access the network");
            }),
          { accountScope: options.anthropic?.accountScope ?? "offline-replay" },
        )
      : undefined;
  const web = options.web ? new NodeWebAccess(options.web, services.webHttp) : undefined;
  const writeRoots = options.workspaceWrites?.roots.map((root) => {
    if (!isAbsolute(root) || !lstatSync(root).isDirectory() || lstatSync(root).isSymbolicLink())
      throw Error("Write grants require absolute, real workspace directories");
    return realpathSync(root);
  });
  if (writeRoots && !writeRoots.length) throw Error("Write grants require at least one workspace");
  const filePolicy = options.workspaceWrites
    ? new WorkspaceWritePolicy({ approval: options.workspaceWrites.approval ?? "ask" })
    : new ReadOnlyPolicy();
  const localPolicy = options.workspaceProcesses
    ? new WorkspaceProcessPolicy({
        files: filePolicy,
        approval: options.workspaceProcesses.approval ?? "ask",
      })
    : filePolicy;
  const base =
    options.policy ??
    (options.web
      ? new WebPolicy({
          previous: localPolicy,
          approval: options.web.approval ?? "ask",
          fetch: options.web.allowedOrigins.length > 0,
          search: !!options.web.search,
        })
      : localPolicy);
  const stricter = (
    first: PolicyDecision,
    second: Exclude<PolicyDecision, { kind: "allow" }> | null,
  ): PolicyDecision => {
    if (first.kind === "deny") return first;
    if (second?.kind === "deny") return second;
    return first.kind === "ask" || second?.kind === "ask" ? { kind: "ask" } : { kind: "allow" };
  };
  const registry = new PluginRegistry();
  const plugins: PluginStatus[] = [];
  const startup = [
    { plugin: defaultInstructionsPlugin },
    ...(options.projectInstructions === false ? [] : [{ plugin: projectInstructionsPlugin }]),
    ...(skills?.enabled.length ? [{ plugin: skillsPlugin }] : []),
    ...(workspaceNavigation ? [{ plugin: workspaceNavigationPlugin }] : []),
    { plugin: fsPlugin },
    ...(documentsEnabled ? [{ plugin: documentsPlugin }] : []),
    { plugin: shellPlugin },
    { plugin: createWebPlugin(options.web?.search?.origin) },
    ...(anthropic ? [{ plugin: anthropic }] : []),
    ...(deepseek ? [{ plugin: deepseek }] : []),
    ...(options.plugins ?? []),
  ];
  const development = new Map<string, DevelopmentPlugin>();
  const reserved = new Set(startup.map(({ plugin }) => plugin.name));
  for (const entry of options.developmentPlugins ?? []) {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(entry.name) || typeof entry.load !== "function")
      throw Error("Invalid development plugin entry");
    if (reserved.has(entry.name) || development.has(entry.name))
      throw Error("Development plugin names must be unique and cannot replace startup plugins");
    development.set(entry.name, entry);
  }
  for (const entry of startup) plugins.push(await registry.load(entry));

  const listeners = new Set<(event: RuntimeEvent) => void>();
  const diagnostics: string[] = [];
  const activeRuns = new Set<string>();
  const commands = new Set<Promise<void>>();
  let closed = false;
  let reloading = false;
  let closing: Promise<void> | undefined;
  const emit = (event: RuntimeEvent) => {
    if (event.type === "run.started") activeRuns.add(event.runId);
    if (event.type === "run.finished") activeRuns.delete(event.runId);
    // Observers receive an immutable copy, so mutating a displayed approval cannot alter work.
    const copy = freeze(JSON.parse(canonicalizeJson(event))) as RuntimeEvent;
    for (const listener of listeners) {
      try {
        const returned: unknown = listener(copy);
        if (returned instanceof Promise)
          void returned.catch(() => diagnostics.push("Event listener rejected"));
      } catch {
        diagnostics.push("Event listener threw");
      }
    }
    registry.emit(copy);
  };
  const reject = (command: string, reason: string) =>
    emit({ type: "command.rejected", command, reason });
  const status = (next: PluginStatus, notify = true) => {
    const index = plugins.findIndex((entry) => entry.name === next.name);
    if (index < 0) plugins.push(next);
    else plugins[index] = next;
    if (notify) emit({ type: "plugin.status", ...next });
  };
  const loadDevelopment = async (entry: DevelopmentPlugin): Promise<PluginStatus> => {
    try {
      const loaded = await entry.load();
      if (closed) return { name: entry.name, state: "failed", error: "Runtime is closing" };
      if (loaded.plugin.name !== entry.name)
        return {
          name: entry.name,
          state: "failed",
          error: "Development plugin export is invalid; check its configured name",
        };
      const result = await registry.load(loaded);
      return result.state === "loaded"
        ? { name: entry.name, state: "loaded" }
        : {
            name: entry.name,
            state: "failed",
            error: "Development plugin setup failed; fix it and reload",
          };
    } catch {
      // Trusted module errors can still contain credentials; never put their text in client events.
      return {
        name: entry.name,
        state: "failed",
        error: "Development plugin import failed; fix the entry and reload",
      };
    }
  };
  for (const entry of development.values()) status(await loadDevelopment(entry), false);

  let ownedStore: SqliteSessionStore | undefined;
  let core: AgentCore | undefined;
  let recorder: RecordingModelClient | undefined;
  let selectedProvider: ModelProvider | undefined;
  let selectedClient: ModelClient | undefined;
  let store: SessionStore | undefined;
  let recovered = false;
  let unavailable = "Model and storage are not configured";

  const policy: PermissionPolicy = {
    revision: () => base.revision?.() ?? 0,
    beforeContextRead: (path, operation = "read") => {
      try {
        const initial = base.beforeContextRead?.(path, operation);
        if (!initial || !["allow", "ask", "deny"].includes(initial.kind))
          return { kind: "deny", reason: "Automatic context reads are not granted" };
        const profile = {
          class: "read",
          reversibility: "not_applicable",
          verification: "not_applicable",
        } as const;
        const args = { path };
        return stricter(
          stricter(
            initial,
            registry.evaluatePolicy({ tool: operation, profile, args, phase: "prepare" }),
          ),
          registry.evaluatePolicy({ tool: operation, profile, args, phase: "execute" }),
        );
      } catch {
        return { kind: "deny", reason: "Automatic context reads are not granted" };
      }
    },
    beforePrepare: (tool, profile, args) =>
      stricter(
        base.beforePrepare(tool, profile, args),
        registry.evaluatePolicy({ tool, profile, args, phase: "prepare" }),
      ),
    beforeExecute: (tool, profile, action, effectId, args) =>
      stricter(
        base.beforeExecute(tool, profile, action, effectId, args),
        registry.evaluatePolicy({ tool, profile, args, phase: "execute" }),
      ),
  };
  const unload = async () => {
    for (const entry of [...plugins].reverse()) await registry.unload(entry.name);
  };
  const wireCore = async (allowMissing: boolean) => {
    core = undefined;
    if (!model || !store) return;
    const provider = registry.providers.find((item) => item.id === model?.provider);
    const profile = provider?.models.find(
      (item) => item.origin.provider === model?.provider && item.origin.model === model.model,
    );
    if (!provider || !profile) {
      selectedProvider = undefined;
      selectedClient = undefined;
      unavailable = "Configured model is not registered";
      if (!allowMissing) throw Error(unavailable);
      return;
    }
    // A tool-only reload must not restart an unrelated provider's private session/cursor state.
    if (provider !== selectedProvider || !selectedClient) {
      selectedProvider = provider;
      try {
        selectedClient = replayClient ?? provider.createClient(profile.origin.model);
      } catch (error) {
        const owner = registry.providerOwner(provider.id);
        if (!owner || !development.has(owner)) throw error;
        await registry.unload(owner);
        selectedProvider = undefined;
        selectedClient = undefined;
        unavailable = "Configured development model failed initialization; fix it and reload";
        const failed: PluginStatus = {
          name: owner,
          state: "failed",
          error: "Development plugin model initialization failed; fix it and reload",
        };
        status(failed, false);
        return failed;
      }
      if (modelRecording) {
        recorder = new RecordingModelClient(selectedClient, modelRecording.sink, modelRecording);
        selectedClient = recorder;
      }
    }
    const excluded = [
      ...(store instanceof SqliteSessionStore ? [store.directory] : []),
      ...(modelRecording?.sink instanceof FileRecordingSink ? [modelRecording.sink.directory] : []),
      ...(options.protectedPaths ?? []),
    ];
    // Only the durable, snapshot-aware host store can enable the built-in mutation capability.
    if (writeRoots && !(store instanceof SqliteSessionStore))
      throw Error("Workspace writes require the snapshot-aware SQLite store");
    const writes = writeRoots
      ? new NodeWorkspaceWrites(store as SqliteSessionStore, excluded)
      : undefined;
    const processes = options.workspaceProcesses
      ? new NodeWorkspaceProcesses({ ...options.workspaceProcesses, protectedPaths: excluded })
      : undefined;
    const files = new NodeWorkspaceFiles(excluded);
    const documents = documentsEnabled ? new NodeWorkspaceDocuments(files) : undefined;
    core = new AgentCore({
      model: selectedClient,
      profile,
      tools: registry.tools,
      store,
      policy,
      context: new MinimalContextBuilder(),
      validator: new AjvArgumentValidator(),
      preconditions: options.preconditions ?? new WorkspacePreconditions(),
      files,
      ...(documents ? { documents } : {}),
      ...(web ? { web } : {}),
      ...(processes ? { processes } : {}),
      ...(writes
        ? {
            writes: {
              create(context, guard, scope) {
                const scopedGuard = () => {
                  guard();
                  if (!writeRoots?.includes(realpathSync(context.workspaceRoot)))
                    throw Error("Workspace is outside the explicit write grant");
                };
                scopedGuard();
                return writes.create(context, scopedGuard, scope);
              },
            } satisfies import("../contracts/index.ts").WorkspaceWritesFactory,
          }
        : {}),
      hasher: {
        digest: (value) =>
          `sha256:${createHash("sha256").update(canonicalizeJson(value)).digest("hex")}` as ActionDigest,
      },
      scheduler: options.scheduler ?? nodeScheduler,
      clock: options.clock ?? { now: () => new Date().toISOString() as Timestamp },
      ids: options.ids ?? { next: (prefix) => `${prefix}_${randomUUID()}` },
      emit,
      collect: (workspaceRoot, signal) =>
        collectContext(
          registry.contextSources,
          files,
          policy,
          workspaceRoot,
          profile,
          signal,
          options.projectInstructions !== false,
          skills,
          workspaceNavigation,
        ),
      ...(options.limits === undefined ? {} : { limits: options.limits }),
    });
    if (!recovered) {
      await core.recover();
      recovered = true;
    }
  };
  try {
    if (options.store && options.dataDirectory)
      throw Error("Choose a store or dataDirectory, not both");
    if (model) {
      if (options.dataDirectory) ownedStore = new SqliteSessionStore(options.dataDirectory);
      store = options.store ?? ownedStore;
      if (!store) throw Error("A configured model requires persistent storage");
      await wireCore(development.size > 0);
    } else if (options.store || options.dataDirectory)
      throw Error("Storage requires an explicitly selected model");
  } catch (error) {
    ownedStore?.close();
    await unload();
    throw error;
  }
  const track = (pending: Promise<void>): Promise<void> => {
    commands.add(pending);
    void pending.then(
      () => commands.delete(pending),
      () => commands.delete(pending),
    );
    return pending;
  };
  const reload = async (entry: DevelopmentPlugin) => {
    try {
      await core?.close();
      core = undefined;
      // A cached module may re-register the same provider object after its disposal closed
      // the client. Ownership, not object identity alone, decides whether reuse is safe.
      if (selectedProvider && registry.providerOwner(selectedProvider.id) === entry.name) {
        selectedProvider = undefined;
        selectedClient = undefined;
      }
      await registry.unload(entry.name);
      if (closed) return;
      let next = await loadDevelopment(entry);
      if (closed) {
        await registry.unload(entry.name);
        return;
      }
      try {
        const failed = await wireCore(true);
        if (failed?.name === entry.name) next = failed;
        else if (failed) status(failed);
      } catch {
        // A provider that cannot create its client is not a usable replacement.
        await registry.unload(entry.name);
        selectedProvider = undefined;
        selectedClient = undefined;
        core = undefined;
        next = {
          name: entry.name,
          state: "failed",
          error: "Development plugin model initialization failed; fix it and reload",
        };
        try {
          await wireCore(true);
        } catch {
          unavailable = "Model initialization failed";
        }
      }
      status(next);
    } finally {
      reloading = false;
    }
  };
  return {
    get plugins() {
      return plugins.map((entry) => ({ ...entry }));
    },
    get diagnostics() {
      return [...diagnostics, ...registry.diagnostics];
    },
    send(command) {
      if (closed) {
        reject(command.type, "Runtime is closed");
        return Promise.resolve();
      }
      if (command.type === "plugin.reload") {
        const entry = development.get(command.name);
        if (!entry) reject(command.type, "Plugin is not configured for development reload");
        else if (reloading || commands.size || activeRuns.size)
          reject(
            command.type,
            "Plugin reload requires an idle runtime; retry after the run finishes",
          );
        else {
          // Set admission synchronously before the first await; no run can enter this window.
          reloading = true;
          return track(reload(entry));
        }
        return Promise.resolve();
      }
      if (reloading) {
        reject(command.type, "Plugin reload is in progress");
        return Promise.resolve();
      }
      if (!core) {
        reject(command.type, unavailable);
        return Promise.resolve();
      }
      return track(core.send(command));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async idle() {
      await Promise.all([...commands]);
      await core?.idle();
      await recorder?.flush();
    },
    close() {
      if (closing) return closing;
      closed = true;
      closing = (async () => {
        const stopping = core?.close();
        await Promise.all([...commands]);
        await stopping;
        await core?.close();
        try {
          await recorder?.flush();
        } finally {
          listeners.clear();
          ownedStore?.close();
          await unload();
        }
      })();
      return closing;
    },
  };
}

export const nodeScheduler: Scheduler = {
  async sleep(milliseconds, signal) {
    if (!signal.aborted) await delay(milliseconds, undefined, { signal });
  },
  deadline(milliseconds, callback) {
    const timer = setTimeout(callback, milliseconds);
    return () => clearTimeout(timer);
  },
};

function freeze(value: unknown): unknown {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
