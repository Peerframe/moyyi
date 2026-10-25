import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { NodeWorkspaceFiles } from "./files.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-skill-reader-")));
  roots.push(root);
  const library = join(root, "library"),
    directory = join(library, "test-skill"),
    path = join(directory, "SKILL.md");
  mkdirSync(directory, { recursive: true });
  writeFileSync(path, "BODY");
  const context = { workspaceRoot: library, signal: new AbortController().signal };
  return { root, library, directory, path, context, files: new NodeWorkspaceFiles() };
}
it("accepts a complete UTF-8 document exactly at the byte cap and rejects partial final codepoints", async () => {
  const f = fixture();
  writeFileSync(f.path, `${"x".repeat(12 * 1024 - 3)}你`);
  const result = await f.files.readSkillDocument(f.context, "test-skill", () => {});
  expect(result.truncated).toBe(false);
  expect(result.bytesRead).toBe(12 * 1024);
  expect(result.text.endsWith("你")).toBe(true);
  writeFileSync(f.path, Buffer.concat([Buffer.alloc(12 * 1024 - 1, 120), Buffer.from([0xe4])]));
  await expect(f.files.readSkillDocument(f.context, "test-skill", () => {})).rejects.toThrow(
    /UTF-8/,
  );
});
it.each(["directory", "leaf"])(
  "rejects %s replacement between the initial identity and actual file access",
  async (kind) => {
    const f = fixture();
    let checks = 0,
      replaced = false;
    await expect(
      f.files.readSkillDocument(f.context, "test-skill", () => {
        // The eighth guard runs after the initial directory lstat; the tenth after the leaf lstat.
        if (++checks === (kind === "directory" ? 8 : 10)) {
          if (kind === "directory") {
            renameSync(f.directory, join(f.root, "old"));
            mkdirSync(f.directory);
            writeFileSync(f.path, "REPLACEMENT");
          } else {
            renameSync(f.path, join(f.root, "old-file"));
            writeFileSync(f.path, "REPLACEMENT");
          }
          replaced = true;
        }
      }),
    ).rejects.toThrow(/changed/);
    expect(replaced).toBe(true);
    expect(readFileSync(f.path, "utf8")).toBe("REPLACEMENT");
  },
);
it("rejects aliases even within the library and respects additional protected paths", async () => {
  const f = fixture();
  const target = join(f.library, "real-file");
  renameSync(f.path, target);
  symlinkSync(target, f.path);
  await expect(f.files.readSkillDocument(f.context, "test-skill", () => {})).rejects.toThrow();
  rmSync(f.path);
  linkSync(target, f.path);
  await expect(f.files.readSkillDocument(f.context, "test-skill", () => {})).rejects.toThrow();
  rmSync(f.path);
  writeFileSync(f.path, "BODY");
  const restricted = new NodeWorkspaceFiles([f.directory]);
  await expect(restricted.readSkillDocument(f.context, "test-skill", () => {})).rejects.toThrow();
});
it("rejects secret-name roots and model-shaped traversal before any selected-file read", async () => {
  const f = fixture();
  renameSync(f.library, join(f.root, ".ssh"));
  await expect(
    f.files.readSkillDocument(
      { ...f.context, workspaceRoot: join(f.root, ".ssh") },
      "test-skill",
      () => {},
    ),
  ).rejects.toThrow(/Protected/);
  await expect(
    f.files.readSkillDocument(f.context, "../test-skill", () => {
      throw Error("must not be reached");
    }),
  ).rejects.toThrow(/Invalid skill/);
});
