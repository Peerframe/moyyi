import type { ClientCommand, RuntimeEvent } from "../contracts/index.ts";
import { type PluginEntry, PluginRegistry, type PluginStatus } from "./plugins.ts";

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
  close(): Promise<void>;
}

export interface RuntimeOptions {
  readonly plugins?: readonly PluginEntry[];
}

export async function createRuntime(options: RuntimeOptions = {}): Promise<Runtime> {
  const registry = new PluginRegistry();
  const plugins: PluginStatus[] = [];
  for (const entry of options.plugins ?? []) plugins.push(await registry.load(entry));

  const listeners = new Set<(event: RuntimeEvent) => void>();
  const emit = (event: RuntimeEvent) => {
    for (const listener of listeners) listener(event);
    registry.emit(event);
  };

  return {
    plugins,
    async send(command) {
      // Fail closed until the core exists: reject rather than pretend to run.
      emit({ type: "command.rejected", command: command.type, reason: "not implemented" });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async close() {
      listeners.clear();
      for (const status of [...plugins].reverse()) await registry.unload(status.name);
    },
  };
}
