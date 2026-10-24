import { readdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

/**
 * Enforces the dependency direction documented in docs/architecture.md. A single package only
 * stays modular if the layering is checked, so this file is the source of truth for it.
 *
 * Each built-in plugin under src/plugins/<name> is its own layer, `plugin:<name>`. Plugins may
 * use only the contracts, never each other or the internals, so changing one plugin cannot
 * break another.
 */
// Other layers each layer may import; imports within a layer are always allowed.
const allowedLayers: Record<string, readonly string[]> = {
  persisted: [],
  contracts: ["persisted"],
  core: ["contracts", "persisted"],
  store: ["contracts", "persisted"],
  context: ["contracts", "persisted"],
  policy: ["contracts", "persisted"],
  plugin: ["contracts", "persisted"],
  runtime: ["contracts", "persisted", "core", "store", "context", "policy", "plugin:*"],
  cli: ["contracts", "persisted", "runtime"],
  evals: ["contracts", "persisted", "runtime", "plugin:*"],
};

/** Layers that must stay free of I/O and third-party code outside tests. */
const pureLayers = new Set(["persisted", "contracts", "core"]);

/**
 * Plugins reach files and processes only through the confined capabilities in ToolContext,
 * so path confinement and sandboxing are implemented once, in the core.
 */
const pluginForbidden = new Set(["node:fs", "node:fs/promises", "node:child_process"]);

export const repo = resolve(import.meta.dirname, "..");

export function layerOf(file: string): string | null {
  const parts = relative(repo, file).split(sep);
  if (parts[0] === "evals" || parts[0] === "tests") return parts[0];
  if (parts[0] !== "src" || parts.length < 3) return null;
  if (parts[1] === "contracts" && parts[2] === "persisted") return "persisted";
  if (parts[1] === "plugins") return parts.length > 3 ? `plugin:${parts[2]}` : "plugins";
  return parts[1] ?? null;
}

export function importsOf(source: string): string[] {
  const pattern = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g;
  return [...source.matchAll(pattern)].map((match) => match[1] as string);
}

function rulesFor(layer: string): readonly string[] | undefined {
  return allowedLayers[layer.startsWith("plugin:") ? "plugin" : layer];
}

function allows(allowed: readonly string[], target: string): boolean {
  return allowed.includes(target) || (target.startsWith("plugin:") && allowed.includes("plugin:*"));
}

export function violations(file: string, source: string): string[] {
  const layer = layerOf(file);
  if (layer === null || layer === "tests") return [];
  const allowed = rulesFor(layer);
  if (allowed === undefined) return [`${relative(repo, file)}: unknown layer "${layer}"`];
  const isTest = file.endsWith(".test.ts");
  const out: string[] = [];
  for (const specifier of importsOf(source)) {
    if (specifier.startsWith(".")) {
      const target = layerOf(resolve(dirname(file), specifier));
      if (target !== null && target !== layer && !allows(allowed, target)) {
        out.push(`${relative(repo, file)}: ${layer} may not import ${target} (${specifier})`);
      }
    } else if (pureLayers.has(layer) && !isTest) {
      out.push(`${relative(repo, file)}: ${layer} must not import "${specifier}"`);
    } else if (layer.startsWith("plugin:") && !isTest && pluginForbidden.has(specifier)) {
      out.push(`${relative(repo, file)}: plugins use ToolContext instead of "${specifier}"`);
    }
  }
  return out;
}

export function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".ts"))
    .map((e) => join(e.parentPath, e.name));
}
