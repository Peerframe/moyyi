import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceNavigationResult } from "../contracts/index.ts";
import { NodeWorkspaceFiles } from "./files.ts";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup(content: Record<string, string | Uint8Array> = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-navigation-")));
  roots.push(root);
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  const write = (path: string, bytes: string | Uint8Array) => {
    const parts = path.split("/");
    parts.pop();
    mkdirSync(join(workspace, ...parts), { recursive: true });
    writeFileSync(join(workspace, path), bytes);
  };
  for (const [path, bytes] of Object.entries(content)) write(path, bytes);
  const controller = new AbortController();
  let active = true;
  const factory = new NodeWorkspaceFiles([join(workspace, "private-store")]);
  const guard = () => {
    if (!active) throw Error("Navigation grant revoked");
  };
  const allowed = vi.fn((_operation: "list" | "read", _path: string) => true);
  return {
    root,
    workspace,
    write,
    factory,
    controller,
    allowed,
    run: () =>
      factory.readWorkspaceNavigation(
        { workspaceRoot: workspace, signal: controller.signal },
        guard,
        allowed,
      ),
    revoke: () => {
      active = false;
    },
  };
}

function loaded(result: WorkspaceNavigationResult) {
  expect(result.kind).toBe("loaded");
  if (result.kind !== "loaded") throw Error("Expected loaded navigation");
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(8192);
  expect(result.paths.length).toBeLessThanOrEqual(200);
  expect(result.paths.every((path) => !path.startsWith("/") && !path.includes("../"))).toBe(true);
  return result;
}

