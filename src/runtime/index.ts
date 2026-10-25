import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { MinimalContextBuilder } from "../context/index.ts";
import {
  type ActionDigest,
  type ClientCommand,
  type Clock,
  canonicalizeJson,
  type IdSource,
  type ModelOrigin,
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

export interface RuntimeOptions {
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
  for (const entry of [
    { plugin: fsPlugin },
    ...(deepseek ? [{ plugin: deepseek }] : []),
    ...(options.plugins ?? []),
  ])
    plugins.push(await registry.load(entry));

  const listeners = new Set<(event: RuntimeEvent) => void>();
  const diagnostics: string[] = [];
  const emit = (event: RuntimeEvent) => {
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
  let ownedStore: SqliteSessionStore | undefined;
  let core: AgentCore | undefined;
  let recorder: RecordingModelClient | undefined;
  const unload = async () => {
    for (const status of [...plugins].reverse()) await registry.unload(status.name);
  };
  try {
    if (options.store && options.dataDirectory)
      throw new Error("Choose a store or dataDirectory, not both");
    if (options.model) {
      const provider = registry.providers.find(
        (provider) => provider.id === options.model?.provider,
      );
      const profile = provider?.models.find(
        (profile) =>
          profile.origin.provider === options.model?.provider &&
          profile.origin.model === options.model.model,
      );
      if (!provider || !profile) throw new Error("Configured model is not registered");
      if (options.dataDirectory) ownedStore = new SqliteSessionStore(options.dataDirectory);
      const store = options.store ?? ownedStore;
      if (!store) throw new Error("A configured model requires persistent storage");
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
      let client = options.modelReplay
        ? new ReplayModelClient(options.modelReplay.records, {
            apiProfile: options.modelReplay.apiProfile,
          })
        : provider.createClient(profile.origin.model);
      if (options.modelRecording) {
        recorder = new RecordingModelClient(
          client,
          options.modelRecording.sink,
          options.modelRecording,
        );
        client = recorder;
      }
      core = new AgentCore({
        model: client,
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
      await core.recover();
    } else if (options.store || options.dataDirectory)
      throw new Error("Storage requires an explicitly selected model");
  } catch (error) {
    ownedStore?.close();
    await unload();
    throw error;
  }
  let closed = false;
  let closing: Promise<void> | undefined;
  const commands = new Set<Promise<void>>();
  return {
    plugins,
    get diagnostics() {
      return [...diagnostics, ...registry.diagnostics];
    },
    send(command) {
      if (closed || !core) {
        emit({
          type: "command.rejected",
          command: command.type,
          reason: closed ? "Runtime is closed" : "Model and storage are not configured",
        });
        return Promise.resolve();
      }
      const pending = core.send(command);
      commands.add(pending);
      void pending.finally(() => commands.delete(pending));
      return pending;
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
