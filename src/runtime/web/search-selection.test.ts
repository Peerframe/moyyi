import { describe, expect, it } from "vitest";
import { searchSelection } from "./search-selection.ts";

describe("bounded search selection", () => {
  it("ORs workspace-relative includes, gives exclusions priority, and preserves Node dot semantics", () => {
    const select = searchSelection(["src/**/*.ts", "docs/?.md"], ["**/*.test.ts"]);
    expect(select("src/index.ts")).toBe(true);
    expect(select("src/nested/index.ts")).toBe(true);
    expect(select("docs/a.md")).toBe(true);
    expect(select("docs/long.md")).toBe(false);
    expect(select("src/index.test.ts")).toBe(false);
    expect(select("other/index.ts")).toBe(false);
    expect(select("src/.hidden.ts")).toBe(false);
    expect(searchSelection(["src/.*.ts"])("src/.hidden.ts")).toBe(true);
    expect(searchSelection()(".hidden")).toBe(true);
  });

  it("snapshots valid selectors so later caller mutations cannot broaden selection", () => {
    const include = ["src/*.ts"];
    const exclude = ["src/private.ts"];
    const select = searchSelection(include, exclude);
    include[0] = "**";
    exclude[0] = "absent";
    expect(select("src/private.ts")).toBe(false);
    expect(select("other/index.ts")).toBe(false);
  });

  it.each([
    [],
    Array.from({ length: 9 }, () => "*.ts"),
    [""],
    ["x".repeat(129)],
    ["/outside/*.ts"],
    ["C:/outside/*.ts"],
    ["../*.ts"],
    ["src/../*.ts"],
    ["src\\*.ts"],
    ["src/\n*.ts"],
    ["src/[ab].ts"],
    ["src/{a,b}.ts"],
    ["src/!(test).ts"],
    ["!src/*.ts"],
    ["src/a**b.ts"],
    ["***/*.ts"],
    [null],
    "src/*.ts",
    null,
  ])("rejects unsupported selectors %j", (patterns) => {
    expect(() => searchSelection(patterns as never)).toThrow(/Search filters/);
    expect(() => searchSelection(undefined, patterns as never)).toThrow(/Search filters/);
  });
});
