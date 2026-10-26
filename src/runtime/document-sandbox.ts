import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { createRequire, isBuiltin } from "node:module";
import { dirname, join } from "node:path";
import { officeParserEntry } from "./document-dependencies.ts";
import type { NativeSandboxPlan } from "./sandbox.ts";

/** Exact installed parser closure, not node_modules or the consumer's workspace. */
function dependencies(entry: string): string[] {
  const roots = new Set<string>();
  const visit = (name: string, from: string, optional = false, fixedEntry?: string): void => {
    if (isBuiltin(name)) return;
    const require = createRequire(from);
    let file: string;
    try {
      try {
        file = fixedEntry ?? require.resolve(name);
      } catch {
        file = require.resolve(`${name}/package.json`);
      }
    } catch {
      if (optional) return;
      throw Error("Document parser dependency unavailable");
    }
    let directory = dirname(file);
    for (;;) {
      const manifest = join(directory, "package.json");
      if (existsSync(manifest)) {
        const pkg = JSON.parse(readFileSync(manifest, "utf8")) as {
          name?: string;
          version?: string;
          dependencies?: Record<string, string>;
          optionalDependencies?: Record<string, string>;
        };
        if (pkg.name === name) {
          if (
            (name === "pdfjs-dist" && pkg.version !== "6.3.289") ||
            (name === "officeparser" && pkg.version !== "7.8.0")
          )
            throw Error("Document parser dependency version mismatch");
          directory = realpathSync(directory);
          if (roots.has(directory)) return;
          roots.add(directory);
          for (const dependency of Object.keys(pkg.dependencies ?? {}))
            visit(dependency, manifest, dependency in (pkg.optionalDependencies ?? {}));
          for (const dependency of Object.keys(pkg.optionalDependencies ?? {}))
            visit(dependency, manifest, true);
          return;
        }
      }
      const parent = dirname(directory);
      if (parent === directory) throw Error("Document parser package metadata unavailable");
      directory = parent;
    }
  };
  visit("pdfjs-dist", entry);
  visit("officeparser", entry, false, officeParserEntry());
  return [...roots];
}

