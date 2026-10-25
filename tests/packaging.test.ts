import { describe, expect, it } from "vitest";
import { assertPackageFiles, expectedPackageFiles } from "../scripts/packaging.ts";

describe("candidate package inventory", () => {
  const expected = expectedPackageFiles();
  it("requires CLI, public entries, declarations and installed guides", () => {
    expect(expected).toContain("dist/cli/main.js");
    expect(expected).toContain("dist/runtime/index.d.ts");
    expect(expected).toContain("dist/contracts/index.js");
    expect(expected).toContain("docs/installation.md");
    expect(expected.some((path) => /test|fixture/.test(path))).toBe(false);
    expect(() => assertPackageFiles([...expected].reverse(), expected)).not.toThrow();
  });
  it.each([
    ".env",
    "evals/private/task.ts",
    "dist/old-provider.js",
    "dist/cli/main.test.js",
    "src/core/index.ts",
    "notes.txt",
  ])("rejects accidentally included %s", (path) => {
    expect(() => assertPackageFiles([...expected, path], expected)).toThrow();
  });
  it("rejects missing entry points and duplicate or traversal paths", () => {
    expect(() =>
      assertPackageFiles(
        expected.filter((path) => path !== "dist/cli/main.js"),
        expected,
      ),
    ).toThrow();
    expect(() => assertPackageFiles([...expected, expected[0] as string], expected)).toThrow();
    expect(() => assertPackageFiles(["../secret"], ["../secret"])).toThrow("Invalid package path");
  });
});
