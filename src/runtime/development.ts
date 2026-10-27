import { randomUUID } from "node:crypto";
import { type FSWatcher, statSync, watch } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { Plugin } from "../contracts/index.ts";
import type { DevelopmentPlugin } from "./index.ts";

export interface FileDevelopmentPlugin extends DevelopmentPlugin {
  readonly filePath: string;
}

/** Explicit trusted ESM entry only. Construction never evaluates plugin code. */
export function fileDevelopmentPlugin(name: string, path: string): FileDevelopmentPlugin {
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(name)) throw Error("Invalid development plugin name");
  const filePath = resolve(path);
  // CommonJS cache identity is not invalidated by an ESM import query. Require unambiguous ESM.
  if (![".mjs", ".mts"].includes(extname(filePath)))
    throw Error("Development plugin entries must use .mjs or .mts (ES modules)");
  const instance = randomUUID();
  let revision = 0;
  return {
    name,
    filePath,
    async load() {
      const url = pathToFileURL(filePath);
      url.searchParams.set("moyyi_reload", `${instance}.${++revision}`);
      const module: unknown = await import(url.href);
      if (!module || typeof module !== "object" || !("default" in module))
        throw Error("Development plugin must export its Plugin object as default");
      const plugin = module.default as Plugin;
      if (!plugin || typeof plugin !== "object" || plugin.name !== name)
        throw Error("Development plugin default export must match its configured name");
      return { plugin };
    },
  };
}

/**
 * Watch parent directories so editor atomic-save renames do not leave a stale inode watch.
 * This is only a change notification; the caller must send plugin.reload through the runtime.
 * Imported dependencies retain their own ESM cache keys and require a process restart.
 */
export function watchDevelopmentPlugins(
  entries: readonly FileDevelopmentPlugin[],
  onChange: (name: string) => void | Promise<void>,
  onError: (name: string, message: string) => void,
  delayMs = 100,
): { close(): void } {
  if (!Number.isSafeInteger(delayMs) || delayMs < 0 || delayMs > 10_000)
    throw Error("Invalid development watch debounce");
  const groups = new Map<string, FileDevelopmentPlugin[]>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const fingerprints = new Map<string, string>();
  const watchers: FSWatcher[] = [];
  let closed = false;
  for (const configured of entries) {
    const entry = { ...configured };
    fingerprints.set(entry.name, fingerprint(entry.filePath));
    const directory = dirname(entry.filePath);
    const group = groups.get(directory) ?? [];
    group.push(entry);
    groups.set(directory, group);
  }
  const report = (entry: FileDevelopmentPlugin) => {
    if (!closed) onError(entry.name, "Development watcher failed; use /reload manually");
  };
  const changed = (entry: FileDevelopmentPlugin) => {
    const prior = timers.get(entry.name);
    if (prior) clearTimeout(prior);
    timers.set(
      entry.name,
      setTimeout(() => {
        timers.delete(entry.name);
        if (closed) return;
        const current = fingerprint(entry.filePath);
        if (fingerprints.get(entry.name) === current) return;
        fingerprints.set(entry.name, current);
        try {
          void Promise.resolve(onChange(entry.name)).catch(() => report(entry));
        } catch {
          report(entry);
        }
      }, delayMs),
    );
  };
  for (const [directory, group] of groups) {
    try {
      const watcher = watch(directory, { persistent: false }, (_event, filename) => {
        if (closed) return;
        for (const entry of group)
          if (filename === null || String(filename) === basename(entry.filePath)) changed(entry);
      });
      watcher.on("error", () => {
        watcher.close();
        for (const entry of group) report(entry);
      });
      watchers.push(watcher);
    } catch {
      for (const entry of group) report(entry);
    }
  }
  // fs.watch can miss events during native registration or coalesce them to a directory.
  // Reconcile only the captured entries; notifications still pass through the same debounce.
  const reconciliation = groups.size
    ? setInterval(() => {
        if (closed) return;
        for (const group of groups.values()) {
          for (const entry of group) {
            if (
              !timers.has(entry.name) &&
              fingerprints.get(entry.name) !== fingerprint(entry.filePath)
            )
              changed(entry);
          }
        }
      }, 250)
    : undefined;
  reconciliation?.unref();
  return {
    close() {
      if (closed) return;
      closed = true;
      clearInterval(reconciliation);
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      for (const watcher of watchers) watcher.close();
    },
  };
}

function fingerprint(path: string): string {
  try {
    const value = statSync(path, { bigint: true });
    return `${value.dev}:${value.ino}:${value.size}:${value.mtimeNs}:${value.ctimeNs}`;
  } catch {
    return "unavailable";
  }
}
