import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { RunId } from "../contracts/index.ts";
import { NodeWorkspaceFiles } from "./files.ts";

const roots: string[] = [];
const missingMessage =
  "Requested workspace path does not exist; use list or search to locate the file";
afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-read-diagnostic-")));
  roots.push(root);
  const workspace = join(root, "workspace"),
    outside = join(root, "outside");
  mkdirSync(workspace);
  mkdirSync(outside);
  const controller = new AbortController();
  let allowed = true;
  const guard = () => {
    if (!allowed) throw Error("revoked");
  };
  const context = {
    runId: "run_diagnostic" as RunId,
    workspaceRoot: workspace,
    signal: controller.signal,
    limits: { maxOutputBytes: 32768 },
  };
  const factory = new NodeWorkspaceFiles([join(workspace, "private-store")]);
  return {
    root,
    workspace,
    outside,
    controller,
    guard,
    context,
    factory,
    files: factory.create(context, guard),
    revoke: () => {
      allowed = false;
    },
  };
}
async function failure(pending: Promise<unknown>): Promise<Error & { code?: string }> {
  const error = await pending.then(
    () => null,
    (error: unknown) => error,
  );
  expect(error).toBeInstanceOf(Error);
  return error as Error & { code?: string };
}
function expectOpaque(error: Error & { code?: string }, root: string) {
  expect(error.code).not.toBe("not_found");
  expect(error.message).not.toContain(root);
  expect(error.message).not.toContain("SECRET_CANARY");
  expect(error.message).not.toContain(missingMessage);
}

it.each([{}, { startLine: 2, maxLines: 3 }])(
  "diagnoses only absent authorized paths, including a missing ancestor and range reads %j",
  async (options) => {
    const t = fixture();
    mkdirSync(join(t.workspace, "src"));
    writeFileSync(join(t.workspace, "src", "real.txt"), "actual text\n");
    for (const path of ["missing.txt", "src/missing.txt", "new/nested/missing.txt"])
      await expect(t.files.read(path, options)).rejects.toMatchObject({
        code: "not_found",
        message: missingMessage,
      });
    expect((await t.files.read("src/real.txt")).text).toBe("actual text\n");
  },
);

it("allows missing-path diagnosis under an unchanged internal directory alias", async () => {
  const t = fixture();
  mkdirSync(join(t.workspace, "actual"));
  symlinkSync("actual", join(t.workspace, "alias"));
  await expect(t.files.read("alias/missing.txt")).rejects.toMatchObject({
    code: "not_found",
    message: missingMessage,
  });
});

it.each([32, 33])(
  "bounds absence diagnostics at 32 path segments without limiting existing reads (%i)",
  async (depth) => {
    const t = fixture();
    const parents = Array.from({ length: depth - 1 }, (_, index) => `d${index}`);
    const directory = join(t.workspace, ...parents);
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, "present.txt"), "deep file");
    const stat = vi.spyOn(fs, "lstat");
    syncBuiltinESMExports();
    const error = await failure(t.files.read([...parents, "missing.txt"].join("/")));
    if (depth === 32) expect(error).toMatchObject({ code: "not_found", message: missingMessage });
    else {
      expect(error.code).toBe("unavailable");
      expectOpaque(error, t.root);
      expect(stat.mock.calls.map(([path]) => path)).toEqual([t.workspace]);
    }
    expect((await t.files.read([...parents, "present.txt"].join("/"))).text).toBe("deep file");
  },
);

it.each(["outside", "private", "credentials"])(
  "does not disclose existence below a %s alias or probe its descendant",
  async (kind) => {
    const t = fixture();
    const destination =
      kind === "outside"
        ? t.outside
        : join(t.workspace, kind === "private" ? "private-store" : ".ssh");
    mkdirSync(destination, { recursive: true });
    writeFileSync(join(destination, "existing.txt"), "SECRET_CANARY");
    symlinkSync(destination, join(t.workspace, "alias"));
    const stat = vi.spyOn(fs, "lstat");
    syncBuiltinESMExports();
    const existing = await failure(t.files.read("alias/existing.txt"));
    const absent = await failure(t.files.read("alias/missing.txt"));
    expectOpaque(existing, t.root);
    expectOpaque(absent, t.root);
    expect(absent.message).toBe(existing.message);
    expect(stat.mock.calls.map(([path]) => path)).not.toContain(join(destination, "missing.txt"));
    expect(stat.mock.calls.map(([path]) => path)).not.toContain(
      join(t.workspace, "alias", "missing.txt"),
    );
  },
);

