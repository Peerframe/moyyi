import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { assertInstalledDependencyGraph } from "../scripts/package-dependencies.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "moyyi-install-graph-"));
  roots.push(root);
  const put = (path: string, data: object) => {
    const directory = join(root, path);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "package.json"), JSON.stringify(data));
  };
  const packages = {
    "": { name: "moyyi", version: "0.0.0", dependencies: { parser: "1.0.0", codec: "2.0.0" } },
    "node_modules/parser": { name: "parser", version: "1.0.0", dependencies: { codec: "^2.0.0" } },
    "node_modules/codec": { name: "codec", version: "2.0.0" },
  };
  for (const [path, value] of Object.entries(packages)) put(path, value);
  return { root, lock: { packages }, put };
}
it("checks every actual resolved dependency against the canonical versions and declarations", () => {
  const { root, lock } = fixture();
  expect(assertInstalledDependencyGraph(root, lock)).toMatchObject({
    sameInstalledGraph: true,
    packageCount: 2,
    edgeCount: 3,
    localNpmEnforcesShrinkwrap: false,
  });
});
it("refuses a nested resolution drift hidden by the correct root version", () => {
  const { root, lock, put } = fixture();
  put("node_modules/parser/node_modules/codec", { name: "codec", version: "2.1.0" });
  expect(() => assertInstalledDependencyGraph(root, lock)).toThrow("Installed edge differs");
});
it("refuses changed dependency ranges even when the installed version still matches", () => {
  const { root, lock, put } = fixture();
  put("node_modules/parser", { name: "parser", version: "1.0.0", dependencies: { codec: ">=2" } });
  expect(() => assertInstalledDependencyGraph(root, lock)).toThrow(
    "Dependency declarations changed",
  );
});
