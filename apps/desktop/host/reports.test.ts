import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectReport, reportTarget } from "./reports.ts";

const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});
function workspace() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-report-")));
  temporary.push(root);
  const selected = join(root, "selected");
  mkdirSync(selected);
  return { root, selected };
}
describe("desktop report targets and current file previews", () => {
  it("allows only new supported targets with existing real parents", () => {
    const { selected } = workspace();
    for (const extension of ["json", "md", "txt", "csv"])
      expect(reportTarget(selected, join(selected, `report.${extension}`), [])).toBe(
        `report.${extension}`,
      );
    writeFileSync(join(selected, "exists.json"), "{}");
    for (const path of [
      "exists.json",
      "missing/report.json",
      "../report.json",
      "report.html",
      "script.sh",
      ".env/report.json",
    ])
      expect(() => reportTarget(selected, path, [])).toThrow();
  });
  it("opens only the hash-matched current file as bounded plain text and distinguishes change/deletion", () => {
    const { root, selected } = workspace();
    const text = `${"a".repeat(65_535)}😀<script>not executed</script>`;
    writeFileSync(join(selected, "report.md"), text);
    const artifact = {
      effectId: "effect",
      path: "report.md",
      afterHash: createHash("sha256").update(text).digest("hex"),
      state: "unchecked" as const,
    };
    expect(inspectReport(selected, artifact, [])).toMatchObject({
      state: "current",
      preview: { text: "a".repeat(65_535), truncated: true, sourceBytes: Buffer.byteLength(text) },
    });
    writeFileSync(join(selected, "report.md"), "changed");
    expect(inspectReport(selected, artifact, [])).toEqual({ state: "changed" });
    unlinkSync(join(selected, "report.md"));
    expect(inspectReport(selected, artifact, [])).toEqual({ state: "missing" });
    writeFileSync(join(root, "outside"), text);
    symlinkSync(join(root, "outside"), join(selected, "report.md"));
    expect(inspectReport(selected, artifact, [])).toEqual({ state: "unavailable" });
    expect(inspectReport(selected, { ...artifact, path: "../outside" }, [])).toEqual({
      state: "unavailable",
    });
  });
});
