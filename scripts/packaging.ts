import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const repository = realpathSync(fileURLToPath(new URL("..", import.meta.url)));
export const installedGuides = [
  "docs/installation.md",
  "docs/client-protocol.md",
  "docs/cli.md",
  "docs/deepseek.md",
  "docs/anthropic.md",
  "docs/files.md",
  "docs/writes.md",
  "docs/shell.md",
  "docs/long-sessions.md",
  "docs/instructions.md",
  "docs/web.md",
] as const;
export function command(
  file: string,
  args: readonly string[],
  cwd: string,
  env?: NodeJS.ProcessEnv,
): string {
  try {
    return execFileSync(file, [...args], {
      cwd,
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: 8 * 1024 * 1024,
      ...(env ? { env } : {}),
    });
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    throw Error(
      `${basename(file)} ${args[0] ?? ""} failed (${failure.status ?? "timeout/spawn"})\n${failure.stdout ?? ""}\n${failure.stderr ?? ""}`,
    );
  }
}
function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name),
      stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw Error("Package inputs must not contain symlinks");
    if (stat.isDirectory()) return files(path);
    if (!stat.isFile()) throw Error("Package inputs must be regular files");
    return [path];
  });
}
export function expectedPackageFiles(root = repository): readonly string[] {
  const compiled = files(join(root, "src")).flatMap((path) => {
    const source = relative(join(root, "src"), path).replaceAll("\\", "/");
    if (
      !source.endsWith(".ts") ||
      source.endsWith(".test.ts") ||
      source.endsWith("/fixtures.ts") ||
      source.includes("/fixtures/")
    )
      return [];
    const base = `dist/${source.slice(0, -3)}`;
    return [`${base}.js`, `${base}.d.ts`, `${base}.js.map`];
  });
  return ["package.json", "README.md", "LICENSE", ...installedGuides, ...compiled].sort();
}
export function assertPackageFiles(actual: readonly string[], expected: readonly string[]): void {
  assert.equal(new Set(actual).size, actual.length, "Package contains duplicate paths");
  for (const path of actual)
    assert(
      !path.startsWith("/") &&
        !path.includes("\\") &&
        !path.split("/").some((part) => !part || part === "." || part === ".."),
      "Invalid package path",
    );
  assert.deepEqual(
    [...actual].sort(),
    [...expected].sort(),
    "Package file list differs from reviewed production outputs and guides",
  );
}
export interface Candidate {
  readonly artifact: string;
  readonly sha256: string;
  readonly fileCount: number;
  readonly version: string;
  readonly revision: string;
  readonly dirty: boolean;
  readonly manifest: string;
}
export function buildCandidate(): Candidate {
  const pkg = JSON.parse(readFileSync(join(repository, "package.json"), "utf8"));
  assert.equal(pkg.private, true, "Candidate must retain the npm publication guard");
  assert.equal(pkg.version, "0.0.0", "A release version requires a separate decision");
  for (const name of ["preinstall", "install", "postinstall", "prepare", "publish", "postpublish"])
    assert(!pkg.scripts?.[name], "Candidates must not depend on installation/publication hooks");
  const temporary = mkdtempSync(join(tmpdir(), "moyyi-pack-"));
  try {
    // npm's prepack performs a clean build. This command creates a local file, never publishes.
    const result = JSON.parse(
      command("npm", ["pack", "--json", "--pack-destination", temporary], repository),
    );
    assert(Array.isArray(result) && result.length === 1);
    const packed = result[0];
    assert.equal(packed.name, "moyyi");
    assert.equal(packed.version, pkg.version);
    assert.equal(packed.filename, basename(packed.filename));
    const paths = packed.files.map((file: { path: string }) => file.path);
    assertPackageFiles(paths, expectedPackageFiles());
    const bytes = readFileSync(join(temporary, packed.filename));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const directory = join(repository, "artifacts");
    mkdirSync(directory, { recursive: true });
    assert.equal(
      realpathSync(directory),
      directory,
      "Artifact directory must not redirect outside the checkout",
    );
    const artifact = join(directory, `moyyi-${pkg.version}-${sha256.slice(0, 12)}.tgz`);
    // The checkout may be on a different volume from os.tmpdir(). Publish from a sibling
    // temporary file so the only rename is atomic and stays on the artifact filesystem.
    const pending = join(directory, `.candidate-${randomUUID()}.tmp`);
    try {
      writeFileSync(pending, bytes, { flag: "wx", mode: 0o600 });
      renameSync(pending, artifact);
    } finally {
      rmSync(pending, { force: true });
    }
    const candidate: Candidate = {
      artifact,
      sha256,
      fileCount: paths.length,
      version: pkg.version,
      revision: command("git", ["rev-parse", "HEAD"], repository).trim(),
      dirty: command("git", ["status", "--porcelain"], repository).trim().length > 0,
      manifest: `${artifact}.json`,
    };
    writeFileSync(`${artifact}.sha256`, `${sha256}  ${basename(artifact)}\n`);
    writeFileSync(
      candidate.manifest,
      `${JSON.stringify({ ...candidate, node: process.version, npm: command("npm", ["--version"], repository).trim(), files: paths.sort(), npmIntegrity: packed.integrity, published: false }, null, 2)}\n`,
    );
    return candidate;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
