import type {
  ContextSource,
  ModelProvider,
  Plugin,
  PluginHost,
  PolicyDecision,
  PolicyRequest,
  PolicyRule,
  RuntimeEvent,
  ToolDefinition,
} from "../contracts/index.ts";

export interface PluginEntry {
  readonly plugin: Plugin;
  readonly config?: unknown;
}

export type PluginStatus =
  | { readonly name: string; readonly state: "loaded" }
  | { readonly name: string; readonly state: "failed"; readonly error: string };

interface Owned<T> {
  readonly owner: string;
  readonly item: T;
}

interface Contributions {
  tools: ToolDefinition[];
  providers: ModelProvider[];
  sources: ContextSource[];
  rules: PolicyRule[];
  listeners: ((event: RuntimeEvent) => void)[];
  cleanups: (() => void | Promise<void>)[];
}

const pluginName = /^[a-z][a-z0-9-]{0,63}$/;
// Accepted by every major model API for function names.
const toolName = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * Owns every registration made by plugins. Loading is atomic: a plugin's contributions become
 * visible only after its whole setup succeeded, and a failure leaves nothing behind. Every
 * registration belongs to exactly one plugin and disappears when that plugin is unloaded.
 */
export class PluginRegistry {
  readonly #loaded = new Map<string, Contributions>();
  readonly #tools = new Map<string, Owned<ToolDefinition>>();
  readonly #providers = new Map<string, Owned<ModelProvider>>();
  readonly #sources = new Map<string, Owned<ContextSource>>();
  readonly #rules = new Map<string, Owned<PolicyRule>>();
  readonly #diagnostics: string[] = [];

  async load({ plugin, config }: PluginEntry): Promise<PluginStatus> {
    const name = String(plugin?.name);
    try {
      if (!pluginName.test(name)) throw new Error(`invalid plugin name "${name}"`);
      if (plugin.apiVersion !== 1) throw new Error(`unsupported apiVersion ${plugin.apiVersion}`);
      if (this.#loaded.has(name)) throw new Error("a plugin with this name is already loaded");
    } catch (error) {
      return { name, state: "failed", error: message(error) };
    }

    const staged: Contributions = {
      tools: [],
      providers: [],
      sources: [],
      rules: [],
      listeners: [],
      cleanups: [],
    };
    let sealed = false;
    const guard = () => {
      if (sealed) throw new Error(`plugin "${name}" registered after setup finished`);
    };
    const host: PluginHost = {
      pluginName: name,
      config,
      registerTool: (tool) => {
        guard();
        if (!toolName.test(tool.name)) throw new Error(`invalid tool name "${tool.name}"`);
        staged.tools.push(tool);
      },
      registerModelProvider: (provider) => {
        guard();
        staged.providers.push(provider);
      },
      registerContextSource: (source) => {
        guard();
        staged.sources.push(source);
      },
      registerPolicyRule: (rule) => {
        guard();
        staged.rules.push(rule);
      },
      onEvent: (listener) => {
        guard();
        staged.listeners.push(listener);
      },
      onDispose: (cleanup) => {
        guard();
        staged.cleanups.push(cleanup);
      },
    };

    try {
      await plugin.setup(host);
      sealed = true;
      this.#checkConflicts(name, staged);
    } catch (error) {
      sealed = true;
      await this.#runCleanups(name, staged.cleanups);
      return { name, state: "failed", error: message(error) };
    }

    this.#loaded.set(name, staged);
    for (const item of staged.tools) this.#tools.set(item.name, { owner: name, item });
    for (const item of staged.providers) this.#providers.set(item.id, { owner: name, item });
    for (const item of staged.sources) this.#sources.set(item.id, { owner: name, item });
    for (const item of staged.rules) this.#rules.set(item.id, { owner: name, item });
    return { name, state: "loaded" };
  }

  async unload(name: string): Promise<void> {
    const contributions = this.#loaded.get(name);
    if (contributions === undefined) return;
    this.#loaded.delete(name);
    for (const map of [this.#tools, this.#providers, this.#sources, this.#rules]) {
      for (const [key, owned] of map) if (owned.owner === name) map.delete(key);
    }
    await this.#runCleanups(name, contributions.cleanups);
  }

  get tools(): ToolDefinition[] {
    return [...this.#tools.values()].map((owned) => owned.item);
  }

  get providers(): ModelProvider[] {
    return [...this.#providers.values()].map((owned) => owned.item);
  }

  providerOwner(id: string): string | undefined {
    return this.#providers.get(id)?.owner;
  }

  get contextSources(): ContextSource[] {
    return [...this.#sources.values()].map((owned) => owned.item);
  }

  get diagnostics(): readonly string[] {
    return this.#diagnostics;
  }

  /**
   * Combines plugin rules: deny beats ask, and nothing a plugin returns can allow. A rule that
   * throws or returns an unexpected value denies, because a broken guard must fail closed.
   */
  evaluatePolicy(request: PolicyRequest): Exclude<PolicyDecision, { kind: "allow" }> | null {
    let result: Exclude<PolicyDecision, { kind: "allow" }> | null = null;
    for (const { owner, item } of this.#rules.values()) {
      let decision: unknown;
      try {
        decision = item.evaluate(request);
      } catch (error) {
        decision = {
          kind: "deny",
          reason: `policy rule ${owner}/${item.id} failed: ${message(error)}`,
        };
      }
      if (decision === null) continue;
      const kind = (decision as { kind?: unknown }).kind;
      if (kind === "deny") return decision as { kind: "deny"; reason: string };
      if (kind === "ask") result = { kind: "ask" };
      else
        return { kind: "deny", reason: `policy rule ${owner}/${item.id} returned ${String(kind)}` };
    }
    return result;
  }

  /** Delivers an event to every observer. A throwing observer is recorded, never propagated. */
  emit(event: RuntimeEvent): void {
    for (const [name, contributions] of this.#loaded) {
      for (const listener of contributions.listeners) {
        try {
          const returned: unknown = listener(event);
          if (returned instanceof Promise)
            void returned.catch(() => {
              this.#diagnostics.push(`plugin "${name}" observer rejected on ${event.type}`);
            });
        } catch (error) {
          this.#diagnostics.push(
            `plugin "${name}" observer failed on ${event.type}: ${message(error)}`,
          );
        }
      }
    }
  }

  #checkConflicts(name: string, staged: Contributions): void {
    const check = <T>(kind: string, keys: string[], existing: Map<string, Owned<T>>) => {
      const seen = new Set<string>();
      for (const key of keys) {
        const owner = existing.get(key)?.owner ?? (seen.has(key) ? name : undefined);
        if (owner !== undefined)
          throw new Error(`${kind} "${key}" is already registered by "${owner}"`);
        seen.add(key);
      }
    };
    check(
      "tool",
      staged.tools.map((t) => t.name),
      this.#tools,
    );
    check(
      "model provider",
      staged.providers.map((p) => p.id),
      this.#providers,
    );
    check(
      "context source",
      staged.sources.map((s) => s.id),
      this.#sources,
    );
    check(
      "policy rule",
      staged.rules.map((r) => r.id),
      this.#rules,
    );
  }

  async #runCleanups(
    name: string,
    cleanups: readonly (() => void | Promise<void>)[],
  ): Promise<void> {
    for (const cleanup of [...cleanups].reverse()) {
      try {
        await cleanup();
      } catch (error) {
        this.#diagnostics.push(`plugin "${name}" cleanup failed: ${message(error)}`);
      }
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
