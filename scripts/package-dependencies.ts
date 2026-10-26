import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";

type Package = {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  os?: string[];
  cpu?: string[];
  libc?: string[];
};
type Lock = { packages: Record<string, Package> };

/** Match actual dependency edges, not just a flattened npm ls list or copied shrinkwrap bytes. */
export function assertInstalledDependencyGraph(packageRoot: string, lock: Lock) {
  const manifest = (root: string): Package =>
    JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const root = manifest(packageRoot);
  const expectedRoot = lock.packages[""];
  assert(expectedRoot);
  assert.deepEqual(
    root.dependencies,
    expectedRoot.dependencies,
    "Installed root dependency pins changed",
  );
  assert.deepEqual(root.optionalDependencies ?? {}, expectedRoot.optionalDependencies ?? {});
  const packages = new Set<string>();
  const edges = new Set<string>();
  const visited = new Set<string>();
  const expectedPath = (parent: string, name: string): string => {
    let scope = parent;
    for (;;) {
      const candidate = `${scope ? `${scope}/` : ""}node_modules/${name}`;
      if (lock.packages[candidate]) return candidate;
      if (!scope) throw Error(`Canonical dependency missing: ${parent} -> ${name}`);
      const boundary = scope.lastIndexOf("/node_modules/");
      scope = boundary < 0 ? "" : scope.slice(0, boundary);
    }
  };
  const installedPath = (parent: string, name: string): string | undefined => {
    const installRoot = dirname(dirname(packageRoot));
    for (let scope = parent; ; scope = dirname(scope)) {
      const within = relative(installRoot, scope);
      if (within.startsWith("..") || isAbsolute(within)) return undefined;
      const candidate = join(scope, "node_modules", name);
      if (existsSync(join(candidate, "package.json"))) return candidate;
      if (dirname(scope) === scope) return undefined;
    }
  };
  const platformMatches = (values: string[] | undefined, value: string): boolean =>
    !values ||
    (!values.includes(`!${value}`) &&
      (values.every((item) => item.startsWith("!")) || values.includes(value)));
  const report = process.platform === "linux" ? process.report.getReport() : undefined;
  const libc =
    report &&
    typeof report === "object" &&
    "header" in report &&
    typeof report.header === "object" &&
    report.header !== null &&
    "glibcVersionRuntime" in report.header
      ? "glibc"
      : "musl";
  const supported = (entry: Package) =>
    platformMatches(entry.os, process.platform) &&
    platformMatches(entry.cpu, process.arch) &&
    platformMatches(entry.libc, libc);
  const walk = (expected: string, actual: string) => {
    if (visited.has(expected)) return;
    visited.add(expected);
    const wanted = lock.packages[expected];
    assert(wanted);
    const found = manifest(actual);
    if (expected) {
      assert.equal(
        found.version,
        wanted.version,
        `Installed version differs from canonical lock: ${expected}`,
      );
      assert.deepEqual(
        found.dependencies ?? {},
        wanted.dependencies ?? {},
        `Dependency declarations changed: ${expected}`,
      );
      assert.deepEqual(
        found.optionalDependencies ?? {},
        wanted.optionalDependencies ?? {},
        `Optional declarations changed: ${expected}`,
      );
      packages.add(`${found.name}@${found.version}`);
    }
    const declarations = { ...wanted.dependencies, ...wanted.optionalDependencies };
    for (const [name, spec] of Object.entries(declarations)) {
      const target = expectedPath(expected, name);
      const targetEntry = lock.packages[target];
      assert(targetEntry);
      if (name in (wanted.optionalDependencies ?? {}) && !supported(targetEntry)) continue;
      const installed = installedPath(actual, name);
      assert(installed, `Required installed dependency missing: ${expected} -> ${name}`);
      const actualVersion = manifest(installed).version;
      assert.equal(
        actualVersion,
        targetEntry.version,
        `Installed edge differs: ${expected} -> ${name}`,
      );
      edges.add(`${expected || "moyyi"} -> ${name}@${actualVersion} (${spec})`);
      walk(target, installed);
    }
  };
  walk("", packageRoot);
  const graph = { packages: [...packages].sort(), edges: [...edges].sort() };
  return {
    shippedCanonicalLock: true,
    localNpmEnforcesShrinkwrap: false,
    sameInstalledGraph: true,
    packageCount: packages.size,
    edgeCount: edges.size,
    sha256: createHash("sha256").update(JSON.stringify(graph)).digest("hex"),
    ...graph,
  };
}
