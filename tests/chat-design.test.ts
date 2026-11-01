import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type DesignTokens, tokensCss } from "../apps/chat/design/tokens.ts";
import { repo } from "./boundaries.ts";

const read = (path: string) => readFileSync(join(repo, path), "utf8");
const tokens = JSON.parse(read("apps/chat/design/tokens.json")) as DesignTokens;
const css = tokensCss(tokens);

function defined(theme: "dark" | "light"): Set<string> {
  const blocks = [...css.matchAll(/^([^{}\n]+)\{([^}]*)\}/gm)].filter(([, selector]) =>
    selector?.split(",").includes(`.mc-${theme}`),
  );
  return new Set(
    blocks.flatMap(([, , body]) =>
      [...(body ?? "").matchAll(/--([\w-]+):/g)].map((m) => m[1] ?? ""),
    ),
  );
}

describe("moyyi Chat design tokens", () => {
  it("defines every variable the design system and the page use, in both themes", () => {
    const used = new Set(
      [read("apps/chat/design/bundle.css"), read("apps/chat/app.css")].flatMap((source) =>
        [...source.matchAll(/var\(--([\w-]+)/g)].map((m) => m[1] ?? ""),
      ),
    );
    for (const theme of ["dark", "light"] as const) {
      const missing = [...used].filter((name) => !defined(theme).has(name));
      expect(missing, theme).toEqual([]);
    }
  });

  it("keeps colours and sizes out of the page stylesheet except the design system's own", () => {
    const page = read("apps/chat/app.css");
    expect(page.match(/#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
  });

  it("generates one block per theme with dark first", () => {
    expect(css.startsWith("/* moyyi Chat — generated from design/tokens.json */")).toBe(true);
    expect(css.indexOf("\n.mc-dark{")).toBeLessThan(css.indexOf("\n.mc-light{"));
  });
});
