import { createHash } from "node:crypto";
import {
  linkSync,
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
import { afterEach, expect, it } from "vitest";
import type { DesktopEffect } from "../shared.ts";
import { inspectEffectFile } from "./effects.ts";

const temporary: string[] = [];
afterEach(() => {
  for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true });
});
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-effect-inspect-")));
  temporary.push(root);
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  const effect: DesktopEffect = {
    effectId: "effect",
    runId: "run",
    tool: "edit",
    state: "succeeded",
    updatedAt: "now",
    receipt: {
      kind: "file",
      path: "file.txt",
      snapshotId: "effect",
      beforeHash: digest("before"),
      afterHash: digest("after"),
    },
  };
  return { root, workspace, effect };
}
it("distinguishes matching bytes, external changes, missing files and expected absence", () => {
  const { workspace, effect } = fixture();
  const path = join(workspace, "file.txt");
  writeFileSync(path, "after");
  expect(inspectEffectFile(workspace, effect, [])).toMatchObject({
    state: "current",
    actualHash: digest("after"),
  });
  writeFileSync(path, "external");
  expect(inspectEffectFile(workspace, effect, [])).toMatchObject({
    state: "changed",
    actualHash: digest("external"),
  });
  unlinkSync(path);
  expect(inspectEffectFile(workspace, effect, [])).toMatchObject({
    state: "missing",
    actualHash: null,
  });
  const absent: DesktopEffect = {
    ...effect,
    tool: "undo",
    receipt: {
      kind: "file",
      path: "file.txt",
      snapshotId: "effect",
      beforeHash: digest("after"),
      afterHash: null,
    },
  };
  expect(inspectEffectFile(workspace, absent, [])).toMatchObject({
    state: "absent",
    expectedHash: null,
  });
  writeFileSync(path, "new");
  expect(inspectEffectFile(workspace, absent, [])).toMatchObject({
    state: "changed",
    actualHash: digest("new"),
  });
});
it("refuses forged/non-success receipts and protects outside, linked, private and oversized files", () => {
  const { root, workspace, effect } = fixture();
  expect(() => inspectEffectFile(workspace, { ...effect, state: "unknown" }, [])).toThrow();
  expect(() => inspectEffectFile(workspace, { ...effect, receipt: null }, [])).toThrow();
  const inspect = (path: string, excluded: string[] = []) =>
    inspectEffectFile(
      workspace,
      {
        ...effect,
        receipt: {
          kind: "file",
          path,
          snapshotId: "effect",
          beforeHash: null,
          afterHash: digest("after"),
        },
      },
      excluded,
    ).state;
  writeFileSync(join(root, "outside"), "after");
  symlinkSync(join(root, "outside"), join(workspace, "link"));
  linkSync(join(root, "outside"), join(workspace, "hard"));
  writeFileSync(join(workspace, ".env"), "after");
  writeFileSync(join(workspace, "huge"), Buffer.alloc(1_048_577));
  writeFileSync(join(workspace, "private"), "after");
  for (const path of ["../outside", "link", "hard", ".env", "huge"])
    expect(inspect(path)).toBe("unavailable");
  expect(inspect("private", [join(workspace, "private")])).toBe("unavailable");
});
