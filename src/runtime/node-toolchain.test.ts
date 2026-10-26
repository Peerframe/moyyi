import { existsSync, lstatSync, realpathSync } from "node:fs";
import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { absoluteLibraryPaths, discoverNodeToolchain, nodeLibraryFiles } from "./node-toolchain.ts";

const temporary: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
async function fixture(): Promise<string> {
  const path = await realpath(await mkdtemp(join(tmpdir(), "moyyi-toolchain-test-")));
  temporary.push(path);
  return path;
}

it("discovers real Node without loading inherited options or host addons", async () => {
  const base = await fixture();
  const canary = join(base, "loaded");
  const loader = join(base, "loader.cjs");
  await writeFile(loader, `require('node:fs').writeFileSync(${JSON.stringify(canary)}, 'LOADED')`);
  vi.stubEnv("NODE_OPTIONS", `--require=${loader}`);
  vi.stubEnv("OPENSSL_CONF", join(base, "missing-config"));
  const hostReport = vi.spyOn(process.report, "getReport").mockImplementation(() => {
    throw Error("Host addon inventory must not become grants");
  });
  const result = await discoverNodeToolchain();
  expect(hostReport).not.toHaveBeenCalled();
  expect(existsSync(canary)).toBe(false);
  expect(result.executablePaths).toEqual([realpathSync(process.execPath)]);
  for (const path of [...result.executablePaths, ...result.readOnlyPaths])
    expect(lstatSync(realpathSync(path)).isFile()).toBe(true);
  expect(result.readOnlyPaths).not.toContain(base);
  expect(Object.isFrozen(result.readOnlyPaths)).toBe(true);
});

it("includes only exact matching library aliases, including Homebrew compatibility names", async () => {
  const base = await fixture();
  const version = join(base, "Cellar", "example", "1");
  const directory = join(version, "lib");
  const opt = join(base, "opt");
  await mkdir(directory, { recursive: true });
  await mkdir(opt);
  const target = join(directory, "libexample.1.dylib");
  const alias = join(directory, "libexample.dylib");
  const sibling = join(directory, "sibling.dylib");
  await writeFile(target, "LIBRARY");
  await writeFile(sibling, "SIBLING_CANARY");
  await symlink(target, alias);
  await symlink(version, join(opt, "example"));
  const paths = nodeLibraryFiles([target]);
  expect(paths.sort()).toEqual(
    [
      target,
      alias,
      join(opt, "example/lib/libexample.1.dylib"),
      join(opt, "example/lib/libexample.dylib"),
    ].sort(),
  );
  expect(paths).not.toContain(directory);
  expect(paths).not.toContain(sibling);
  await rm(alias);
  await symlink(sibling, alias);
  expect(nodeLibraryFiles([target])).not.toContain(alias);
  expect(await readFile(sibling, "utf8")).toBe("SIBLING_CANARY");
});

it("refuses directories, hardlinks, and protected library paths", async () => {
  const base = await fixture();
  const library = join(base, "library.so");
  await writeFile(library, "LIBRARY");
  const protectedAlias = join(base, ".env");
  await symlink(library, protectedAlias);
  expect(() => nodeLibraryFiles([base])).toThrow("regular files");
  expect(() => nodeLibraryFiles([protectedAlias])).toThrow("Protected");
  await link(library, join(base, "hardlink.so"));
  expect(() => nodeLibraryFiles([library])).toThrow("regular files");
});

it("bounds discovery data and excludes non-filesystem kernel objects", () => {
  expect(absoluteLibraryPaths(["linux-vdso.so.1", "/lib/libc.so.6"])).toEqual(["/lib/libc.so.6"]);
  for (const invalid of [[null], ["/bad\0name"], ["x".repeat(4097)], Array(2001).fill("/lib/a")])
    expect(() => absoluteLibraryPaths(invalid)).toThrow("discovery failed");
});
