import { createHash } from "node:crypto";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectMaterials, snapshotExternalMaterial } from "./materials.ts";

const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});
function workspace() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-materials-")));
  temporary.push(root);
  const selected = join(root, "selected");
  mkdirSync(selected);
  return { root, selected };
}
describe("desktop material identity", () => {
  it("hashes complete file bytes for all seven formats without extracting or altering them", () => {
    const { selected } = workspace();
    const bytes = Buffer.alloc(130_000, 0xa5);
    const paths = ["pdf", "docx", "xlsx", "pptx", "odt", "ods", "odp"].map((format) => {
      const path = join(selected, `source.${format}`);
      writeFileSync(path, bytes);
      return path;
    });
    const materials = inspectMaterials(selected, paths, []);
    expect(materials).toHaveLength(7);
    for (const material of materials)
      expect(material).toMatchObject({
        sourceBytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    expect(
      materials.every(
        (material) => Object.keys(material).sort().join() === "format,path,sha256,sourceBytes",
      ),
    ).toBe(true);
    expect(inspectMaterials(selected, [paths[0] as string, paths[0] as string], [])).toHaveLength(
      1,
    );
  });
  it("refuses unsupported, outside, linked, protected, missing and oversized selections", () => {
    const { root, selected } = workspace();
    writeFileSync(join(root, "outside.pdf"), "PRIVATE");
    writeFileSync(join(selected, "ok.pdf"), "SAFE");
    writeFileSync(join(selected, "bad.exe"), "TEXT");
    writeFileSync(join(selected, "large.pdf"), Buffer.alloc(10 * 1024 * 1024 + 1));
    symlinkSync(join(root, "outside.pdf"), join(selected, "link.pdf"));
    symlinkSync(root, join(selected, "linked"));
    linkSync(join(selected, "ok.pdf"), join(selected, "hard.pdf"));
    mkdirSync(join(selected, ".moyyi"));
    writeFileSync(join(selected, ".moyyi/private.pdf"), "PRIVATE");
    mkdirSync(join(selected, "private"));
    writeFileSync(join(selected, "private/key.pdf"), "PRIVATE");
    for (const path of [
      "bad.exe",
      "../outside.pdf",
      "link.pdf",
      "linked/outside.pdf",
      "hard.pdf",
      ".moyyi/private.pdf",
      "private/key.pdf",
      "missing.pdf",
      "large.pdf",
    ])
      expect(() => inspectMaterials(selected, [path], [join(selected, "private")])).toThrow();
    expect(() => inspectMaterials(selected, Array(9).fill("missing.pdf"), [])).toThrow("eight");
  });
  it("rejects an external file replaced during its bounded read and honors source cancellation", () => {
    const { selected } = workspace();
    const source = join(selected, "source.txt");
    writeFileSync(source, "original");
    let checks = 0;
    expect(() =>
      snapshotExternalMaterial(source, [], () => {
        if (++checks === 2) {
          renameSync(source, join(selected, "previous.txt"));
          writeFileSync(source, "replacement");
        }
      }),
    ).toThrow("changed");
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      snapshotExternalMaterial(source, [], () => controller.signal.throwIfAborted()),
    ).toThrow();
  });
  it("accepts exactly ten MiB and checks exclusions after resolving an external parent alias", () => {
    const { root, selected } = workspace();
    const source = join(selected, "limit.pdf");
    writeFileSync(source, Buffer.alloc(10 * 1024 * 1024, 0xa5));
    expect(snapshotExternalMaterial(source, []).sourceBytes).toBe(10 * 1024 * 1024);
    symlinkSync(selected, join(root, "alias"));
    expect(() => snapshotExternalMaterial(join(root, "alias", "limit.pdf"), [selected])).toThrow(
      "Protected",
    );
  });
});
