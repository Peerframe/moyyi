import { createHash, randomUUID } from "node:crypto";
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
import { fsPlugin } from "../plugins/fs/index.ts";
import {
  createDeepSeekPlugin,
  DEEPSEEK_API_PROFILE,
  type DeepSeekTransport,
} from "../plugins/provider-deepseek/index.ts";
import { ReadOnlyPolicy } from "../policy/index.ts";
import { SqliteSessionStore } from "../store/index.ts";
import { type DeepSeekHttpOptions, deepSeekHttpTransport } from "./deepseek-http.ts";
import { NodeWorkspaceFiles } from "./files.ts";
import { FileRecordingSink, RecordingModelClient, ReplayModelClient } from "./model-recording.ts";
import { type PluginEntry, PluginRegistry, type PluginStatus } from "./plugins.ts";
import { WorkspacePreconditions } from "./preconditions.ts";
import { AjvArgumentValidator } from "./validation.ts";

export type { PluginEntry, PluginStatus } from "./plugins.ts";

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
  /** Explicit host connection only; no environment lookup or network before a model request. */
  readonly deepseek?: DeepSeekHttpOptions | { readonly transport: DeepSeekTransport };
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

export async function createRuntime(options: RuntimeOptions = {}): Promise<Runtime> {
  if (options.developmentPlugins?.length && (options.modelRecording || options.modelReplay))
    throw Error("Development reload cannot be combined with recording or replay");
  if ((options.modelRecording && options.modelReplay) || (options.modelReplay && options.deepseek))
    throw Error("Replay cannot be combined with live connection or recording options");
  if ((options.modelRecording || options.modelReplay || options.deepseek) && !options.model)
    throw Error("Model transport/recording requires an explicitly selected model");
  for (const recording of [options.modelRecording, options.modelReplay]) {
    if (
      recording &&
      options.model?.provider === "deepseek" &&
      recording.apiProfile !== DEEPSEEK_API_PROFILE
    )
      throw Error("DeepSeek recording profile does not match the configured adapter");
  }
  const transport = options.deepseek
    ? "transport" in options.deepseek
      ? options.deepseek.transport
      : deepSeekHttpTransport(options.deepseek)
    : undefined;
  const deepseek =
    transport || (options.modelReplay && options.model?.provider === "deepseek")
      ? createDeepSeekPlugin(
          transport ??
            (async () => {
              throw Error("Replay cannot access the network");
            }),
        )
      : undefined;
  const registry = new PluginRegistry();
  const plugins: PluginStatus[] = [];
  const startup = [
    { plugin: fsPlugin },
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
  const base = options.policy ?? new ReadOnlyPolicy();
  const stricter = (
    first: PolicyDecision,
    second: Exclude<PolicyDecision, { kind: "allow" }> | null,
  ): PolicyDecision => {
    if (first.kind === "deny") return first;
    if (second?.kind === "deny") return second;
    return first.kind === "ask" || second?.kind === "ask" ? { kind: "ask" } : { kind: "allow" };
  };
  const policy: PermissionPolicy = {
    revision: () => base.revision?.() ?? 0,
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
    if (!options.model || !store) return;
    const provider = registry.providers.find((item) => item.id === options.model?.provider);
    const profile = provider?.models.find(
      (item) =>
        item.origin.provider === options.model?.provider &&
        item.origin.model === options.model.model,
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
        selectedClient = options.modelReplay
          ? new ReplayModelClient(options.modelReplay.records, {
              apiProfile: options.modelReplay.apiProfile,
            })
          : provider.createClient(profile.origin.model);
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
      if (options.modelRecording) {
        recorder = new RecordingModelClient(
          selectedClient,
          options.modelRecording.sink,
          options.modelRecording,
        );
        selectedClient = recorder;
      }
    }
    core = new AgentCore({
      model: selectedClient,
      profile,
      tools: registry.tools,
      store,
      policy,
      context: new MinimalContextBuilder(),
      validator: new AjvArgumentValidator(),
      preconditions: options.preconditions ?? new WorkspacePreconditions(),
      files: new NodeWorkspaceFiles([
        ...(store instanceof SqliteSessionStore ? [store.directory] : []),
        ...(options.modelRecording?.sink instanceof FileRecordingSink
          ? [options.modelRecording.sink.directory]
          : []),
        ...(options.protectedPaths ?? []),
      ]),
      hasher: {
        digest: (value) =>
          `sha256:${createHash("sha256").update(canonicalizeJson(value)).digest("hex")}` as ActionDigest,
      },
      scheduler: options.scheduler ?? nodeScheduler,
      clock: options.clock ?? { now: () => new Date().toISOString() as Timestamp },
      ids: options.ids ?? { next: (prefix) => `${prefix}_${randomUUID()}` },
      emit,
      collect: async (workspaceRoot) =>
        (
          await Promise.all(
            registry.contextSources.map((source) => source.collect({ workspaceRoot, profile })),
          )
        ).flat(),
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
    if (options.model) {
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
