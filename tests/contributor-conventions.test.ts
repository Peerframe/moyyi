import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { contributorViolations } from "./contributor-conventions.ts";

const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function fixture(files: Record<string, string>, alias = true) {
  const root = mkdtempSync(join(tmpdir(), "moyyi-conventions-"));
  temporary.push(root);
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  if (alias) {
    mkdirSync(join(root, ".claude"), { recursive: true });
    symlinkSync("../.agents/skills", join(root, ".claude/skills"));
  }
  return contributorViolations(root, Object.keys(files));
}
const skill = "---\nname: example\ndescription: A bounded workflow.\n---\n";

describe("contributor conventions", () => {
  it("checks the current repository, including untracked source but excluding ignored output", () => {
    const root = resolve(import.meta.dirname, "..");
    const files = execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: root, encoding: "utf8" },
    )
      .split("\0")
      .filter(Boolean);
    expect(contributorViolations(root, [...new Set(files)])).toEqual([]);
  });
  it("allows an empty pre-delivery-zero repository and complete documented modules", () => {
    expect(fixture({}, false)).toEqual([]);
    expect(
      fixture({
        ".agents/skills/example/SKILL.md": skill,
        "apps/desktop/features/example/README.md": "Scope and limits.",
      }),
    ).toEqual([]);
  });
  it("rejects missing or mismatched skill metadata and a copied alias directory", () => {
    const failures = fixture(
      {
        ".agents/skills/example/SKILL.md": "---\nname: other\ndescription: ''\n---\n",
        ".agents/skills/missing/SKILL.md": "# No frontmatter",
        ".claude/skills/README.md": "A copied directory is not the canonical skills link.",
      },
      false,
    );
    expect(failures).toEqual(
      expect.arrayContaining([
        expect.stringContaining("name must match"),
        expect.stringContaining("description must be"),
        expect.stringContaining("missing name and description"),
        expect.stringContaining("must link to"),
      ]),
    );
  });
  it("checks nested instructions, encoded links, reference links and feature documentation", () => {
    const failures = fixture(
      {
        "docs/AGENTS.md":
          "[valid](../target%20file.md#section) [missing](lost.md)\n[reference]: missing.md\n[remote](https://example.com/no-file) [anchor](#there)\n```md\n[example](not-a-real-file)\n```\n`[inline](not-a-file)`",
        "target file.md": "# section",
        "apps/desktop/features/example/host.ts": "export {};",
      },
      false,
    );
    expect(failures).toEqual([
      "docs/AGENTS.md: broken repository link lost.md",
      "docs/AGENTS.md: broken repository link missing.md",
      "apps/desktop/features/example: missing README.md",
    ]);
  });
});
