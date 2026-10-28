import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { SessionId } from "../contracts/index.ts";
import { SqliteSessionStore } from "./index.ts";
import type { CreateMaterial } from "./materials.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
async function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-material-store-")));
  const workspaceRoot = join(root, "workspace");
  mkdirSync(workspaceRoot);
  const directory = join(root, "data");
  let store = new SqliteSessionStore(directory);
  cleanups.push(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  await store.commit({
    entries: [],
    effects: [],
    durability: "normal",
    sessions: [{ sessionId: "session" as SessionId, workspaceRoot, headEntryId: null }],
  });
  const input = (extra: Partial<CreateMaterial> = {}): CreateMaterial => {
    const id = `material_${randomUUID()}`;
    return {
      id,
      workspaceRoot,
      path: `moyyi-materials/${id}.txt`,
      name: "source.txt",
      format: "txt",
      bytes: Buffer.from("actual original"),
      createdAt: "2026-01-01T00:00:00.000Z",
      ...extra,
    };
  };
  return {
    workspaceRoot,
    input,
    get store() {
      return store;
    },
    reopen() {
      store.close();
      store = new SqliteSessionStore(directory);
    },
  };
}
describe("managed material store", () => {
  it("persists immutable originals and deduplicates exact content and format within the workspace", async () => {
    const h = await setup();
    const first = await h.store.materials.create(h.input());
    expect(first.state).toBe("pending");
    await expect(h.store.materials.attach("session", [first.id])).rejects.toThrow("unavailable");
    const active = await h.store.materials.activate(first.id, first.revision);
    const again = await h.store.materials.create(h.input({ name: "different-name.txt" }));
    expect(again).toEqual(active);
    expect(Buffer.from(await h.store.materials.read(first.id, active.revision)).toString()).toBe(
      "actual original",
    );
    h.reopen();
    expect(await h.store.materials.get(first.id)).toEqual(active);
  });
  it("restores the explicit selection after restart but never releases conservative history references", async () => {
    const h = await setup();
    let row = await h.store.materials.create(h.input());
    row = await h.store.materials.activate(row.id, row.revision);
    await h.store.materials.attach("session", [row.id]);
    h.reopen();
    expect(
      (await h.store.materials.listSession("session", h.workspaceRoot)).map((v) => v.id),
    ).toEqual([row.id]);
    await h.store.materials.attach("session", []);
    expect(await h.store.materials.listSession("session")).toEqual([]);
    expect((await h.store.materials.get(row.id))?.referenceCount).toBe(1);
    row = await h.store.materials.recycle(row.id, row.revision);
    await expect(h.store.materials.purge(row.id, row.revision)).rejects.toThrow("Referenced");
    expect((await h.store.materials.restore(row.id, row.revision)).state).toBe("active");
  });
  it("rejects stale changes, foreign sessions and mixed selections atomically", async () => {
    const h = await setup();
    let row = await h.store.materials.create(h.input());
    row = await h.store.materials.activate(row.id, row.revision);
    await expect(h.store.materials.recycle(row.id, row.revision - 1)).rejects.toThrow("changed");
    await expect(h.store.materials.attach("missing", [row.id])).rejects.toThrow("session");
    await expect(h.store.materials.listSession("session", "/another-workspace")).rejects.toThrow(
      "workspace",
    );
    await expect(
      h.store.materials.attach("session", [row.id, `material_${randomUUID()}`]),
    ).rejects.toThrow("unavailable");
    expect((await h.store.materials.get(row.id))?.referenceCount).toBe(0);
    expect(await h.store.materials.listSession("session")).toEqual([]);
  });
  it("clears only unreferenced recycled library rows and preserves the shared blob", async () => {
    const h = await setup();
    const bytes = Buffer.from("shared snapshot content");
    const blob = await h.store.putBlob(bytes);
    let row = await h.store.materials.create(h.input({ bytes }));
    row = await h.store.materials.recycle(row.id, row.revision);
    row = await h.store.materials.purge(row.id, row.revision);
    expect(row.state).toBe("purged");
    expect(await h.store.materials.list(h.workspaceRoot, { includeRecycled: true })).toEqual([]);
    expect(await h.store.getBlob(blob)).toEqual(bytes);
    await expect(h.store.materials.read(row.id)).rejects.toThrow("unavailable");
  });
  it("keeps housekeeping explicitly disabled and rejects invalid snapshot inputs", async () => {
    const h = await setup();
    expect(await h.store.materials.housekeeping(h.workspaceRoot)).toBe(false);
    await h.store.materials.setHousekeeping(h.workspaceRoot, true);
    h.reopen();
    expect(await h.store.materials.housekeeping(h.workspaceRoot)).toBe(true);
    for (const extra of [
      { path: "../escape.txt" },
      { name: "../source.txt" },
      { bytes: Buffer.alloc(10 * 1024 * 1024 + 1) },
      { createdAt: "invalid" },
    ])
      await expect(h.store.materials.create(h.input(extra))).rejects.toThrow();
    expect(await h.store.materials.list(h.workspaceRoot)).toEqual([]);
    h.store.close();
    await expect(h.store.materials.setHousekeeping(h.workspaceRoot, false)).rejects.toThrow(
      "closed",
    );
  });
});
