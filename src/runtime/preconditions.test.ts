import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Precondition, RunId, ToolContext } from "../contracts/index.ts";
import { WorkspacePreconditions } from "./preconditions.ts";

let directory: string;
let workspace: string;
let outside: string;
let context: ToolContext;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const check = (conditions: readonly Precondition[]) =>
  new WorkspacePreconditions().check(conditions, context);
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "moyyi-preconditions-"));
  workspace = join(directory, "workspace");
  outside = join(directory, "outside");
  mkdirSync(workspace);
  mkdirSync(outside);
  context = {
    workspaceRoot: workspace,
    runId: "run_test" as RunId,
    signal: new AbortController().signal,
    limits: { maxOutputBytes: 4096 },
  };
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

describe("WorkspacePreconditions", () => {
  it("checks the actual file hash again and rejects overwrite after preparation", async () => {
    writeFileSync(join(workspace, "file.txt"), "before");
    const conditions: readonly Precondition[] = [
      { kind: "file_hash", path: "file.txt", sha256: hash("before") },
    ];
    expect(await check(conditions)).toEqual({ valid: true });
    writeFileSync(join(workspace, "file.txt"), "after");
    expect(await check(conditions)).toMatchObject({ valid: false, reason: "File content changed" });
  });
  it("allows a missing target only inside an authorized resolved parent", async () => {
    expect(await check([{ kind: "file_hash", path: "new/child.txt", sha256: null }])).toEqual({
      valid: true,
    });
    writeFileSync(join(workspace, "exists"), "data");
    expect((await check([{ kind: "file_hash", path: "exists", sha256: null }])).valid).toBe(false);
    expect((await check([{ kind: "file_hash", path: "../outside/new", sha256: null }])).valid).toBe(
      false,
    );
  });
  it("rejects symlink escape for existing and missing targets", async () => {
    writeFileSync(join(outside, "secret.txt"), "outside");
    symlinkSync(outside, join(workspace, "escape"));
    for (const leaf of ["secret.txt", "missing.txt"]) {
      expect(
        (
          await check([
            {
              kind: "file_hash",
              path: `escape/${leaf}`,
              sha256: leaf === "secret.txt" ? hash("outside") : null,
            },
          ])
        ).valid,
      ).toBe(false);
    }
  });
  it("allows an in-workspace alias but detects a redirected alias on the next check", async () => {
    writeFileSync(join(workspace, "target.txt"), "inside");
    const alias = join(workspace, "alias.txt");
    symlinkSync("target.txt", alias);
    const conditions: readonly Precondition[] = [
      { kind: "file_hash", path: alias, sha256: hash("inside") },
    ];
    expect((await check(conditions)).valid).toBe(true);
    writeFileSync(join(outside, "target.txt"), "inside");
    rmSync(alias);
    symlinkSync(join(outside, "target.txt"), alias);
    expect((await check(conditions)).valid).toBe(false);
  });
  it("keeps tool-selected roots narrower than the runtime workspace", async () => {
    mkdirSync(join(workspace, "sub"));
    expect(
      (await check([{ kind: "path_resolves_within", root: "sub", path: "sub/new" }])).valid,
    ).toBe(true);
    expect(
      (await check([{ kind: "path_resolves_within", root: directory, path: "new" }])).valid,
    ).toBe(false);
    expect(
      (await check([{ kind: "path_resolves_within", root: "sub", path: "sibling" }])).valid,
    ).toBe(false);
    expect(
      (
        await check([
          { kind: "path_resolves_within", root: workspace, path: `${workspace}-other/file` },
        ])
      ).valid,
    ).toBe(false);
  });
  it.each([
    ".env",
    ".env.local",
    ".ssh/id_ed25519",
    ".aws/credentials",
    "private.pem",
    "token.key",
  ])("denies protected path %s even when absent", async (path) => {
    expect((await check([{ kind: "file_hash", path, sha256: null }])).valid).toBe(false);
  });
  it("checks protected resolved paths behind ordinary-looking aliases", async () => {
    writeFileSync(join(workspace, ".env"), "secret");
    symlinkSync(".env", join(workspace, "ordinary"));
    expect(
      (await check([{ kind: "file_hash", path: "ordinary", sha256: hash("secret") }])).valid,
    ).toBe(false);
  });
  it("rejects malformed hashes, directories, dangling links and unknown condition kinds", async () => {
    symlinkSync("missing", join(workspace, "dangling"));
    for (const condition of [
      { kind: "file_hash", path: ".", sha256: hash("") },
      { kind: "file_hash", path: "dangling", sha256: null },
      { kind: "file_hash", path: "missing", sha256: "not-a-hash" },
      { kind: "future", path: "missing" },
    ] as readonly Precondition[])
      expect((await check([condition])).valid).toBe(false);
  });
  it("fails closed when cancelled or when the trusted workspace is a symlink", async () => {
    const controller = new AbortController();
    controller.abort();
    context = { ...context, signal: controller.signal };
    expect((await check([])).valid).toBe(false);
    symlinkSync(workspace, join(directory, "workspace-link"));
    context = {
      ...context,
      signal: new AbortController().signal,
      workspaceRoot: join(directory, "workspace-link"),
    };
    expect((await check([])).valid).toBe(false);
  });
});