it.each([".env", ".git/config", ".moyyi/data", "private-store/data", ".ssh/key"])(
  "rejects protected path %s before checking whether the leaf exists",
  async (path) => {
    const t = fixture();
    const stat = vi.spyOn(fs, "lstat"),
      real = vi.spyOn(fs, "realpath");
    syncBuiltinESMExports();
    const error = await failure(t.files.read(path));
    expect(error.code).toBe("denied");
    expectOpaque(error, t.root);
    expect(stat.mock.calls.map(([value]) => value)).not.toContain(join(t.workspace, path));
    expect(real.mock.calls.map(([value]) => value)).not.toContain(join(t.workspace, path));
  },
);

it("protects a missing configured root reached through an internal alias", async () => {
  const t = fixture(),
    actual = join(t.workspace, "actual"),
    protectedRoot = join(actual, "future-private");
  mkdirSync(actual);
  symlinkSync("actual", join(t.workspace, "alias"));
  const files = new NodeWorkspaceFiles([protectedRoot]).create(t.context, t.guard);
  const stat = vi.spyOn(fs, "lstat");
  syncBuiltinESMExports();
  const error = await failure(files.read("alias/future-private/missing.txt"));
  expect(error.code).toBe("denied");
  expectOpaque(error, t.root);
  expect(stat.mock.calls.map(([path]) => path)).not.toContain(protectedRoot);
});

it.each(["dangling", "dangling/child.txt"])(
  "does not call a dangling symlink a missing file: %s",
  async (path) => {
    const t = fixture();
    symlinkSync(join(t.outside, "absent"), join(t.workspace, "dangling"));
    expectOpaque(await failure(t.files.read(path)), t.root);
  },
);

it.each(["EACCES", "EPERM", "ENOTDIR"])(
  "does not diagnose absence from %s or leak the raw host error",
  async (code) => {
    const t = fixture(),
      target = join(t.workspace, "missing.txt"),
      real = fs.realpath;
    vi.spyOn(fs, "realpath").mockImplementation(async (...args) => {
      if (args[0] === target) throw Object.assign(Error(`${t.root}/SECRET_CANARY`), { code });
      return real(...args);
    });
    const stat = vi.spyOn(fs, "lstat");
    syncBuiltinESMExports();
    expectOpaque(await failure(t.files.read("missing.txt")), t.root);
    expect(stat.mock.calls.map(([path]) => path)).not.toContain(target);
  },
);

it("does not infer absence if the diagnostic metadata probe itself is refused", async () => {
  const t = fixture(),
    target = join(t.workspace, "missing.txt"),
    stat = fs.lstat;
  vi.spyOn(fs, "lstat").mockImplementation(async (...args) => {
    if (args[0] === target)
      throw Object.assign(Error(`${t.root}/SECRET_CANARY`), { code: "EACCES" });
    return stat(...args);
  });
  syncBuiltinESMExports();
  const error = await failure(t.files.read("missing.txt"));
  expect(error.code).toBe("unavailable");
  expectOpaque(error, t.root);
});

it("does not diagnose absence if the initially missing leaf has reappeared", async () => {
  const t = fixture(),
    target = join(t.workspace, "missing.txt"),
    real = fs.realpath;
  vi.spyOn(fs, "realpath").mockImplementation(async (...args) => {
    try {
      return await real(...args);
    } catch (error) {
      if (args[0] === target) writeFileSync(target, "new content");
      throw error;
    }
  });
  syncBuiltinESMExports();
  expectOpaque(await failure(t.files.read("missing.txt")), t.root);
});

