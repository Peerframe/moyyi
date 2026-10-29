import { readdirSync } from "node:fs";
import { isBuiltin } from "node:module";
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
  "desktop:shared": ["desktop:contract"],
  "desktop:contract": ["desktop:shared", "desktop:security"],
  "desktop:security": [],
  "desktop:wire": ["desktop:shared", "desktop:contract", "desktop:security"],
  "desktop:preload": ["desktop:shared", "desktop:contract", "desktop:wire", "desktop:security"],
  "desktop:renderer": ["desktop:shared", "desktop:contract"],
  "desktop:host": ["desktop:shared", "desktop:contract", "desktop:wire", "desktop:security"],
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
  if (parts[0] === "apps") {
    if (parts[1] !== "desktop") return `app:${parts[1] ?? "unknown"}`;
    if (parts[2] === "features" && parts.length >= 5) {
      const area =
        parts[4] === "renderer"
          ? "renderer"
          : ["contract.ts", "state.ts"].includes(parts[4]?.replace(/\.test(?=\.tsx?$)/, "") ?? "")
            ? "contract"
            : "host";
      return `desktop:feature:${parts[3]}:${area}`;
    }
    if (parts[2] === "native" && parts.length === 4) {
      return [
        "contract.ts",
        "contracts.ts",
        "channels.ts",
        "actions.ts",
        "state-schema.ts",
        "state-validation.ts",
      ].includes(parts[3]?.replace(/\.test(?=\.tsx?$)/, "") ?? "")
        ? "desktop:contract"
        : "desktop:host";
    }
    if (parts[2] === "shared-feature-types.ts") return "desktop:shared";
    if (parts[2] === "renderer" && parts.length > 3) return "desktop:renderer";
    if (parts[2] === "host" && parts.length > 3) return "desktop:host";
    const name = parts.length === 3 ? parts[2]?.replace(/\.test(?=\.tsx?$)/, "") : "";
    if (name === "shared.ts") return "desktop:shared";
    if (name === "security.ts") return "desktop:security";
    if (name === "wire.ts") return "desktop:wire";
    if (name === "preload.ts") return "desktop:preload";
    if (
      ["main.ts", "bridge.ts", "connection.ts", "worker.ts", "maintenance-worker.ts"].includes(
        name ?? "",
      )
    ) {
      return "desktop:host";
    }
    return `desktop:unknown:${parts.slice(2).join("/")}`;
  }
  if (parts[0] !== "src" || parts.length < 3) return null;
  if (parts[1] === "contracts" && parts[2] === "persisted") return "persisted";
  if (parts[1] === "plugins") return parts.length > 3 ? `plugin:${parts[2]}` : "plugins";
  return parts[1] ?? null;
}

export function importsOf(source: string): string[] {
  return scanImports(source).flatMap((specifier) => (specifier === null ? [] : [specifier]));
}

