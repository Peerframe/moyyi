import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  officeRuntimeFiles,
  officeSourceRoot,
  vendorOfficeParser,
} from "../scripts/vendor-documents.ts";

const directories: string[] = [];
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
});
describe("reviewed Office distribution packaging", () => {
  it("preserves every copied Node file and license, changing only the PDF dependency metadata", () => {
    const directory = mkdtempSync(join(tmpdir(), "moyyi-office-vendor-"));
    directories.push(directory);
    for (const file of ["package.json", "package-lock.json"])
      writeFileSync(join(directory, file), readFileSync(resolve(file)));
    symlinkSync(resolve("node_modules"), join(directory, "node_modules"), "dir");
    vendorOfficeParser(directory);
    const upstream = officeSourceRoot(directory);
    const shipped = join(directory, "dist/vendor/officeparser");
    const original = JSON.parse(readFileSync(join(upstream, "package.json"), "utf8"));
    const generated = JSON.parse(readFileSync(join(shipped, "package.json"), "utf8"));
    expect(generated).toEqual({
      ...original,
      dependencies: { ...original.dependencies, "pdfjs-dist": "6.3.289" },
    });
    expect(readFileSync(join(shipped, "UPSTREAM_PACKAGE.json"))).toEqual(
      readFileSync(join(upstream, "package.json")),
    );
    const source = JSON.parse(readFileSync(join(shipped, "SOURCE.json"), "utf8"));
    const files = officeRuntimeFiles(directory);
    expect(Object.keys(source.copiedFiles).sort()).toEqual(files);
    expect(files).toContain("dist/index.js");
    expect(files).toContain("LICENSE");
    expect(files.some((path) => path.includes("browser") || path.includes("sbom"))).toBe(false);
    for (const path of files) {
      const bytes = readFileSync(join(shipped, path));
      // Native byte equality avoids a deep assertion walking every numeric Buffer property.
      expect(bytes.equals(readFileSync(join(upstream, path))), path).toBe(true);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(source.copiedFiles[path]);
    }
    expect(
      createHash("sha256")
        .update(readFileSync(join(shipped, "package.json")))
        .digest("hex"),
    ).toBe(source.generatedPackageSha256);
    expect(source.integrity).toBe(
      JSON.parse(readFileSync("package-lock.json", "utf8")).packages["node_modules/officeparser"]
        .integrity,
    );
  });
});
