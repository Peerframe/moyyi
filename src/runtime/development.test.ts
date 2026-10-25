import { execFileSync } from "node:child_process";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fileDevelopmentPlugin, watchDevelopmentPlugins } from "./development.ts";

const roots: string[] = [];
const watchers: { close(): void }[] = [];
afterEach(() => {
  for (const watcher of watchers.splice(0)) watcher.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function root() {
  const path = mkdtempSync(join(tmpdir(), "moyyi-dev-loader-"));
  roots.push(path);
  return path;
}
const source = (version: string) =>
  `export default {name:"example",apiVersion:1,version:${JSON.stringify(version)},setup(){}};`;
async function timeout<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(Error("Watcher did not notify")), 3000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

describe("development ESM loader and entry watcher", () => {
  it("does not evaluate on construction, then loads a fresh URL for each edit", async () => {
    const path = join(root(), "plugin #1.mjs");
    // Vitest rewrites dynamic imports; use the native Node loader for escaped file URLs.
    const program = `
      import assert from 'node:assert/strict';
      import { writeFileSync } from 'node:fs';
      import { fileDevelopmentPlugin } from ${JSON.stringify(new URL("./development.ts", import.meta.url).href)};
      const path = ${JSON.stringify(path)};
      writeFileSync(path, "throw Error('not yet loaded');");
      const entry = fileDevelopmentPlugin('example', path);
      writeFileSync(path, ${JSON.stringify(source("one"))});
      assert.equal((await entry.load()).plugin.version, 'one');
      writeFileSync(path, ${JSON.stringify(source("two"))});
      assert.equal((await entry.load()).plugin.version, 'two');
      assert.equal(entry.filePath, path);
    `;
    expect(() =>
      execFileSync(process.execPath, ["--input-type=module", "-e", program], { timeout: 5000 }),
    ).not.toThrow();
  });
  it("uses independent URLs when a second loader targets the same file", async () => {
    const path = join(root(), "plugin.mjs");
    writeFileSync(path, source("one"));
    await fileDevelopmentPlugin("example", path).load();
    writeFileSync(path, source("two"));
    expect((await fileDevelopmentPlugin("example", path).load()).plugin).toMatchObject({
      version: "two",
    });
  });
  it.each([".cjs", ".js", ".json"])("rejects ambiguous or non-ESM entry %s", (extension) => {
    expect(() => fileDevelopmentPlugin("example", join(root(), `plugin${extension}`))).toThrow(
      /ES modules/,
    );
  });
  it("rejects invalid names and a mismatched/defaultless export", async () => {
    expect(() => fileDevelopmentPlugin("../bad", join(root(), "plugin.mjs"))).toThrow(/name/);
    const path = join(root(), "plugin.mjs");
    const entry = fileDevelopmentPlugin("example", path);
    writeFileSync(path, "export const plugin = {};");
    await expect(entry.load()).rejects.toThrow(/default/);
    writeFileSync(path, 'export default {name:"wrong",apiVersion:1,setup(){}};');
    await expect(entry.load()).rejects.toThrow(/configured name/);
  });
  it("survives atomic replacement saves because the parent directory is watched", async () => {
    const directory = root();
    const path = join(directory, "plugin.mjs");
    writeFileSync(path, source("one"));
    const entry = fileDevelopmentPlugin("example", path);
    let notification = Promise.withResolvers<string>();
    const errors = vi.fn();
    const watcher = watchDevelopmentPlugins(
      [entry],
      (name) => notification.resolve(name),
      errors,
      10,
    );
    watchers.push(watcher);
    writeFileSync(join(directory, "replacement.mjs"), source("two"));
    renameSync(join(directory, "replacement.mjs"), path);
    expect(await timeout(notification.promise)).toBe("example");
    notification = Promise.withResolvers<string>();
    writeFileSync(path, source("three"));
    expect(await timeout(notification.promise)).toBe("example");
    expect(errors).not.toHaveBeenCalled();
  });
  it("filters unrelated files and closing cancels pending notifications", async () => {
    const directory = root();
    const path = join(directory, "plugin.mjs");
    writeFileSync(path, source("one"));
    const changed = vi.fn();
    const watcher = watchDevelopmentPlugins(
      [fileDevelopmentPlugin("example", path)],
      changed,
      vi.fn(),
      50,
    );
    watchers.push(watcher);
    writeFileSync(join(directory, "unrelated.txt"), "ignore");
    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(changed).not.toHaveBeenCalled();
    writeFileSync(path, source("two"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    watcher.close();
    watcher.close();
    await new Promise((resolve) => setTimeout(resolve, 70));
    expect(changed).not.toHaveBeenCalled();
  });
  it("reports watcher setup failure while retaining the manual loader", async () => {
    const entry = fileDevelopmentPlugin("example", join(root(), "missing", "plugin.mjs"));
    const errors = vi.fn();
    const watcher = watchDevelopmentPlugins([entry], vi.fn(), errors);
    watchers.push(watcher);
    expect(errors).toHaveBeenCalledExactlyOnceWith(
      "example",
      "Development watcher failed; use /reload manually",
    );
    expect(entry.load).toBeTypeOf("function");
  });
  it("reports failed asynchronous callbacks without unhandled rejection", async () => {
    const path = join(root(), "plugin.mjs");
    writeFileSync(path, source("one"));
    const reported = Promise.withResolvers<string>();
    const watcher = watchDevelopmentPlugins(
      [fileDevelopmentPlugin("example", path)],
      async () => {
        throw Error("callback failed");
      },
      (_name, message) => reported.resolve(message),
      5,
    );
    watchers.push(watcher);
    writeFileSync(path, source("two"));
    expect(await timeout(reported.promise)).toContain("/reload");
  });
});
