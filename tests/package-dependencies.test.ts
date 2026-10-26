import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { assertInstalledDependencyGraph } from "../scripts/package-dependencies.ts";

const roots: string[] = [];
type Lock = Parameters<typeof assertInstalledDependencyGraph>[1];
afterEach(() => {
  vi.unstubAllGlobals();
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
  const packages: Lock["packages"] = {
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

function canvasFixture(libc: "glibc" | "musl") {
  // Simulate both Linux families on every test host; the real native install remains a CI gate.
  vi.stubGlobal("process", {
    ...process,
    platform: "linux",
    arch: "x64",
    report: {
      ...process.report,
      getReport: () => ({ header: libc === "glibc" ? { glibcVersionRuntime: "2.35" } : {} }),
    },
  });
  const source: Lock = JSON.parse(
    readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
  );
  const state = fixture();
  state.lock.packages[""] = {
    ...state.lock.packages[""],
    dependencies: { parser: "1.0.0", codec: "2.0.0", "@napi-rs/canvas": "1.0.9" },
  };
  state.put("", state.lock.packages[""]);
  for (const [path, entry] of Object.entries(source.packages)) {
    if (path.startsWith("node_modules/@napi-rs/canvas"))
      state.lock.packages[path] = structuredClone(entry);
  }
  const canvas = "node_modules/@napi-rs/canvas";
  const native = `${canvas}-linux-x64-${libc === "glibc" ? "gnu" : "musl"}`;
  const other = `${canvas}-linux-x64-${libc === "glibc" ? "musl" : "gnu"}`;
  for (const path of [canvas, native])
    state.put(path, { name: path.slice("node_modules/".length), ...state.lock.packages[path] });
  return { ...state, native, other };
}

it("retains the exact upstream libc constraints in the canonical native-package entries", () => {
  const source: Lock = JSON.parse(
    readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"),
  );
  // Reviewed v1.0.9 npm/*/package.json and registry metadata; arm-gnueabihf has no libc field.
  // https://github.com/Brooooooklyn/canvas/tree/v1.0.9/npm
  for (const [suffix, libc] of [
    ["arm64-gnu", "glibc"],
    ["arm64-musl", "musl"],
    ["riscv64-gnu", "glibc"],
    ["x64-gnu", "glibc"],
    ["x64-musl", "musl"],
  ])
    expect(source.packages[`node_modules/@napi-rs/canvas-linux-${suffix}`]?.libc).toEqual([libc]);
  expect(source.packages["node_modules/@napi-rs/canvas-linux-arm-gnueabihf"]?.libc).toBeUndefined();
});

it.each(["glibc", "musl"] as const)(
  "requires only the canonical native edge applicable to Linux x64 %s",
  (libc) => {
    const { root, lock, native, other } = canvasFixture(libc);
    const graph = assertInstalledDependencyGraph(root, lock);
    expect(graph).toMatchObject({ sameInstalledGraph: true, packageCount: 4, edgeCount: 5 });
    expect(graph.edges).toContain(
      `node_modules/@napi-rs/canvas -> ${native.slice("node_modules/".length)}@1.0.9 (1.0.9)`,
    );
    expect(graph.edges.join("\n")).not.toContain(other.slice("node_modules/".length));
  },
);

it.each(["glibc", "musl"] as const)(
  "still rejects a missing applicable native package on Linux x64 %s",
  (libc) => {
    const { root, lock, native } = canvasFixture(libc);
    rmSync(join(root, native), { recursive: true });
    expect(() => assertInstalledDependencyGraph(root, lock)).toThrow(
      `Required installed dependency missing: node_modules/@napi-rs/canvas -> ${native.slice("node_modules/".length)}`,
    );
  },
);

it("still rejects native version drift and missing libc metadata", () => {
  const { root, lock, native, other, put } = canvasFixture("glibc");
  put(native, { ...lock.packages[native], version: "1.0.10" });
  expect(() => assertInstalledDependencyGraph(root, lock)).toThrow("Installed edge differs");
  put(native, { name: native.slice("node_modules/".length), ...lock.packages[native] });
  const otherEntry = lock.packages[other];
  if (!otherEntry) throw Error("Fixture missing alternate native package");
  delete otherEntry.libc;
  expect(() => assertInstalledDependencyGraph(root, lock)).toThrow(
    `Required installed dependency missing: node_modules/@napi-rs/canvas -> ${other.slice("node_modules/".length)}`,
  );
});
