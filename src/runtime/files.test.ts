import { execFileSync } from "node:child_process";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RunId } from "../contracts/index.ts";
import { NodeWorkspaceFiles } from "./files.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function setup(content: Record<string, string | Uint8Array> = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-files-host-")));
  roots.push(root);
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  const write = (path: string, value: string | Uint8Array) => {
    const pieces = path.split("/");
    pieces.pop();
    mkdirSync(join(workspace, ...pieces), { recursive: true });
    writeFileSync(join(workspace, path), value);
  };
  for (const [path, value] of Object.entries(content)) write(path, value);
  const controller = new AbortController();
  let allowed = true;
  const factory = new NodeWorkspaceFiles([join(workspace, "private-store")]);
  const files = factory.create(
    {
      runId: "run_host" as RunId,
      workspaceRoot: workspace,
      signal: controller.signal,
      limits: { maxOutputBytes: 32 * 1024 },
    },
    () => {
      if (!allowed) throw Error("revoked");
    },
  );
  return {
    root,
    workspace,
    write,
    files,
    controller,
    revoke: () => {
      allowed = false;
    },
  };
}

describe("runtime workspace file capability", () => {
  it("reads UTF-8 and lists real files/directories without returning protected names", async () => {
    const t = setup({
      "hello.txt": "hello world",
      "folder/a.txt": "a",
      ".env": "synthetic protected value",
      "private-store/blob": "synthetic session",
    });
    expect(await t.files.read("hello.txt")).toEqual({
      path: "hello.txt",
      text: "hello world",
      bytesRead: 11,
      truncated: false,
    });
    const list = await t.files.list(".");
    expect(list.entries.map((item) => item.path)).toEqual(["folder", "hello.txt"]);
    expect(list.skippedEntries).toBe(2);
  });
  it.each([
    "../canary.txt",
    "/etc/passwd",
    "folder/../../canary.txt",
    "folder\\..\\canary.txt",
    "",
  ])("rejects invalid or escaping path %s", async (path) => {
    const t = setup();
    writeFileSync(join(t.root, "canary.txt"), "outside synthetic canary");
    await expect(t.files.read(path)).rejects.toThrow(/relative workspace path/);
  });
  it.each([
    ".env",
    ".env.example",
    ".ssh/id_ed25519",
    "keys/secret.pem",
    ".git/config",
    "private-store/blob",
  ])("denies protected path %s", async (path) => {
    const t = setup({ [path]: "synthetic secret" });
    await expect(t.files.read(path)).rejects.toThrow(/protected/i);
    expect((await t.files.search(".", "synthetic secret")).matches).toEqual([]);
  });
  it("allows safe internal file links but rejects external and protected link targets", async () => {
    const t = setup({ "actual.txt": "allowed", ".env": "protected" });
    writeFileSync(join(t.root, "outside.txt"), "outside synthetic canary");
    symlinkSync("actual.txt", join(t.workspace, "inside"));
    symlinkSync("../outside.txt", join(t.workspace, "escape"));
    symlinkSync(".env", join(t.workspace, "alias"));
    expect((await t.files.read("inside")).text).toBe("allowed");
    await expect(t.files.read("escape")).rejects.toThrow(/escapes/);
    await expect(t.files.read("alias")).rejects.toThrow(/protected/i);
    const list = await t.files.list(".");
    expect(list.entries.some((item) => item.path === "inside" && item.type === "symlink")).toBe(
      true,
    );
    expect(list.entries.some((item) => ["escape", "alias"].includes(item.path))).toBe(false);
  });
  it("rejects symlinked parent escapes and does not recurse into internal link cycles", async () => {
    const t = setup({ "dir/a.txt": "needle" });
    symlinkSync(t.root, join(t.workspace, "escape"));
    symlinkSync("..", join(t.workspace, "dir/cycle"));
    await expect(t.files.list("escape")).rejects.toThrow(/escapes/);
    await expect(t.files.read("escape/none")).rejects.toThrow();
    expect((await t.files.search(".", "needle")).matches.map((match) => match.path)).toEqual([
      "dir/a.txt",
    ]);
  });
  it("rejects hardlinked aliases", async () => {
    const t = setup();
    writeFileSync(join(t.root, "outside.txt"), "outside synthetic canary");
    linkSync(join(t.root, "outside.txt"), join(t.workspace, "linked.txt"));
    await expect(t.files.read("linked.txt")).rejects.toThrow(/one link/);
  });
  it.each([
    new Uint8Array([65, 0, 66]),
    new Uint8Array([0xff, 0xfe, 65]),
    new Uint8Array([1, 2, 3]),
  ])("refuses binary and invalid UTF-8 without returning bytes %#", async (bytes) => {
    const t = setup({ "binary.bin": bytes });
    await expect(t.files.read("binary.bin")).rejects.toThrow(/Binary|UTF-8/);
    const search = await t.files.search(".", "A");
    expect(search.matches).toEqual([]);
    expect(search.skippedFiles).toBe(1);
  });
  it("bounds large text and keeps a UTF-8 character boundary", async () => {
    const t = setup({
      "large.txt": "a".repeat(2 * 1024 * 1024),
      "unicode.txt": String.fromCodePoint(0x1f600).repeat(8),
    });
    const large = await t.files.read("large.txt", { maxBytes: 1024 });
    expect(large.text).toHaveLength(1024);
    expect(large.truncated).toBe(true);
    const unicode = await t.files.read("unicode.txt", { maxBytes: 5 });
    expect(unicode.text).toBe(String.fromCodePoint(0x1f600));
    expect(unicode.truncated).toBe(true);
    expect((await t.files.search(".", "needle")).truncated).toBe(true);
  });
  it("caps listings and matches, reports line numbers, and treats queries literally", async () => {
    const t = setup({ "a.txt": "first\na.*b\nNEEDLE\n", "b.txt": "needle", "c.txt": "other" });
    expect(await t.files.list(".", { maxEntries: 1 })).toMatchObject({
      truncated: true,
      entries: [expect.anything()],
    });
    expect((await t.files.search(".", "a.*b")).matches).toEqual([
      { path: "a.txt", line: 2, text: "a.*b" },
    ]);
    const search = await t.files.search(".", "needle", { caseSensitive: false, maxMatches: 1 });
    expect(search.matches).toHaveLength(1);
    expect(search.truncated).toBe(true);
  });
  it("honors inherited, nested, negated and directory ignore rules, including explicit search roots", async () => {
    const t = setup({
      ".gitignore": "*.log\n!keep.log\nbuild/\n*.tmp\n",
      "drop.log": "needle",
      "keep.log": "needle",
      "build/keep.txt": "needle",
      "sub/.gitignore": "!keep.tmp\nlocal.txt\n",
      "sub/keep.tmp": "needle",
      "sub/drop.tmp": "needle",
      "sub/local.txt": "needle",
      "sub/normal.txt": "needle",
    });
    expect((await t.files.search(".", "needle")).matches.map((match) => match.path).sort()).toEqual(
      ["keep.log", "sub/keep.tmp", "sub/normal.txt"],
    );
    expect(
      (await t.files.search("sub", "needle")).matches.map((match) => match.path).sort(),
    ).toEqual(["sub/keep.tmp", "sub/normal.txt"]);
    expect((await t.files.search("build", "needle")).matches).toEqual([]);
    const env = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
    execFileSync("git", ["init", "--quiet", t.workspace], { env });
    const candidates = [
      "drop.log",
      "keep.log",
      "build/keep.txt",
      "sub/keep.tmp",
      "sub/drop.tmp",
      "sub/local.txt",
      "sub/normal.txt",
    ];
    const ignored = execFileSync(
      "git",
      ["-C", t.workspace, "check-ignore", "--no-index", "--stdin"],
      { input: candidates.join("\n"), encoding: "utf8", env },
    )
      .trim()
      .split("\n");
    expect(candidates.filter((path) => !ignored.includes(path)).sort()).toEqual(
      (await t.files.search(".", "needle")).matches.map((match) => match.path).sort(),
    );
  });
  it("does not follow a symbolic ignore file", async () => {
    const t = setup({ rules: "*.txt", "a.txt": "needle" });
    symlinkSync("rules", join(t.workspace, ".gitignore"));
    expect((await t.files.search(".", "needle")).matches.map((match) => match.path)).toEqual([
      "a.txt",
    ]);
  });
  it.each([
    "***/file",
    "/**",
    "!/**/",
    "foo**/bar",
    "a\\/b",
    "[[:constructor:]]",
    "[[:__proto__:]]",
  ])("fails closed on unsupported ignore syntax %s", async (pattern) => {
    const t = setup({ ".gitignore": pattern, "a.txt": "needle" });
    await expect(t.files.search(".", "needle")).rejects.toThrow(/Unsupported/);
  });
  it("fails closed when ignore rules are oversized or binary", async () => {
    const t = setup({ ".gitignore": "x".repeat(20_000), "a.txt": "needle" });
    await expect(t.files.search(".", "needle")).rejects.toThrow(/Ignore rules exceed/);
    t.write(".gitignore", new Uint8Array([0, 1, 2]));
    await expect(t.files.search(".", "needle")).rejects.toThrow(/complete .gitignore/);
  });
  it.each(["abort", "revoke"])("discards an in-flight read on %s", async (kind) => {
    const t = setup({ "a.txt": "must not be returned" });
    const pending = t.files.read("a.txt");
    if (kind === "abort") t.controller.abort();
    else t.revoke();
    await expect(pending).rejects.toThrow(/cancelled|revoked/);
    await expect(t.files.list(".")).rejects.toThrow(/cancelled|revoked/);
  });
  it("rejects replacement of the workspace identity between operations", async () => {
    const t = setup({ "a.txt": "original" });
    await t.files.read("a.txt");
    renameSync(t.workspace, join(t.root, "moved"));
    mkdirSync(t.workspace);
    writeFileSync(join(t.workspace, "a.txt"), "replacement");
    await expect(t.files.read("a.txt")).rejects.toThrow(/identity changed/);
  });
  it("protects canonical private data even when configured through an outside symlink alias", async () => {
    const t = setup({ "private-data/session.txt": "synthetic-private-canary" });
    const alias = join(t.root, "private-alias");
    symlinkSync(join(t.workspace, "private-data"), alias);
    const files = new NodeWorkspaceFiles([alias]).create(
      {
        runId: "run_alias" as RunId,
        workspaceRoot: t.workspace,
        signal: t.controller.signal,
        limits: { maxOutputBytes: 32768 },
      },
      () => {},
    );
    await expect(files.read("private-data/session.txt")).rejects.toThrow(/protected/i);
    expect((await files.search(".", "synthetic-private-canary")).matches).toEqual([]);
    expect((await files.list(".")).entries).toEqual([]);
  });
  it("binds a missing protected leaf through its real ancestor and rejects dangling aliases", async () => {
    const t = setup();
    const alias = join(t.root, "workspace-alias");
    symlinkSync(t.workspace, alias);
    const files = new NodeWorkspaceFiles([join(alias, "future-private")]).create(
      {
        runId: "run_future" as RunId,
        workspaceRoot: t.workspace,
        signal: t.controller.signal,
        limits: { maxOutputBytes: 32768 },
      },
      () => {},
    );
    t.write("future-private/session.txt", "synthetic future canary");
    await expect(files.read("future-private/session.txt")).rejects.toThrow(/protected/i);
    const dangling = join(t.root, "dangling");
    symlinkSync(join(t.root, "absent"), dangling);
    expect(() => new NodeWorkspaceFiles([dangling])).toThrow();
  });
  it("rejects invalid resource limits without opening files", async () => {
    const t = setup();
    await expect(t.files.read("a", { maxBytes: Infinity })).rejects.toThrow(/Limit/);
    await expect(t.files.list(".", { maxEntries: 501 })).rejects.toThrow(/Limit/);
    await expect(t.files.search(".", "", { maxMatches: 10 })).rejects.toThrow(
      /single-line literal/,
    );
  });
});