/** Fixed Node entry with a fresh environment and no workspace mount, shell, or network grant. */
export function documentSandbox(worker: string, scratch: string): NativeSandboxPlan {
  const node = realpathSync(process.execPath);
  const roots = dependencies(worker);
  const files = new Set<string>([
    worker,
    node,
    join(
      dirname(worker),
      worker.endsWith(".ts") ? "document-dependencies.ts" : "document-dependencies.js",
    ),
  ]);
  const metadata = new Set<string>(["/"]);
  // Probe only a fresh Node process, not the host's loaded plugins/native addons. No document,
  // credential, inherited loader option or shell code reaches this fixed bounded setup probe.
  const libraryOutput = execFileSync(
    node,
    ["-e", "process.stdout.write(JSON.stringify(process.report.getReport().sharedObjects))"],
    {
      cwd: scratch,
      env: {
        HOME: scratch,
        TMPDIR: scratch,
        OPENSSL_CONF: "/dev/null",
        PATH: "/usr/bin:/bin",
        LANG: "C",
        LC_ALL: "C",
      },
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 128 * 1024,
    },
  );
  for (const library of absoluteLibraryPaths(JSON.parse(libraryOutput))) {
    if (!existsSync(library)) continue; // macOS dyld shared-cache paths need not exist on disk.
    const actual = realpathSync(library);
    files.add(library);
    files.add(actual);
    // dyld uses compatibility-name symlinks as well as canonical names. Grant only aliases that
    // resolve to this exact already-loaded library; never a whole arbitrary library directory.
    const directory = dirname(actual);
    const aliases = [actual];
    if (/\.(?:dylib|so(?:\.[0-9]+)*)$/u.test(actual)) {
      const names = readdirSync(directory);
      if (names.length > 10000) throw Error("Document library directory is too large");
      for (const name of names) {
        const path = join(directory, name);
        try {
          if (realpathSync(path) === actual) {
            files.add(path);
            aliases.push(path);
          }
        } catch {
          /* Broken unrelated link. */
        }
      }
      const cellar = directory.match(/^(.*)\/Cellar\/([^/]+)\/[^/]+\/(.*)$/u);
      if (cellar) {
        const aliasDirectory = `${cellar[1]}/opt/${cellar[2]}/${cellar[3]}`;
        if (existsSync(aliasDirectory) && realpathSync(aliasDirectory) === directory) {
          for (const path of aliases)
            files.add(join(aliasDirectory, path.slice(directory.length + 1)));
        }
      }
    }
  }
  for (const path of [worker, node, scratch, ...roots, ...files]) {
    for (let parent = dirname(path); parent !== "/"; parent = dirname(parent)) {
      metadata.add(parent);
      const manifest = join(parent, "package.json");
      metadata.add(manifest);
      if (existsSync(manifest)) files.add(manifest);
    }
  }
  const env = {
    OPENSSL_CONF: "/dev/null",
    HOME: scratch,
    TMPDIR: scratch,
    LANG: "C",
    LC_ALL: "C",
    PATH: "/usr/bin:/bin",
    PWD: scratch,
  };
  const nodeArgs = [
    "--max-old-space-size=256",
    "--max-semi-space-size=32",
    "--stack-size=4096",
    worker,
  ];
  if (process.platform === "darwin") {
    if (!existsSync("/usr/bin/sandbox-exec")) throw Error("Document native sandbox unavailable");
    const literal = (paths: Iterable<string>) =>
      [...paths].map((p) => `(literal ${JSON.stringify(p)})`).join(" ");
    const subpaths = (paths: string[]) =>
      paths.map((p) => `(subpath ${JSON.stringify(p)})`).join(" ");
    const system = [
      "/usr/lib",
      "/System/Library",
      "/System/Cryptexes",
      "/System/Volumes/Preboot/Cryptexes/OS",
      "/Library/Apple",
    ];
    const profile = [
      "(version 1)",
      "(deny default)",
      `(allow process-exec (literal ${JSON.stringify(node)}))`,
      "(allow signal (target same-sandbox))",
      "(allow process-info* (target same-sandbox))",
      `(allow sysctl-read ${["hw.machine", "kern.version", "hw.activecpu", "hw.memsize", "hw.pagesize", "hw.pagesize_compat", "hw.ncpu", "hw.cputype", "kern.osrelease", "kern.ostype", "kern.osversion", "kern.hostname", "kern.maxfilesperproc", "sysctl.proc_cputype"].map((n) => `(sysctl-name ${JSON.stringify(n)})`).join(" ")})`,
      `(allow file-read* ${literal(metadata)})`,
      `(allow file-read* ${literal(files)} ${subpaths([...system, ...roots])})`,
      `(allow file-read* file-write* (subpath ${JSON.stringify(scratch)}))`,
      '(allow file-read* (literal "/dev/null") (literal "/dev/random") (literal "/dev/urandom"))',
      '(allow file-write-data (literal "/dev/null"))',
    ].join("\n");
    return {
      command: "/usr/bin/sandbox-exec",
      args: ["-p", profile, node, ...nodeArgs],
      env,
      backend: "seatbelt",
    };
  }
  if (process.platform !== "linux") throw Error("Document native sandbox unavailable");
  const command = ["/usr/bin/bwrap", "/bin/bwrap"].find(existsSync);
  if (!command) throw Error("Document native sandbox requires bubblewrap");
  const args = [
    "--unshare-all",
    "--unshare-user",
    "--disable-userns",
    "--die-with-parent",
    "--new-session",
    "--cap-drop",
    "ALL",
    "--clearenv",
  ];
  const system = ["/usr/lib", "/usr/lib64", "/lib", "/lib64", "/etc/ld.so.cache"].filter(
    existsSync,
  );
  for (const path of [...system, ...roots, ...files]) args.push("--ro-bind", path, path);
  args.push("--proc", "/proc", "--dev", "/dev", "--bind", scratch, scratch, "--chdir", scratch);
  for (const [key, value] of Object.entries(env)) args.push("--setenv", key, value);
  args.push("--remount-ro", "/", "--", node, ...nodeArgs);
  return { command, args, env, backend: "bubblewrap" };
}

/** Kernel virtual objects (for example Linux vDSO) are not paths and grant no filesystem access. */
export function absoluteLibraryPaths(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 2000 ||
    value.some(
      (p) => typeof p !== "string" || p.length > 4096 || p.includes("\0") || !p.isWellFormed(),
    )
  )
    throw Error("Document Node library discovery failed");
  return value.filter((p: string) => p.startsWith("/"));
}
