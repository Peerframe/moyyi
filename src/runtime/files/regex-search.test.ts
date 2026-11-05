import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RunId } from "../../contracts/index.ts";
import { NodeWorkspaceFiles } from "./files.ts";
import { compileLinePattern, RegexLines } from "./regex-lines.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function setup(content: Record<string, string>) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-regex-search-")));
  roots.push(root);
  const workspace = join(root, "workspace");
  for (const [path, value] of Object.entries(content)) {
    mkdirSync(join(workspace, ...path.split("/").slice(0, -1)), { recursive: true });
    writeFileSync(join(workspace, path), value);
  }
  mkdirSync(workspace, { recursive: true });
  const controller = new AbortController();
  const files = new NodeWorkspaceFiles([]).create(
    {
      runId: "run_regex" as RunId,
      workspaceRoot: workspace,
      signal: controller.signal,
      limits: { maxOutputBytes: 32 * 1024 },
    },
    () => {},
  );
  return { files, controller };
}

describe("regex workspace search", () => {
  it("matches per line with anchors, alternation and classes, honoring ignore rules", async () => {
    const t = setup({
      ".gitignore": "dist/\n",
      "src/a.ts": "export function alpha() {}\nconst beta = 1;\nexport class Gamma {}\n",
      "src/b.ts": "  export function indented() {}\n",
      "dist/c.ts": "export function hidden() {}\n",
    });
    const result = await t.files.search(".", "^export (function|class) \\w+", { regex: true });
    expect(result.matches).toEqual([
      { path: "src/a.ts", line: 1, text: "export function alpha() {}" },
      { path: "src/a.ts", line: 3, text: "export class Gamma {}" },
    ]);
    expect(result.truncated).toBe(false);
    expect(result).not.toHaveProperty("regexTimeLimit");
    // The same text is literal without regex.
    expect((await t.files.search(".", "^export", {})).matches).toEqual([]);
  });

  it("applies case controls, files mode and the match cap", async () => {
    const t = setup({
      "one.txt": "TODO first\ntodo second\n",
      "two.txt": "nothing\n",
      "three.txt": "Todo third\n",
    });
    const insensitive = await t.files.search(".", "^todo\\b", {
      regex: true,
      caseSensitive: false,
    });
    expect(insensitive.matches.map((match) => `${match.path}:${match.line}`).sort()).toEqual([
      "one.txt:1",
      "one.txt:2",
      "three.txt:1",
    ]);
    const sensitive = await t.files.search(".", "^todo\\b", { regex: true });
    expect(sensitive.matches.map((match) => `${match.path}:${match.line}`)).toEqual(["one.txt:2"]);
    const listed = await t.files.search(".", "o\\b", { regex: true, mode: "files" });
    expect([...(listed.files ?? [])].sort()).toEqual(["one.txt", "three.txt"]);
    const capped = await t.files.search(".", "\\w", { regex: true, maxMatches: 2 });
    expect(capped.matches).toHaveLength(2);
    expect(capped.truncated).toBe(true);
  });

  it("rejects invalid patterns before reading files, and accepts ripgrep-style escapes", async () => {
    const t = setup({ "quote.txt": 'say "hi"\n' });
    await expect(t.files.search(".", "(unclosed", { regex: true })).rejects.toThrow(
      "Invalid regular expression",
    );
    await expect(t.files.search(".", "a\nb", { regex: true })).rejects.toThrow(
      "single-line regular expression",
    );
    await expect(t.files.search(".", "x", { regex: "yes" as never })).rejects.toThrow("boolean");
    expect(compileLinePattern('\\"hi\\"', true)).toEqual({ pattern: '\\"hi\\"', flags: "" });
    expect(compileLinePattern("\\p{Lu}", false)).toEqual({ pattern: "\\p{Lu}", flags: "iu" });
    const escaped = await t.files.search(".", '\\"hi\\"', { regex: true });
    expect(escaped.matches).toEqual([{ path: "quote.txt", line: 1, text: 'say "hi"' }]);
  });

  it("stops catastrophic backtracking at the time budget without blocking the runtime", async () => {
    const lines = new RegexLines(
      compileLinePattern("^(a+)+$", true),
      new AbortController().signal,
      300,
    );
    let ticks = 0;
    const timer = setInterval(() => ticks++, 20);
    const started = Date.now();
    try {
      expect(await lines.match(`${"a".repeat(40)}!`, 10)).toBe("time_limit");
      // Later files are not matched once the budget is spent.
      expect(await lines.match("a", 10)).toBe("time_limit");
    } finally {
      clearInterval(timer);
      await lines.close();
    }
    expect(Date.now() - started).toBeLessThan(3000);
    expect(ticks).toBeGreaterThan(3);
  });

  it("reports a spent budget as incomplete search evidence", async () => {
    const t = setup({ "slow.txt": `${"a".repeat(40)}!\n`, "z.txt": "aaa\n" });
    const result = await t.files.search(".", "^(a+)+$", { regex: true });
    expect(result.regexTimeLimit).toBe(true);
    expect(result.truncated).toBe(true);
  }, 15_000);

  it("cancels a running match", async () => {
    const controller = new AbortController();
    const lines = new RegexLines(compileLinePattern("^(a+)+$", true), controller.signal, 10_000);
    const pending = lines.match(`${"a".repeat(40)}!`, 10);
    setTimeout(() => controller.abort(), 50);
    await expect(pending).rejects.toThrow(/cancel/i);
    await lines.close();
  });
});
