import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type {
  ActionDigest,
  BlobRef,
  EffectId,
  EffectRecord,
  RunId,
  Timestamp,
  ToolCallId,
  WorkspaceChange,
  WorkspaceSnapshot,
  WorkspaceSnapshotStore,
} from "../contracts/index.ts";
import { NodeWorkspaceWrites, type WriteCheckpoint } from "./writes.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
function setup(content: Record<string, string | Uint8Array> = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-write-capability-")));
  roots.push(root);
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  const write = (path: string, value: string | Uint8Array) => {
    const pieces = path.split("/");
    pieces.pop();
    mkdirSync(join(workspace, ...pieces), { recursive: true });
    writeFileSync(join(workspace, path), value, { mode: 0o640 });
  };
  for (const [path, value] of Object.entries(content)) write(path, value);
  const snapshots = new Map<string, WorkspaceSnapshot>();
  const blobs = new Map<BlobRef, Uint8Array>();
  const store: WorkspaceSnapshotStore = {
    async saveSnapshot(snapshot) {
      snapshots.set(snapshot.id, structuredClone(snapshot));
    },
    async getSnapshot(id) {
      return snapshots.get(id) ?? null;
    },
    async getSnapshotForEffect(id) {
      return snapshots.get(id) ?? null;
    },
    async putBlob(bytes) {
      const ref = `sha256:${hash(bytes)}` as BlobRef;
      blobs.set(ref, bytes.slice());
      return ref;
    },
    async getBlob(ref) {
      return blobs.get(ref)?.slice() ?? null;
    },
  };
  let allowed = true;
  let hook: ((point: WriteCheckpoint) => void) | undefined;
  let next = 0;
  const controller = new AbortController();
  const context = {
    runId: "run_write" as RunId,
    workspaceRoot: workspace,
    signal: controller.signal,
    limits: { maxOutputBytes: 32768 },
  };
  const factory = new NodeWorkspaceWrites(store, [join(workspace, "private-store")], {
    checkpoint: (point) => hook?.(point),
  });
  const guard = () => {
    if (!allowed) throw new Error("revoked");
  };
  const inspect = factory.create(context, guard, { phase: "prepare" });
  const prepare = (mutation: WorkspaceChange) => {
    const effect: EffectRecord = {
      id: `effect_${++next}` as EffectId,
      runId: context.runId,
      callId: `call_${next}` as ToolCallId,
      tool: mutation.restoreOf ? "undo" : mutation.expectedHash === null ? "create" : "edit",
      profile: { class: "workspace_write", reversibility: "snapshot", verification: "postcheck" },
      digest: "test_digest" as ActionDigest,
      state: "started",
      updatedAt: "2026-10-25T00:00:00.000Z" as Timestamp,
    };
    const action = {
      digest: effect.digest,
      summary: "test approved write",
      preconditions: [
        { kind: "file_hash" as const, path: mutation.path, sha256: mutation.expectedHash },
      ],
      payload: mutation,
    };
    return {
      effect,
      action,
      capability: factory.create(context, guard, { phase: "execute", effect, action }),
    };
  };
  return {
    root,
    workspace,
    write,
    snapshots,
    blobs,
    store,
    factory,
    context,
    guard,
    inspect,
    prepare,
    controller,
    revoke: () => {
      allowed = false;
    },
    checkpoint: (value: ((point: WriteCheckpoint) => void) | undefined) => {
      hook = value;
    },
    read: (path = "a.txt") => readFileSync(join(workspace, path), "utf8"),
  };
}
function edit(text = "after"): WorkspaceChange {
  return { path: "a.txt", expectedHash: hash("before"), text, mode: 0o640 };
}
function create(path = "new.txt"): WorkspaceChange {
  return { path, expectedHash: null, text: "new text", mode: 0o600 };
}

