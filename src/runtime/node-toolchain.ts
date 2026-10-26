import { execFile } from "node:child_process";
import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { assertUnprotected } from "./preconditions.ts";

const execute = promisify(execFile);

export interface NodeToolchain {
  readonly executablePaths: readonly string[];
  readonly readOnlyPaths: readonly string[];
}

/** Discover the running Node installation, never host addons, PATH tools or project code. */
export async function discoverNodeToolchain(): Promise<NodeToolchain> {
  const node = realpathSync(process.execPath);
  dependencyFile(node);
  const scratch = await realpath(await mkdtemp(join(tmpdir(), "moyyi-node-toolchain-")));
  try {
    const { stdout } = await execute(
      node,
      [
        "--report-exclude-network",
        "--report-exclude-env",
        "-e",
        "process.stdout.write(JSON.stringify(process.report.getReport().sharedObjects))",
      ],
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
        killSignal: "SIGKILL",
        maxBuffer: 128 * 1024,
      },
    );
    return Object.freeze({
      executablePaths: Object.freeze([node]),
      readOnlyPaths: Object.freeze(nodeLibraryFiles(absoluteLibraryPaths(JSON.parse(stdout)))),
    });
  } catch {
    // A child diagnostic is not a safe CLI error or model-facing tool result.
    throw Error("Node toolchain discovery failed; no additional toolchain access was granted");
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/** Compatibility names grant only exact files resolving to an already-loaded library. */
export function nodeLibraryFiles(libraries: readonly string[]): string[] {
  const files = new Set<string>();
  const directories = new Map<string, readonly string[]>();
  for (const library of libraries) {
    // macOS dyld shared-cache paths need not exist on disk. They add no file grant.
    if (!existsSync(library)) continue;
    const actual = dependencyFile(library);
    files.add(library);
    files.add(actual);
    const directory = dirname(actual);
    if (!/\.(?:dylib|so(?:\.[0-9]+)*)$/u.test(actual)) continue;
    let names = directories.get(directory);
    if (!names) {
      names = readdirSync(directory);
      if (names.length > 10000) throw Error("Node library directory is too large");
      directories.set(directory, names);
    }
    const aliases = new Set([actual]);
    for (const name of names) {
      const path = join(directory, name);
      let target: string;
      try {
        target = realpathSync(path);
      } catch {
        continue; // A broken unrelated link grants nothing.
      }
      if (target === actual) {
        dependencyFile(path);
        files.add(path);
        aliases.add(path);
      }
    }
    const cellar = directory.match(/^(.*)\/Cellar\/([^/]+)\/[^/]+\/(.*)$/u);
    if (cellar) {
      const aliasDirectory = `${cellar[1]}/opt/${cellar[2]}/${cellar[3]}`;
      if (existsSync(aliasDirectory) && realpathSync(aliasDirectory) === directory) {
        for (const path of aliases) {
          const alias = join(aliasDirectory, path.slice(directory.length + 1));
          if (dependencyFile(alias) !== actual) throw Error("Node library alias changed");
          files.add(alias);
        }
      }
    }
  }
  return [...files];
}

function dependencyFile(path: string): string {
  const actual = realpathSync(path);
  for (const candidate of new Set([path, actual])) {
    assertUnprotected(candidate);
    if (
      candidate.split("/").some((part) => [".git", ".moyyi", ".codex"].includes(part.toLowerCase()))
    )
      throw Error("Node toolchain path is protected");
  }
  const stat = lstatSync(actual);
  if (!stat.isFile() || stat.nlink !== 1) throw Error("Node toolchain requires regular files");
  return actual;
}

/** Kernel virtual objects (for example Linux vDSO) are not filesystem grants. */
export function absoluteLibraryPaths(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length > 2000 ||
    value.some(
      (p) => typeof p !== "string" || p.length > 4096 || p.includes("\0") || !p.isWellFormed(),
    )
  )
    throw Error("Node library discovery failed");
  return value.filter((p: string) => p.startsWith("/"));
}
