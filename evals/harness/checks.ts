import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { promisify } from "node:util";
import type { CheckResult } from "./types.ts";

/** Shared building blocks for task checkers, so each task states only what is specific to it. */

const run = promisify(execFile);

export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/** sha256 of every file under `dir`, keyed by path relative to `dir`. */
export async function treeHashes(dir: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!(await exists(dir))) return out;
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    out.set(
      relative(dir, path),
      createHash("sha256")
        .update(await readFile(path))
        .digest("hex"),
    );
  }
  return out;
}

/** Paths (relative to the fixture) whose content differs from the fixture or that are gone. */
export async function changedFromFixture(
  fixtureDir: string,
  workspace: string,
  paths: readonly string[],
): Promise<string[]> {
  const changed: string[] = [];
  for (const path of paths) {
    const before = await readFile(join(fixtureDir, path)).catch(() => null);
    const after = await readFile(join(workspace, path)).catch(() => null);
    if (before === null) throw new Error(`fixture has no ${path}`);
    if (after === null || !before.equals(after)) changed.push(path);
  }
  return changed;
}

/** Han characters, CJK punctuation and full-width forms. */
export function hasChinese(text: string): boolean {
  return /[　-〿㐀-䶿一-鿿＀-￯]/.test(text);
}

/**
 * Runs a probe script in a child process with a timeout. Code an agent wrote must never run
 * inside the harness. The probe prints JSON on its last line.
 */
export async function runProbe(script: string, args: readonly string[]): Promise<unknown> {
  const { stdout } = await run(process.execPath, ["--input-type=module", "-e", script, ...args], {
    timeout: 10_000,
  });
  const lines = stdout.trim().split("\n");
  return JSON.parse(lines[lines.length - 1] ?? "null");
}

/** Type-checks a workspace project with moyyi's own pinned TypeScript. */
export async function runTsc(projectDir: string): Promise<{ ok: boolean; output: string }> {
  // The package's exports hide bin/, so locate it through package.json and its bin entry.
  const manifest = createRequire(import.meta.url).resolve("typescript/package.json");
  const { bin } = JSON.parse(await readFile(manifest, "utf8")) as { bin: { tsc: string } };
  const tsc = join(dirname(manifest), bin.tsc);
  try {
    await run(process.execPath, [tsc, "-p", join(projectDir, "tsconfig.json")], {
      timeout: 60_000,
    });
    return { ok: true, output: "" };
  } catch (error) {
    const { stdout = "", message } = error as { stdout?: string; message: string };
    return { ok: false, output: (stdout || message).trim().split("\n").slice(0, 3).join(" | ") };
  }
}

/** RFC 4180 CSV: quoted fields, doubled quotes, CRLF or LF. Enough for checker inputs. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** Collects failed expectations; passes only when there are none. */
export class Expectations {
  readonly #failures: string[] = [];

  that(condition: boolean, failure: string): this {
    if (!condition) this.#failures.push(failure);
    return this;
  }

  result(success = "all checks pass"): CheckResult {
    return this.#failures.length === 0
      ? { passed: true, details: success }
      : { passed: false, details: this.#failures.join("; ") };
  }
}