/** Skip comments and unrelated string values so test fixtures are not treated as imports. */
function scanImports(source: string): (string | null)[] {
  const tokens =
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b(from|import|require)\b/g;
  const literal = /^(?:"([^"\\]*)"|'([^'\\]*)'|`([^`\\]*)`)/;
  const found: (string | null)[] = [];
  for (const token of source.matchAll(tokens)) {
    const word = token[1];
    if (!word) continue;
    let at = skipTrivia(source, token.index + token[0].length);
    const call = word !== "from" && source[at] === "(";
    if (call) at = skipTrivia(source, at + 1);
    const match = literal.exec(source.slice(at));
    if (!match) {
      if (call || ((word === "from" || word === "import") && /["'`]/.test(source[at] ?? ""))) {
        found.push(null);
      }
      continue;
    }
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    const after = source[skipTrivia(source, at + match[0].length)];
    // Escapes, expressions and interpolated template paths are not an auditable module list.
    const computed =
      (match[3] !== undefined && value.includes("${")) ||
      (call && after !== ")" && !(word === "import" && after === ","));
    found.push(computed ? null : value);
  }
  return found;
}

function skipTrivia(source: string, start: number): number {
  let at = start;
  while (at < source.length) {
    if (/\s/.test(source[at] ?? "")) {
      at += 1;
      continue;
    }
    if (source.startsWith("/*", at)) {
      const end = source.indexOf("*/", at + 2);
      at = end === -1 ? source.length : end + 2;
      continue;
    }
    if (source.startsWith("//", at)) {
      const end = source.indexOf("\n", at + 2);
      at = end === -1 ? source.length : end + 1;
      continue;
    }
    break;
  }
  return at;
}

function rulesFor(layer: string): readonly string[] | undefined {
  return allowedLayers[layer.startsWith("plugin:") ? "plugin" : desktopRole(layer)];
}

function desktopRole(layer: string): string {
  return layer.startsWith("desktop:feature:") ? `desktop:${layer.split(":")[3]}` : layer;
}

function allowsDesktop(source: string, target: string): boolean {
  const sourceFeature = source.startsWith("desktop:feature:") ? source.split(":")[2] : null;
  const targetFeature = target.startsWith("desktop:feature:") ? target.split(":")[2] : null;
  if (sourceFeature && targetFeature && sourceFeature !== targetFeature) return false;
  const from = desktopRole(source),
    to = desktopRole(target);
  return from === to || (allowedLayers[from] ?? []).includes(to);
}

function allows(allowed: readonly string[], target: string): boolean {
  return allowed.includes(target) || (target.startsWith("plugin:") && allowed.includes("plugin:*"));
}

export function violations(file: string, source: string): string[] {
  const layer = layerOf(file);
  if (layer === null || layer === "tests") return [];
  const allowed = rulesFor(layer);
  if (allowed === undefined) return [`${relative(repo, file)}: unknown layer "${layer}"`];
  const isTest = /\.test\.tsx?$/.test(file);
  const desktop = layer.startsWith("desktop:");
  const out: string[] = [];
  for (const specifier of scanImports(source)) {
    if (specifier === null) {
      if ((desktop || pureLayers.has(layer)) && !isTest)
        out.push(`${relative(repo, file)}: ${layer} module paths must be static literals`);
      continue;
    }
    if (specifier.startsWith(".")) {
      const target = layerOf(resolve(dirname(file), specifier));
      if (desktop && (target === null || !target.startsWith("desktop:"))) {
        out.push(`${relative(repo, file)}: desktop must use public package exports (${specifier})`);
      } else if (
        target !== null &&
        (desktop ? !allowsDesktop(layer, target) : target !== layer && !allows(allowed, target))
      ) {
        out.push(`${relative(repo, file)}: ${layer} may not import ${target} (${specifier})`);
      }
    } else if (desktop && !desktopPackageAllowed(layer, file, specifier, isTest)) {
      out.push(`${relative(repo, file)}: ${layer} must not import "${specifier}"`);
    } else if (pureLayers.has(layer) && !isTest) {
      out.push(`${relative(repo, file)}: ${layer} must not import "${specifier}"`);
    } else if (layer.startsWith("plugin:") && !isTest && pluginForbidden.has(specifier)) {
      out.push(`${relative(repo, file)}: plugins use ToolContext instead of "${specifier}"`);
    }
  }
  return out;
}

function desktopPackageAllowed(
  layer: string,
  file: string,
  specifier: string,
  isTest: boolean,
): boolean {
  layer = desktopRole(layer);
  if (isTest && specifier === "vitest") return true;
  if (layer === "desktop:renderer") {
    return (
      ["react", "react/jsx-runtime", "react/jsx-dev-runtime", "react-dom/client"].includes(
        specifier,
      ) ||
      (isTest && specifier === "react-dom/server")
    );
  }
  if (layer === "desktop:preload") return specifier === "electron";
  if (layer === "desktop:host") {
    return (
      isBuiltin(specifier) ||
      ["moyyi/runtime", "moyyi/contracts"].includes(specifier) ||
      (specifier === "electron" &&
        (/[/\\]main(?:\.test)?\.ts$/.test(file) || /[/\\]native[/\\]context\.ts$/.test(file)))
    );
  }
  return false;
}

export function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && /\.tsx?$/.test(e.name))
    .map((e) => join(e.parentPath, e.name));
}
