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
import fsPromises from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RunId } from "../contracts/index.ts";
import { NodeWorkspaceFiles } from "./files.ts";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
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
  it("searches an exact file with ancestor rules without scanning siblings", async () => {
    const t = setup({
      ".gitignore": "*.tmp\nbuild/\n",
      "sub/.gitignore": "!keep.tmp\n",
      "sub/keep.tmp": "before\nneedle\nafter\n",
      "sub/drop.tmp": "needle",
      "sub/sibling.ts": "needle sibling",
      "build/.gitignore": "!a.ts\n",
      "build/a.ts": "needle",
    });
    const opened = vi.spyOn(fsPromises, "open");
    syncBuiltinESMExports();
    const result = await t.files.search("sub/keep.tmp", "needle", { contextLines: 1 });
    expect(result.matches).toEqual([{ path: "sub/keep.tmp", line: 2, text: "needle" }]);
    expect(result.context?.[0]?.text).toBe("before\nneedle\nafter\n");
    expect(opened.mock.calls.map(([path]) => path)).toEqual([
      join(t.workspace, ".gitignore"),
      join(t.workspace, "sub/.gitignore"),
      join(t.workspace, "sub/keep.tmp"),
    ]);
    expect((await t.files.search("sub/drop.tmp", "needle")).matches).toEqual([]);
    expect((await t.files.search("build/a.ts", "needle")).matches).toEqual([]);
    const paths = opened.mock.calls.map(([path]) => path);
    expect(paths).not.toContain(join(t.workspace, "sub/drop.tmp"));
    expect(paths).not.toContain(join(t.workspace, "build/.gitignore"));
    expect(paths).not.toContain(join(t.workspace, "build/a.ts"));
    expect(paths).not.toContain(join(t.workspace, "sub/sibling.ts"));
  });

  it("narrows content before opening candidates and never overrides ignore or protected paths", async () => {
    const t = setup({
      ".gitignore": "src/ignored.ts\n",
      "src/deep/keep.ts": "needle",
      "src/skip.test.ts": "needle EXCLUDED",
      "src/ignored.ts": "needle IGNORED",
      "src/private-store/a.ts": "needle",
      "docs/skip.md": "needle OTHER",
      ".env": "needle SECRET",
      "private-store/data.ts": "needle PRIVATE",
    });
    const opened = vi.spyOn(fsPromises, "open");
    syncBuiltinESMExports();
    const result = await t.files.search(".", "needle", {
      include: ["src/**/*.ts", "private-store/**", ".env"],
      exclude: ["**/*.test.ts", "src/private-store/**"],
    });
    expect(result.matches.map((hit) => hit.path)).toEqual(["src/deep/keep.ts"]);
    expect(opened.mock.calls.map(([path]) => path).sort()).toEqual(
      [join(t.workspace, ".gitignore"), join(t.workspace, "src/deep/keep.ts")].sort(),
    );
    expect(JSON.stringify(result)).not.toMatch(/EXCLUDED|IGNORED|OTHER|SECRET|PRIVATE/);
  });

  it("does not open filtered exact files and keeps default content results compatible", async () => {
    const t = setup({ "src/a.ts": "needle", "docs/a.md": "needle" });
    const opened = vi.spyOn(fsPromises, "open");
    syncBuiltinESMExports();
    expect(await t.files.search("src/a.ts", "needle", { include: ["docs/**"] })).toEqual({
      path: "src/a.ts",
      matches: [],
      truncated: false,
      skippedFiles: 0,
    });
    expect(opened).not.toHaveBeenCalled();
    const legacy = await t.files.search(".", "needle");
    expect(await t.files.search(".", "needle", { mode: "content" })).toEqual(legacy);
    expect(legacy).not.toHaveProperty("mode");
    expect(legacy).not.toHaveProperty("files");
  });

  it("counts distinct matching files instead of lines and omits source text and context", async () => {
    const t = setup({ "a.ts": "needle\n".repeat(100), "b.ts": "needle", "c.ts": "absent" });
    const result = await t.files.search(".", "needle", {
      mode: "files",
      maxMatches: 2,
      contextLines: 20,
    });
    expect(result.mode).toBe("files");
    expect(result.files?.slice().sort()).toEqual(["a.ts", "b.ts"]);
    expect(result.matches).toEqual([]);
    expect(result).not.toHaveProperty("context");
    expect(result.truncated).toBe(true);
    expect(await t.files.search("a.ts", "needle", { mode: "files", maxMatches: 1 })).toEqual({
      path: "a.ts",
      mode: "files",
      files: ["a.ts"],
      matches: [],
      truncated: false,
      skippedFiles: 0,
    });
  });

  it("returns the files-mode shape for ignored and unmatched exact targets", async () => {
    const t = setup({ ".gitignore": "sub/\n", "sub/a.ts": "needle", "b.ts": "absent" });
    for (const path of ["sub/a.ts", "b.ts"]) {
      expect(await t.files.search(path, "needle", { mode: "files", contextLines: 8 })).toEqual({
        path,
        mode: "files",
        files: [],
        matches: [],
        truncated: false,
        skippedFiles: 0,
      });
    }
  });

  it("refuses exact leaf aliases while retaining protected parent and root checks", async () => {
    const t = setup({ "real.ts": "needle", ".env": "needle SECRET" });
    writeFileSync(join(t.root, "outside.ts"), "needle OUTSIDE");
    symlinkSync("real.ts", join(t.workspace, "alias.ts"));
    symlinkSync(".env", join(t.workspace, "private.ts"));
    symlinkSync(t.root, join(t.workspace, "outside"));
    linkSync(join(t.root, "outside.ts"), join(t.workspace, "hard.ts"));
    for (const path of ["alias.ts", "private.ts", "outside/outside.ts", "hard.ts"]) {
      await expect(t.files.search(path, "needle", { mode: "files" })).rejects.toThrow(
        /unlinked|protected|escapes/i,
      );
    }
  });

  it("uses canonical ancestor rules for an authorized internal parent alias", async () => {
    const t = setup({
      ".gitignore": "real/ignored.ts\n",
      "real/ignored.ts": "needle",
      "real/allowed.ts": "needle",
    });
    symlinkSync("real", join(t.workspace, "alias"));
    expect((await t.files.search("alias/ignored.ts", "needle")).matches).toEqual([]);
    expect((await t.files.search("alias/allowed.ts", "needle")).matches).toEqual([
      { path: "real/allowed.ts", line: 1, text: "needle" },
    ]);
  });

  it("keeps files-only results honest about partial and unreadable scans", async () => {
    const t = setup({
      "large.ts": `needle\n${"x".repeat(1024 * 1024)}`,
      "binary.ts": new Uint8Array([110, 101, 101, 100, 108, 101, 0]),
    });
    const partial = await t.files.search("large.ts", "needle", { mode: "files" });
    expect(partial.files).toEqual(["large.ts"]);
    expect(partial.truncated).toBe(true);
    const binary = await t.files.search("binary.ts", "needle", { mode: "files" });
    expect(binary.files).toEqual([]);
    expect(binary.skippedFiles).toBe(1);
    expect(binary.truncated).toBe(true);
  });

  it.each(["content", "files"] as const)(
    "discards in-flight exact %s results on revocation",
    async (mode) => {
      const t = setup({ "source.ts": "needle" });
      const pending = t.files.search("source.ts", "needle", { mode });
      t.revoke();
      await expect(pending).rejects.toThrow(/revoked/i);
    },
  );

  it.each(["content", "files"] as const)(
    "discards in-flight filtered %s results on cancellation",
    async (mode) => {
      const t = setup({ "source.ts": "needle" });
      const pending = t.files.search(".", "needle", { mode, include: ["*.ts"] });
      t.controller.abort();
      await expect(pending).rejects.toThrow(/cancel/i);
    },
  );

  it("rejects invalid new options before resolving the search target", async () => {
    const t = setup();
    for (const options of [{ include: [] }, { exclude: ["../*"] }, { mode: "other" }]) {
      await expect(t.files.search("missing", "needle", options as never)).rejects.toThrow(
        /Search filters|Search mode/,
      );
    }
  });

  it("returns merged search context from the same source while preserving exact legacy hits", async () => {
    const text = "before\nexport function picked() {\n  return pickedValue;\n}\nafter\n";
    const t = setup({ "source.ts": text });
    const old = await t.files.search(".", "picked");
    const result = await t.files.search(".", "picked", { contextLines: 1 });
    expect(result.matches).toEqual(old.matches);
    expect(old).not.toHaveProperty("context");
    expect(result.context).toEqual([
      {
        path: "source.ts",
        startLine: 1,
        endLine: 4,
        text: text.slice(0, text.indexOf("after")),
        complete: true,
      },
    ]);
    expect(result.truncated).toBe(false);
  });
  it("does not add context from ignored, protected, or linked files", async () => {
    const t = setup({
      "allowed.ts": "hit\nvisible\n",
      "ignored.ts": "hit\nIGNORED\n",
      ".gitignore": "ignored.ts\n",
      ".env": "hit\nSECRET\n",
      "private-store/data": "hit\nPRIVATE\n",
    });
    symlinkSync("allowed.ts", join(t.workspace, "alias.ts"));
    const result = await t.files.search(".", "hit", { contextLines: 20 });
    expect(result.context?.map((window) => window.path)).toEqual(["allowed.ts"]);
    expect(JSON.stringify(result)).not.toMatch(/IGNORED|SECRET|PRIVATE/);
  });
  it("caps total context bytes without widening the scan or falsely marking completeness", async () => {
    const line = `hit ${"x".repeat(1800)}\n`;
    const t = setup({ "source.txt": line.repeat(100) });
    const result = await t.files.search(".", "hit", { maxMatches: 100, contextLines: 20 });
    expect(
      result.context?.reduce((sum, window) => sum + Buffer.byteLength(window.text), 0),
    ).toBeLessThanOrEqual(65536);
    expect(result.context?.[0]?.complete).toBe(false);
    expect(result.truncated).toBe(true);
    expect(result.matches).toHaveLength(100);
  });
  it.each([-1, 21, 1.5, null, "2", NaN])(
    "rejects invalid context radius %j before file access",
    async (contextLines) => {
      const t = setup();
      await expect(t.files.search("missing", "hit", { contextLines } as never)).rejects.toThrow(
        /context/,
      );
    },
  );
  it.each(["abort", "revoke"])("discards in-flight search context on %s", async (kind) => {
    const t = setup({ "source.ts": "hit\nDO_NOT_RETURN\n" });
    const pending = t.files.search(".", "hit", { contextLines: 20 });
    if (kind === "abort") t.controller.abort();
    else t.revoke();
    await expect(pending).rejects.toThrow(/cancel|revoked/i);
  });
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
  it("reads the requested source lines with original UTF-8 and CRLF delimiters", async () => {
    const t = setup({ "source.txt": "first\r\n第二行😀\r\nthird\nlast" });
    const text = "第二行😀\r\n";
    expect(await t.files.read("source.txt", { startLine: 2, maxLines: 1 })).toEqual({
      path: "source.txt",
      text,
      bytesRead: Buffer.byteLength(text),
      truncated: true,
      lineRange: { startLine: 2, endLine: 2, complete: true },
    });
    expect(await t.files.read("source.txt", { maxLines: 1 })).toMatchObject({
      text: "first\r\n",
      lineRange: { startLine: 1, endLine: 1, complete: true },
    });
    expect(await t.files.read("source.txt", { startLine: 3 })).toMatchObject({
      text: "third\nlast",
      lineRange: { startLine: 3, endLine: 4, complete: true },
    });
  });
  it("preserves a non-file-leading BOM character at the selected line boundary", async () => {
    const t = setup({ "source.txt": "first\n\ufeffsecond\nthird" });
    const text = "\ufeffsecond\n";
    expect(await t.files.read("source.txt", { startLine: 2, maxLines: 1 })).toEqual({
      path: "source.txt",
      text,
      bytesRead: Buffer.byteLength(text),
      truncated: true,
      lineRange: { startLine: 2, endLine: 2, complete: true },
    });
  });
  it.each([
    { source: "a\n\n", startLine: 2, text: "\n", endLine: 2, truncated: true },
    { source: "a\n\n", startLine: 3, text: "", endLine: null, truncated: true },
    { source: "a", startLine: 2, text: "", endLine: null, truncated: true },
    { source: "a\n", startLine: 1000000, text: "", endLine: null, truncated: true },
    { source: "", startLine: 1, text: "", endLine: null, truncated: false },
    { source: "\n", startLine: 1, text: "\n", endLine: 1, truncated: false },
    { source: "a\nb", startLine: 1, text: "a\nb", endLine: 2, truncated: false },
  ])("reports EOF without a phantom trailing line: %j", async (test) => {
    const t = setup({ "lines.txt": test.source });
    expect(await t.files.read("lines.txt", { startLine: test.startLine, maxLines: 10 })).toEqual({
      path: "lines.txt",
      text: test.text,
      bytesRead: Buffer.byteLength(test.text),
      truncated: test.truncated,
      lineRange: { startLine: test.startLine, endLine: test.endLine, complete: true },
    });
  });
  it("distinguishes a byte-cut range from a complete range that omits other file lines", async () => {
    const t = setup({ "lines.txt": "skipped\nαβ😀\nnext\n", "emoji.txt": "😀\n" });
    expect(await t.files.read("lines.txt", { startLine: 2, maxLines: 2, maxBytes: 7 })).toEqual({
      path: "lines.txt",
      text: "αβ",
      bytesRead: 4,
      truncated: true,
      lineRange: { startLine: 2, endLine: 2, complete: false },
    });
    expect(
      await t.files.read("lines.txt", { startLine: 2, maxLines: 2, maxBytes: 9 }),
    ).toMatchObject({
      text: "αβ😀\n",
      lineRange: { startLine: 2, endLine: 2, complete: false },
    });
    expect(await t.files.read("emoji.txt", { startLine: 1, maxBytes: 1 })).toMatchObject({
      text: "",
      bytesRead: 0,
      truncated: true,
      lineRange: { startLine: 1, endLine: null, complete: false },
    });
  });
  it("defaults line count to 200 and rejects incomplete full-file scans", async () => {
    const t = setup({
      "many.txt": "line\n".repeat(300),
      "exact.txt": "x".repeat(1024 * 1024),
      "oversized.txt": "x".repeat(1024 * 1024 + 1),
    });
    expect(await t.files.read("many.txt", { startLine: 2 })).toMatchObject({
      text: "line\n".repeat(200),
      truncated: true,
      lineRange: { startLine: 2, endLine: 201, complete: true },
    });
    expect(await t.files.read("exact.txt", { startLine: 1, maxBytes: 1 })).toMatchObject({
      text: "x",
      lineRange: { startLine: 1, endLine: 1, complete: false },
    });
    await expect(
      t.files.read("oversized.txt", { startLine: 1, maxLines: 1, maxBytes: 1 }),
    ).rejects.toThrow(/within 1 MiB/);
  });
  it("range reads retain protected-path, link and complete UTF-8 validation", async () => {
    const t = setup({
      ".env": "synthetic protected value",
      "private-store/blob": "synthetic session",
      "broken.txt": new Uint8Array([65, 10, 0xff]),
    });
    writeFileSync(join(t.root, "outside.txt"), "outside synthetic canary");
    symlinkSync("../outside.txt", join(t.workspace, "escape"));
    linkSync(join(t.root, "outside.txt"), join(t.workspace, "linked.txt"));
    for (const path of [".env", "private-store/blob", "escape", "linked.txt", "../outside.txt"])
      await expect(t.files.read(path, { startLine: 1, maxLines: 1 })).rejects.toThrow();
    await expect(t.files.read("broken.txt", { startLine: 1, maxLines: 1 })).rejects.toThrow(
      /UTF-8/,
    );
  });
  it.each([
    { startLine: 0 },
    { startLine: 1000001 },
    { startLine: 1.5 },
    { startLine: Infinity },
    { maxLines: 0 },
    { maxLines: 1001 },
    { maxLines: -1 },
    { maxLines: NaN },
  ])("rejects invalid line limits before accessing the target: %j", async (options) => {
    const t = setup();
    await expect(t.files.read("absent.txt", options)).rejects.toThrow(/Limit/);
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
  it.each(["abort", "revoke"])("discards an in-flight range scan on %s", async (kind) => {
    const t = setup({ "a.txt": "must not be returned\n".repeat(1000) });
    const pending = t.files.read("a.txt", { startLine: 500, maxLines: 2 });
    if (kind === "abort") t.controller.abort();
    else t.revoke();
    await expect(pending).rejects.toThrow(/cancelled|revoked/);
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