it.each(["stat", "open"])(
  "keeps deletion after successful initial resolution as an unavailable/changed target (%s)",
  async (phase) => {
    const t = fixture(),
      target = join(t.workspace, "existing.txt");
    writeFileSync(target, "original");
    if (phase === "stat") {
      const real = fs.realpath;
      vi.spyOn(fs, "realpath").mockImplementation(async (...args) => {
        const path = await real(...args);
        if (args[0] === target) rmSync(target, { force: true });
        return path;
      });
    } else {
      const open = fs.open;
      vi.spyOn(fs, "open").mockImplementation(async (...args) => {
        if (args[0] === target) rmSync(target);
        return open(...args);
      });
    }
    syncBuiltinESMExports();
    expectOpaque(await failure(t.files.read("existing.txt")), t.root);
  },
);

it.each(["root", "directory", "alias"])(
  "rejects %s identity changes after observing a missing leaf",
  async (kind) => {
    const t = fixture(),
      directory = join(t.workspace, "dir");
    mkdirSync(directory);
    if (kind === "alias") symlinkSync("dir", join(t.workspace, "alias"));
    const stat = fs.lstat;
    let replaced = false;
    vi.spyOn(fs, "lstat").mockImplementation(async (...args) => {
      try {
        return await stat(...args);
      } catch (error) {
        if (!replaced && args[0] === join(directory, "missing.txt")) {
          replaced = true;
          if (kind === "alias") {
            rmSync(join(t.workspace, "alias"));
            symlinkSync(t.outside, join(t.workspace, "alias"));
          } else {
            const changed = kind === "root" ? t.workspace : directory;
            renameSync(changed, join(t.root, "old"));
            mkdirSync(changed);
          }
        }
        throw error;
      }
    });
    syncBuiltinESMExports();
    expectOpaque(
      await failure(t.files.read(`${kind === "alias" ? "alias" : "dir"}/missing.txt`)),
      t.root,
    );
    expect(replaced).toBe(true);
  },
);

it.each(["abort", "revoke"])(
  "discards a missing-path observation when access is stopped during its probe (%s)",
  async (kind) => {
    const t = fixture(),
      target = join(t.workspace, "missing.txt"),
      stat = fs.lstat;
    let stopped = false;
    vi.spyOn(fs, "lstat").mockImplementation(async (...args) => {
      try {
        return await stat(...args);
      } catch (error) {
        if (args[0] === target) {
          stopped = true;
          if (kind === "abort") t.controller.abort();
          else t.revoke();
        }
        throw error;
      }
    });
    syncBuiltinESMExports();
    const error = await failure(t.files.read("missing.txt"));
    expect(error.message).toMatch(/cancelled|revoked/);
    expectOpaque(error, t.root);
    expect(stopped).toBe(true);
  },
);

it("does no filesystem probing when the capability guard refuses access", async () => {
  const t = fixture();
  t.revoke();
  const stat = vi.spyOn(fs, "lstat"),
    real = vi.spyOn(fs, "realpath"),
    open = vi.spyOn(fs, "open");
  syncBuiltinESMExports();
  expectOpaque(await failure(t.files.read("missing.txt")), t.root);
  expect(stat).not.toHaveBeenCalled();
  expect(real).not.toHaveBeenCalled();
  expect(open).not.toHaveBeenCalled();
});

it("leaves list/search, automatic instructions, selected skills and document reads unchanged", async () => {
  const t = fixture();
  mkdirSync(join(t.workspace, "selected-skill"));
  expect(await t.factory.readProjectInstructions(t.context, t.guard)).toBeNull();
  for (const operation of [
    () => t.files.list("missing"),
    () => t.files.search("missing", "text"),
    () => t.factory.readSkillDocument(t.context, "selected-skill", t.guard),
    () => t.factory.readDocumentSnapshot(t.context, t.guard, "missing.pdf"),
  ])
    expectOpaque(await failure(operation()), t.root);
});
