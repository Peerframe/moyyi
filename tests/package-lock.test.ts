import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanPackageLock, generatePackageLock } from "../scripts/package-lock.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "moyyi-package-lock-test-"));
  directories.push(root);
  const pkg = {
    name: "moyyi",
    version: "0.0.0",
    dependencies: { officeparser: "7.8.0", "pdfjs-dist": "6.3.289" },
    overrides: { "pdfjs-dist": "6.3.289" },
  };
  const lock = {
    name: pkg.name,
    version: pkg.version,
    lockfileVersion: 3,
    packages: {
      "": { dependencies: pkg.dependencies },
      "node_modules/officeparser": { version: "7.8.0" },
      "node_modules/pdfjs-dist": { version: "6.3.289" },
    } as Record<string, unknown>,
  };
  writeFileSync(join(root, "package.json"), JSON.stringify(pkg));
  const save = () => writeFileSync(join(root, "package-lock.json"), `${JSON.stringify(lock)}\n`);
  save();
  return { root, lock, save };
}
describe("generated shipped dependency lock", () => {
  it("ships exact canonical bytes and cleans them without changing the source lock", () => {
    const { root } = fixture();
    const original = readFileSync(join(root, "package-lock.json"));
    generatePackageLock(root);
    generatePackageLock(root);
    expect(readFileSync(join(root, "npm-shrinkwrap.json"))).toEqual(original);
    cleanPackageLock(root);
    cleanPackageLock(root);
    expect(existsSync(join(root, "npm-shrinkwrap.json"))).toBe(false);
    expect(readFileSync(join(root, "package-lock.json"))).toEqual(original);
  });
  it("does not overwrite or clean a different shrinkwrap", () => {
    const { root } = fixture();
    const path = join(root, "npm-shrinkwrap.json");
    writeFileSync(path, "USER CONTENT");
    expect(() => generatePackageLock(root)).toThrow("different shrinkwrap");
    expect(() => cleanPackageLock(root)).toThrow("preserving it");
    expect(readFileSync(path, "utf8")).toBe("USER CONTENT");
  });
  it("preserves libc platform constraints in the generated shipped lock", () => {
    const { root, lock, save } = fixture();
    lock.packages["node_modules/@napi-rs/canvas-linux-x64-musl"] = {
      version: "1.0.9",
      optional: true,
      os: ["linux"],
      cpu: ["x64"],
      libc: ["musl"],
    };
    save();
    generatePackageLock(root);
    const generated = JSON.parse(readFileSync(join(root, "npm-shrinkwrap.json"), "utf8"));
    expect(generated.packages["node_modules/@napi-rs/canvas-linux-x64-musl"].libc).toEqual([
      "musl",
    ]);
    expect(readFileSync(join(root, "npm-shrinkwrap.json"))).toEqual(
      readFileSync(join(root, "package-lock.json")),
    );
  });
  it("refuses the vulnerable nested PDF version and accidental OCR language packs", () => {
    const { root, lock, save } = fixture();
    lock.packages["node_modules/officeparser/node_modules/pdfjs-dist"] = { version: "6.1.200" };
    save();
    expect(() => generatePackageLock(root)).toThrow("Unreviewed nested PDF.js");
    delete lock.packages["node_modules/officeparser/node_modules/pdfjs-dist"];
    lock.packages["node_modules/@tesseract.js-data/eng"] = { version: "1.0.0" };
    save();
    expect(() => generatePackageLock(root)).toThrow("OCR language packs");
    expect(existsSync(join(root, "npm-shrinkwrap.json"))).toBe(false);
  });
  it("fails closed when package metadata and canonical dependencies disagree", () => {
    const { root, lock, save } = fixture();
    lock.packages[""] = { dependencies: {} };
    save();
    expect(() => generatePackageLock(root)).toThrow("Dependency lock is stale");
  });
  it("refuses an unpinned runtime transitive instead of trusting local tarball shrinkwrap", () => {
    const { root, lock, save } = fixture();
    lock.packages["node_modules/unpinned-codec"] = { version: "1.0.0" };
    save();
    expect(() => generatePackageLock(root)).toThrow("Runtime dependency must be pinned directly");
    expect(existsSync(join(root, "npm-shrinkwrap.json"))).toBe(false);
  });
});