describe("confined workspace mutations", () => {
  it("creates a complete private file with durable snapshot metadata and can undo creation", async () => {
    const t = setup();
    const effect = t.prepare(create());
    const receipt = await effect.capability.apply();
    expect(t.read("new.txt")).toBe("new text");
    expect(statSync(join(t.workspace, "new.txt")).mode & 0o777).toBe(0o600);
    expect(t.snapshots.get(receipt.snapshotId)).toMatchObject({
      beforeHash: null,
      beforeBlob: null,
      afterHash: hash("new text"),
    });
    const undo = await t.inspect.inspectUndo(receipt.snapshotId);
    expect(undo).toEqual({
      path: "new.txt",
      expectedHash: hash("new text"),
      text: null,
      mode: null,
      restoreOf: receipt.snapshotId,
    });
    const restored = await t.prepare(undo).capability.apply();
    expect(existsSync(join(t.workspace, "new.txt"))).toBe(false);
    expect(restored.afterHash).toBe(null);
    expect(readdirSync(t.workspace)).toEqual([]);
  });
  it("replaces text, preserves mode, stores before bytes, and undo restores exact original content", async () => {
    const t = setup({ "a.txt": "before" });
    const receipt = await t.prepare(edit()).capability.apply();
    expect(t.read()).toBe("after");
    expect(statSync(join(t.workspace, "a.txt")).mode & 0o777).toBe(0o640);
    const snapshot = t.snapshots.get(receipt.snapshotId) as WorkspaceSnapshot;
    expect(Buffer.from(t.blobs.get(snapshot.beforeBlob as BlobRef) as Uint8Array).toString()).toBe(
      "before",
    );
    const restored = await t
      .prepare(await t.inspect.inspectUndo(receipt.snapshotId))
      .capability.apply();
    expect(t.read()).toBe("before");
    expect(restored.afterHash).toBe(hash("before"));
    expect(readdirSync(t.workspace)).toEqual(["a.txt"]);
  });
  it("preserves UTF-8 BOM and non-ASCII content through inspection and undo", async () => {
    const text = "\ufeff你好\n";
    const t = setup({ "a.txt": text });
    const before = await t.inspect.inspect("a.txt");
    expect(before.text).toBe(text);
    const receipt = await t.prepare({ ...edit(), expectedHash: hash(text) }).capability.apply();
    await t.prepare(await t.inspect.inspectUndo(receipt.snapshotId)).capability.apply();
    expect(t.read()).toBe(text);
  });
  it("will not undo a later external edit or changed mode", async () => {
    const t = setup({ "a.txt": "before" });
    const receipt = await t.prepare(edit()).capability.apply();
    t.write("a.txt", "user text");
    await expect(t.inspect.inspectUndo(receipt.snapshotId)).rejects.toThrow(/changed/);
    expect(t.read()).toBe("user text");
    t.write("a.txt", "after");
    chmodSync(join(t.workspace, "a.txt"), 0o600);
    await expect(t.inspect.inspectUndo(receipt.snapshotId)).rejects.toThrow(/changed/);
  });
  it("rechecks undo after approval and refuses forged restore bytes or arbitrary removal", async () => {
    const t = setup({ "a.txt": "before" });
    const receipt = await t.prepare(edit()).capability.apply();
    const undo = await t.inspect.inspectUndo(receipt.snapshotId);
    await expect(t.prepare({ ...undo, text: "forged" }).capability.apply()).rejects.toThrow(
      /differs/,
    );
    await expect(
      t
        .prepare({ path: "a.txt", expectedHash: hash("after"), text: null, mode: null })
        .capability.apply(),
    ).rejects.toThrow(/Only snapshot/);
    const prepared = t.prepare(undo);
    t.write("a.txt", "later edit");
    await expect(prepared.capability.apply()).rejects.toThrow(/changed/);
    expect(t.read()).toBe("later edit");
  });
  it("does not expose write authority during prepare or allow repeated application", async () => {
    const t = setup();
    await expect(t.inspect.apply()).rejects.toThrow(/started/);
    const prepared = t.prepare(create());
    await prepared.capability.apply();
    await expect(prepared.capability.apply()).rejects.toThrow(/only once/);
    expect(t.snapshots.size).toBe(1);
  });
  it("checks effect state, class, run, digest and exact hash precondition", async () => {
    const t = setup();
    const p = t.prepare(create());
    for (const effect of [
      { ...p.effect, state: "approved" as const },
      { ...p.effect, profile: { ...p.effect.profile, class: "read" as const } },
      { ...p.effect, runId: "another" as RunId },
      { ...p.effect, digest: "another" as ActionDigest },
    ])
      await expect(
        t.factory
          .create(t.context, t.guard, { phase: "execute", effect, action: p.action })
          .apply(),
      ).rejects.toThrow(/started/);
    await expect(
      t.factory
        .create(t.context, t.guard, {
          phase: "execute",
          effect: p.effect,
          action: { ...p.action, preconditions: [] },
        })
        .apply(),
    ).rejects.toThrow(/precondition/);
    expect(t.snapshots.size).toBe(0);
    expect(readdirSync(t.workspace)).toEqual([]);
  });
  it.each([
    "../outside.txt",
    "/tmp/outside.txt",
    "a/../outside.txt",
    "a\\b",
    "",
    ".",
    "a//b",
    ".moyyi-write-forged.tmp",
  ])("rejects invalid path %s", async (path) => {
    const t = setup();
    await expect(t.inspect.inspect(path)).rejects.toThrow();
    await expect(t.prepare(create(path)).capability.apply()).rejects.toThrow();
    expect(t.snapshots.size).toBe(0);
  });
  it.each([
    ".env",
    ".env.example",
    ".ssh/key",
    "private.pem",
    ".git/config",
    ".moyyi/data",
    "private-store/data",
  ])("protects %s during inspection and publication", async (path) => {
    const t = setup({ [path]: "synthetic secret" });
    await expect(t.inspect.inspect(path)).rejects.toThrow(/Protected/);
    await expect(t.prepare(create(path)).capability.apply()).rejects.toThrow(/Protected/);
  });
  it("protects a configured private path through its canonical alias", async () => {
    const t = setup({ "private-real/data": "private" });
    symlinkSync(join(t.workspace, "private-real"), join(t.root, "private-alias"));
    const factory = new NodeWorkspaceWrites(t.store, [join(t.root, "private-alias")]);
    await expect(
      factory.create(t.context, t.guard, { phase: "prepare" }).inspect("private-real/data"),
    ).rejects.toThrow(/Protected/);
  });
  it("rejects internal, external and dangling symlinks and hard-linked targets", async () => {
    const t = setup({ "a.txt": "before", "dir/b.txt": "before" });
    writeFileSync(join(t.root, "outside.txt"), "canary");
    symlinkSync("a.txt", join(t.workspace, "alias.txt"));
    symlinkSync(join(t.root, "outside.txt"), join(t.workspace, "outside.txt"));
    symlinkSync("dir", join(t.workspace, "alias-dir"));
    symlinkSync("missing.txt", join(t.workspace, "dangling.txt"));
    for (const path of ["alias.txt", "outside.txt", "alias-dir/b.txt", "dangling.txt"])
      await expect(t.inspect.inspect(path)).rejects.toThrow(/symbolic/);
    linkSync(join(t.workspace, "a.txt"), join(t.root, "hard.txt"));
    await expect(t.inspect.inspect("a.txt")).rejects.toThrow(/one link/);
    expect(readFileSync(join(t.root, "outside.txt"), "utf8")).toBe("canary");
  });
  it("rejects directories, binary, invalid UTF-8, oversized files and special permissions", async () => {
    const t = setup({
      binary: Uint8Array.of(0),
      invalid: Uint8Array.of(0xff),
      large: "a".repeat(1024 * 1024 + 1),
      "a.txt": "before",
    });
    mkdirSync(join(t.workspace, "dir"));
    chmodSync(join(t.workspace, "a.txt"), 0o4640);
    for (const path of ["dir", "binary", "invalid", "large", "a.txt"])
      await expect(t.inspect.inspect(path)).rejects.toThrow();
    await expect(t.prepare(create("missing/file")).capability.apply()).rejects.toThrow(/Parent/);
  });
  it("rejects forged payload fields and permission changes", async () => {
    const t = setup({ "a.txt": "before" });
    await expect(t.prepare({ ...edit(), mode: 0o777 }).capability.apply()).rejects.toThrow(
      /preserve/,
    );
    await expect(t.prepare({ ...create(), mode: 0o644 }).capability.apply()).rejects.toThrow(
      /0600/,
    );
    for (const mutation of [
      { ...edit(), text: "\ud800" },
      { ...edit(), text: "\0" },
      { ...edit(), text: "a".repeat(1024 * 1024 + 1) },
      { ...edit(), mode: 0o4755 },
      { ...edit(), unsupported: true },
    ])
      await expect(t.prepare(mutation).capability.apply()).rejects.toThrow();
    expect(t.read()).toBe("before");
  });
  it("does not overwrite a destination appearing after create preparation", async () => {
    const t = setup();
    const prepared = t.prepare(create());
    t.checkpoint((point) => {
      if (point === "before_publish") t.write("new.txt", "user-created");
    });
    await expect(prepared.capability.apply()).rejects.toThrow(/changed/);
    expect(t.read("new.txt")).toBe("user-created");
    expect(readdirSync(t.workspace)).toEqual(["new.txt"]);
  });
  it("rechecks content, permissions and parent identity immediately before publication", async () => {
    for (const mutation of ["content", "mode", "parent"] as const) {
      const t = setup({ "dir/a.txt": "before" });
      t.checkpoint((point) => {
        if (point !== "before_publish") return;
        if (mutation === "content") t.write("dir/a.txt", "user-edited");
        else if (mutation === "mode") chmodSync(join(t.workspace, "dir/a.txt"), 0o600);
        else {
          renameSync(join(t.workspace, "dir"), join(t.workspace, "original"));
          mkdirSync(join(t.workspace, "dir"));
          t.write("dir/a.txt", "before");
        }
      });
      await expect(t.prepare({ ...edit(), path: "dir/a.txt" }).capability.apply()).rejects.toThrow(
        /changed/,
      );
      expect(t.read("dir/a.txt")).toBe(mutation === "content" ? "user-edited" : "before");
    }
  });
  it.each(["after_snapshot", "after_stage_sync", "before_publish"] as const)(
    "cancellation at %s leaves the original target intact",
    async (point) => {
      const t = setup({ "a.txt": "before" });
      t.checkpoint((at) => {
        if (at === point) t.controller.abort();
      });
      await expect(t.prepare(edit()).capability.apply()).rejects.toThrow(/cancelled/);
      expect(t.read()).toBe("before");
      expect(readdirSync(t.workspace)).toEqual(["a.txt"]);
    },
  );
  it("refuses a parent replaced after snapshot and never stages outside the workspace", async () => {
    const t = setup({ "dir/a.txt": "before" });
    mkdirSync(join(t.root, "outside"));
    writeFileSync(join(t.root, "outside/a.txt"), "canary");
    t.checkpoint((point) => {
      if (point !== "after_snapshot") return;
      renameSync(join(t.workspace, "dir"), join(t.workspace, "original"));
      symlinkSync(join(t.root, "outside"), join(t.workspace, "dir"));
    });
    await expect(t.prepare({ ...edit(), path: "dir/a.txt" }).capability.apply()).rejects.toThrow(
      /symbolic/,
    );
    expect(readdirSync(join(t.root, "outside"))).toEqual(["a.txt"]);
    expect(readFileSync(join(t.root, "outside/a.txt"), "utf8")).toBe("canary");
  });
  it("refuses staging content changed before publication", async () => {
    const t = setup({ "a.txt": "before" });
    t.checkpoint((point) => {
      if (point !== "before_publish") return;
      const name = readdirSync(t.workspace).find((path) => path.startsWith(".moyyi-write-"));
      if (!name) throw Error("Missing staging file");
      writeFileSync(join(t.workspace, name), "tampered");
    });
    await expect(t.prepare(edit()).capability.apply()).rejects.toThrow(/Staged/);
    expect(t.read()).toBe("before");
    expect(readdirSync(t.workspace)).toEqual(["a.txt"]);
  });
  it("revocation during store I/O prevents the target write", async () => {
    const t = setup({ "a.txt": "before" });
    const save = t.store.saveSnapshot;
    t.store.saveSnapshot = async (snapshot) => {
      await save(snapshot);
      t.revoke();
    };
    await expect(t.prepare(edit()).capability.apply()).rejects.toThrow();
    expect(t.read()).toBe("before");
    expect(readdirSync(t.workspace)).toEqual(["a.txt"]);
  });
  it.each([
    "before_snapshot",
    "after_snapshot",
    "after_stage_sync",
    "before_publish",
    "after_publish",
    "after_parent_sync",
  ] as const)("fault at %s retains evidence without replay", async (point) => {
    const t = setup({ "a.txt": "before" });
    t.checkpoint((at) => {
      if (at === point) throw new Error("synthetic I/O failure");
    });
    const prepared = t.prepare(edit());
    await expect(prepared.capability.apply()).rejects.toThrow();
    const published = point === "after_publish" || point === "after_parent_sync";
    expect(t.read()).toBe(published ? "after" : "before");
    expect(t.snapshots.size).toBe(point === "before_snapshot" ? 0 : 1);
    const recovered = await t.factory.reconcile(prepared.effect, t.context);
    expect(recovered).toMatchObject({ resolved: true, status: published ? "succeeded" : "failed" });
    expect(t.read()).toBe(published ? "after" : "before");
    expect(readdirSync(t.workspace)).toEqual(["a.txt"]);
  });
  it("does not call a published cancelled write unchanged, and later inspection can resolve it", async () => {
    const t = setup({ "a.txt": "before" });
    t.checkpoint((point) => {
      if (point === "after_publish") t.controller.abort();
    });
    const p = t.prepare(edit());
    await expect(p.capability.apply()).rejects.toThrow(/cancelled/);
    expect(t.read()).toBe("after");
    const context = { ...t.context, signal: new AbortController().signal };
    expect(await t.factory.reconcile(p.effect, context)).toMatchObject({
      resolved: true,
      status: "succeeded",
      evidence: expect.stringContaining("attribution"),
    });
  });
  it("leaves divergent post-crash state unknown and recovery capabilities cannot write", async () => {
    const t = setup({ "a.txt": "before" });
    const p = t.prepare(edit());
    await p.capability.apply();
    t.write("a.txt", "external later edit");
    const capability = t.factory.create(t.context, t.guard, {
      phase: "prepare",
      effect: { ...p.effect, state: "unknown" },
    });
    expect(await capability.reconcile()).toMatchObject({ resolved: false });
    await expect(capability.apply()).rejects.toThrow(/started/);
    expect(t.read()).toBe("external later edit");
  });
  it("rejects corrupt snapshot content and snapshots from another workspace", async () => {
    const t = setup({ "a.txt": "before" });
    const receipt = await t.prepare(edit()).capability.apply();
    const snapshot = t.snapshots.get(receipt.snapshotId) as WorkspaceSnapshot;
    t.blobs.set(snapshot.beforeBlob as BlobRef, new TextEncoder().encode("corrupt"));
    await expect(t.inspect.inspectUndo(receipt.snapshotId)).rejects.toThrow(/corrupt/);
    t.snapshots.set(receipt.snapshotId, { ...snapshot, workspaceRoot: t.root });
    await expect(t.inspect.inspectUndo(receipt.snapshotId)).rejects.toThrow(/another workspace/);
  });
  it("checks the guard during recovery, including after asynchronous snapshot lookup", async () => {
    const t = setup({ "a.txt": "before" });
    const p = t.prepare(edit());
    await p.capability.apply();
    const get = t.store.getSnapshotForEffect;
    t.store.getSnapshotForEffect = async (id) => {
      const value = await get(id);
      t.revoke();
      return value;
    };
    expect(await t.factory.reconcile(p.effect, t.context, t.guard)).toMatchObject({
      resolved: false,
    });
  });
});