describe("host-selected workspace navigation", () => {
  it("lists all root and nested source paths while opening only necessary ignore files", async () => {
    const t = setup({
      "card.json": "BODY_CARD_CANARY",
      "src/decode.mjs": "BODY_DECODE_CANARY",
      "src/policy.mjs": "BODY_POLICY_CANARY",
      "src/requests.mjs": "BODY_REQUESTS_CANARY",
      "binary.bin": new Uint8Array([0, 0xff, 1]),
    });
    const opened = vi.spyOn(fsPromises, "open");
    syncBuiltinESMExports();
    expect(loaded(await t.run())).toEqual({
      kind: "loaded",
      paths: ["binary.bin", "card.json", "src/decode.mjs", "src/policy.mjs", "src/requests.mjs"],
      truncated: false,
      skippedEntries: 0,
    });
    expect(opened).not.toHaveBeenCalled();
    expect(t.allowed.mock.calls).toEqual([
      ["list", "."],
      ["read", ".gitignore"],
      ["list", "src"],
      ["read", "src/.gitignore"],
    ]);
  });

  it("uses inherited and nested ignore rules without reading ordinary or excluded file bodies", async () => {
    const t = setup({
      ".gitignore": "*.tmp\nbuild/\n",
      "root.txt": "BODY_ROOT_CANARY",
      "src/.gitignore": "!keep.tmp\nprivate/\n",
      "src/keep.tmp": "BODY_KEEP_CANARY",
      "src/drop.tmp": "BODY_DROP_CANARY",
      "src/main.ts": "BODY_MAIN_CANARY",
      "src/private/.gitignore": "!secret.ts\n",
      "src/private/secret.ts": "BODY_SECRET_CANARY",
      "build/.gitignore": "!built.ts\n",
      "build/built.ts": "BODY_BUILD_CANARY",
    });
    const opened = vi.spyOn(fsPromises, "open");
    syncBuiltinESMExports();
    const result = loaded(await t.run());
    expect(result).toEqual({
      kind: "loaded",
      paths: [".gitignore", "root.txt", "src/.gitignore", "src/keep.tmp", "src/main.ts"],
      truncated: false,
      skippedEntries: 0,
    });
    expect(opened.mock.calls.map(([path]) => path)).toEqual([
      join(t.workspace, ".gitignore"),
      join(t.workspace, "src/.gitignore"),
    ]);
    expect(JSON.stringify(result)).not.toMatch(/BODY_|secret|built/);
  });

  it("excludes protected locations, symbolic aliases and multiply linked files", async () => {
    const t = setup({
      ".env": "PROTECTED",
      ".git/config": "PRIVATE_GIT",
      "private-store/session.txt": "PRIVATE_STORE",
      "real.txt": "VISIBLE_NAME_ONLY",
      "linked.txt": "LINKED_BODY",
    });
    writeFileSync(join(t.root, "outside.txt"), "OUTSIDE_BODY");
    symlinkSync("real.txt", join(t.workspace, "alias.txt"));
    symlinkSync("../outside.txt", join(t.workspace, "outside-alias"));
    symlinkSync("private-store", join(t.workspace, "private-alias"));
    linkSync(join(t.workspace, "linked.txt"), join(t.workspace, "hard-alias"));
    const opened = vi.spyOn(fsPromises, "open");
    syncBuiltinESMExports();
    const result = loaded(await t.run());
    expect(result.paths).toEqual(["real.txt"]);
    expect(result.truncated).toBe(true);
    expect(result.skippedEntries).toBe(8);
    expect(opened).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/BODY|PRIVATE|PROTECTED|alias|\.env/);
  });

  it("does not resolve or enumerate the root when its list grant is denied", async () => {
    const t = setup({ "public.txt": "BODY" });
    t.allowed.mockReturnValue(false);
    const stat = vi.spyOn(fsPromises, "lstat"),
      resolve = vi.spyOn(fsPromises, "realpath"),
      openDirectory = vi.spyOn(fsPromises, "opendir"),
      opened = vi.spyOn(fsPromises, "open");
    syncBuiltinESMExports();
    expect(await t.run()).toEqual({ kind: "blocked" });
    expect(stat).not.toHaveBeenCalled();
    expect(resolve).not.toHaveBeenCalled();
    expect(openDirectory).not.toHaveBeenCalled();
    expect(opened).not.toHaveBeenCalled();
  });

  it("skips a denied directory before resolving, inspecting or reading inside it", async () => {
    const t = setup({ "public.txt": "BODY", "denied/.gitignore": "*", "denied/hidden.ts": "BODY" });
    t.allowed.mockImplementation((operation, path) => !(operation === "list" && path === "denied"));
    const stat = vi.spyOn(fsPromises, "lstat"),
      resolve = vi.spyOn(fsPromises, "realpath"),
      openDirectory = vi.spyOn(fsPromises, "opendir");
    syncBuiltinESMExports();
    expect(loaded(await t.run())).toEqual({
      kind: "loaded",
      paths: ["public.txt"],
      truncated: true,
      skippedEntries: 1,
    });
    for (const calls of [stat.mock.calls, resolve.mock.calls, openDirectory.mock.calls])
      expect(calls.some(([path]) => String(path).includes("/denied"))).toBe(false);
    expect(t.allowed.mock.calls).not.toContainEqual(["read", "denied/.gitignore"]);
  });

  it.each([".gitignore", "src/.gitignore"])(
    "blocks the complete index when necessary %s rules cannot be authorized",
    async (denied) => {
      const t = setup({
        ".gitignore": "*.tmp\n",
        "src/.gitignore": "secret.ts\n",
        "src/secret.ts": "BODY",
      });
      t.allowed.mockImplementation((operation, path) => !(operation === "read" && path === denied));
      const stat = vi.spyOn(fsPromises, "lstat"),
        opened = vi.spyOn(fsPromises, "open");
      syncBuiltinESMExports();
      expect(await t.run()).toEqual({ kind: "blocked" });
      expect(stat.mock.calls.some(([path]) => path === join(t.workspace, denied))).toBe(false);
      expect(opened.mock.calls.some(([path]) => path === join(t.workspace, denied))).toBe(false);
    },
  );

  it.each(["a**b\n", "x".repeat(16385), "#\n".repeat(1025)])(
    "fails closed on unreadable or unsupported ignore rules",
    async (rules) => {
      const t = setup({ ".gitignore": rules, "should-not-escape.ts": "BODY" });
      expect(await t.run()).toEqual({ kind: "blocked" });
    },
  );

  it("does not follow a symbolic ignore file and refuses hardlinked ignore content", async () => {
    const symbolic = setup({ rules: "*\n", "visible.ts": "BODY" });
    symlinkSync("rules", join(symbolic.workspace, ".gitignore"));
    const opened = vi.spyOn(fsPromises, "open");
    syncBuiltinESMExports();
    const result = loaded(await symbolic.run());
    expect(result.paths).toEqual(["rules", "visible.ts"]);
    expect(result.truncated).toBe(true);
    expect(opened).not.toHaveBeenCalled();
    const linked = setup({ rules: "*\n", "visible.ts": "BODY" });
    linkSync(join(linked.workspace, "rules"), join(linked.workspace, ".gitignore"));
    expect(await linked.run()).toEqual({ kind: "blocked" });
    expect(opened).not.toHaveBeenCalled();
  });

  it("refuses an ignore file replaced by an alias before its body is opened", async () => {
    const t = setup({ ".gitignore": "*.tmp\n", "other-rules": "BODY_MUST_NOT_BE_READ\n" });
    const original = fsPromises.lstat;
    let replaced = false;
    vi.spyOn(fsPromises, "lstat").mockImplementation(async (...args) => {
      const stat = await original(...args);
      if (args[0] === join(t.workspace, ".gitignore") && !replaced) {
        replaced = true;
        rmSync(join(t.workspace, ".gitignore"));
        symlinkSync("other-rules", join(t.workspace, ".gitignore"));
      }
      return stat;
    });
    const opened = vi.spyOn(fsPromises, "open");
    syncBuiltinESMExports();
    expect(await t.run()).toEqual({ kind: "blocked" });
    expect(replaced).toBe(true);
    expect(opened).not.toHaveBeenCalled();
  });

  it("bounds the root at depth zero and stops before entering depth-five directories", async () => {
    const t = setup({ "a/b/c/d/visible.ts": "BODY", "a/b/c/d/e/hidden.ts": "BODY" });
    const opened = vi.spyOn(fsPromises, "opendir");
    syncBuiltinESMExports();
    const result = loaded(await t.run());
    expect(result.paths).toEqual(["a/b/c/d/visible.ts"]);
    expect(result.truncated).toBe(true);
    expect(result.skippedEntries).toBe(1);
    expect(opened.mock.calls.map(([path]) => path)).not.toContain(join(t.workspace, "a/b/c/d/e"));
  });

  it("caps visible paths at 200 and reports omitted entries", async () => {
    const t = setup();
    for (let i = 0; i < 230; i++) t.write(`file-${String(i).padStart(3, "0")}.ts`, "BODY");
    const result = loaded(await t.run());
    expect(result.paths).toHaveLength(200);
    expect(result.truncated).toBe(true);
  });

  it("bounds the queue and policy grants before entering many empty directories", async () => {
    const t = setup({ "visible.ts": "BODY" });
    for (let i = 0; i < 512; i++) mkdirSync(join(t.workspace, `empty-${i}`));
    const opened = vi.spyOn(fsPromises, "opendir");
    syncBuiltinESMExports();
    const result = loaded(await t.run());
    expect(result.paths).toEqual(["visible.ts"]);
    expect(result.truncated).toBe(true);
    expect(result.skippedEntries).toBe(512 - 63);
    // Root consumes one directory grant. Capping only dequeues would still admit all 512.
    expect(opened).toHaveBeenCalledTimes(64);
    expect(t.allowed.mock.calls.filter(([operation]) => operation === "list")).toHaveLength(64);
    expect(t.allowed.mock.calls.filter(([operation]) => operation === "read")).toHaveLength(64);
    expect(new Set(opened.mock.calls.map(([path]) => path)).size).toBe(64);
  });

  it("counts escaped UTF-8 path bytes and metadata within the 8192-byte output limit", async () => {
    const t = setup();
    for (let i = 0; i < 90; i++) t.write(`${i}-字"${"x".repeat(180)}.ts`, "BODY");
    const result = loaded(await t.run());
    expect(result.paths.length).toBeGreaterThan(0);
    expect(result.paths.length).toBeLessThan(90);
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(8192);
  });

  it("stops at the visited-entry limit even when ignored paths produce no results", async () => {
    const t = setup({ ".gitignore": "*\n" });
    let enumerated = 0;
    const readEntry = vi.fn(async () =>
      enumerated < 10005
        ? {
            name: `ignored-${enumerated++}`,
            isSymbolicLink: () => false,
            isDirectory: () => false,
          }
        : null,
    );
    const openDirectory = fsPromises.opendir;
    vi.spyOn(fsPromises, "opendir").mockImplementation(async (...args) => {
      const directory = await openDirectory(...args);
      // Ignored names require no per-file I/O; keep real directory identity and closure while
      // avoiding thousands of irrelevant fixture writes in the concurrent integration suite.
      Object.defineProperty(directory, "read", { value: readEntry });
      return directory;
    });
    syncBuiltinESMExports();
    const result = loaded(await t.run());
    expect(result.paths).toEqual([]);
    expect(result.truncated).toBe(true);
    expect(readEntry).toHaveBeenCalledTimes(10000);
    expect(enumerated).toBe(10000);
  });

  it.each(["cancel", "revoke"])("discards in-flight navigation on %s", async (kind) => {
    const t = setup({ ".gitignore": "*.tmp\n", "public.ts": "BODY" });
    const pending = t.run();
    if (kind === "cancel") t.controller.abort();
    else t.revoke();
    await expect(pending).rejects.toThrow(/cancel|revoked/i);
    await expect(t.run()).rejects.toThrow(/cancel|revoked/i);
  });

  it("rejects an aliased workspace root", async () => {
    const t = setup({ "public.ts": "BODY" }),
      alias = join(t.root, "workspace-alias");
    symlinkSync(t.workspace, alias);
    expect(
      await t.factory.readWorkspaceNavigation(
        { workspaceRoot: alias, signal: t.controller.signal },
        () => {},
        () => true,
      ),
    ).toEqual({ kind: "blocked" });
  });
});
