import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { EntryId, SessionId, Timestamp } from "../contracts/persisted/index.ts";
import { SqliteSessionStore } from "./index.ts";
import { backupLocalStore, restoreLocalStore } from "./maintenance.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
async function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-maintenance-")));
  roots.push(root);
  const data = join(root, "data");
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  writeFileSync(join(workspace, "keep.txt"), "actual work stays unchanged");
  const store = new SqliteSessionStore(data);
  await store.commit({
    entries: [],
    effects: [],
    durability: "normal",
    sessions: [{ sessionId: "old" as SessionId, workspaceRoot: workspace, headEntryId: null }],
  });
  const blob = await store.putBlob(Buffer.from("referenced-image-fixture"));
  await store.commit({
    entries: [
      {
        id: "image-entry" as EntryId,
        sessionId: "old" as SessionId,
        parentId: null,
        runId: null,
        createdAt: "2026-10-28T00:00:00.000Z" as Timestamp,
        body: {
          kind: "user_message",
          steering: false,
          content: [{ type: "image", mediaType: "image/png", blob }],
        },
      },
    ],
    effects: [],
    durability: "normal",
    sessions: [
      {
        sessionId: "old" as SessionId,
        workspaceRoot: workspace,
        headEntryId: "image-entry" as EntryId,
      },
    ],
  });
  store.close();
  const backup = join(root, "backup");
  await backupLocalStore({ dataDirectory: data, destination: backup });
  return { root, data, workspace, backup, blob };
}
async function addLater(data: string, workspace: string) {
  const store = new SqliteSessionStore(data);
  try {
    await store.commit({
      entries: [],
      effects: [],
      durability: "normal",
      sessions: [{ sessionId: "later" as SessionId, workspaceRoot: workspace, headEntryId: null }],
    });
  } finally {
    store.close();
  }
}
async function sessions(data: string) {
  const store = new SqliteSessionStore(data);
  try {
    return await store.listSessions();
  } finally {
    store.close();
  }
}

describe("trusted local store maintenance", () => {
  it("restores the old snapshot, preserves lock inode and workspace, and rescues newer sessions under the lock", async () => {
    const f = await fixture();
    await addLater(f.data, f.workspace);
    const lock = statSync(join(f.data, "writer-lock.sqlite")).ino;
    const rescue = join(f.root, "rescue");
    let observed = false;
    const result = await restoreLocalStore({
      dataDirectory: f.data,
      backupDirectory: f.backup,
      rescueDestination: rescue,
      rescuePublished(receipt) {
        expect(receipt.sessionCount).toBe(2);
        expect(() => new SqliteSessionStore(f.data)).toThrow();
        observed = true;
      },
    });
    expect(observed).toBe(true);
    expect(result.sessionCount).toBe(1);
    expect(await sessions(f.data)).toEqual(["old"]);
    expect(await sessions(rescue)).toEqual(["later", "old"]);
    expect(statSync(join(f.data, "writer-lock.sqlite")).ino).toBe(lock);
    expect(readFileSync(join(f.workspace, "keep.txt"), "utf8")).toBe("actual work stays unchanged");
  });
  it("refuses a live competing writer without changing its records", async () => {
    const f = await fixture();
    const owner = new SqliteSessionStore(f.data);
    try {
      await expect(
        backupLocalStore({ dataDirectory: f.data, destination: join(f.root, "blocked") }),
      ).rejects.toThrow();
      await expect(
        restoreLocalStore({
          dataDirectory: f.data,
          backupDirectory: f.backup,
          rescueDestination: join(f.root, "rescue"),
        }),
      ).rejects.toThrow();
      expect(await owner.listSessions()).toEqual(["old"]);
    } finally {
      owner.close();
    }
  });
  it.each(["schema", "symlink", "corrupt", "blob"])(
    "rejects %s backup before touching the current data",
    async (kind) => {
      const f = await fixture();
      await addLater(f.data, f.workspace);
      const file = join(f.backup, "data.sqlite");
      if (kind === "schema") {
        const db = new DatabaseSync(file);
        db.exec("PRAGMA user_version=99");
        db.close();
      }
      if (kind === "symlink") {
        rmSync(file);
        symlinkSync(join(f.data, "data.sqlite"), file);
      }
      if (kind === "corrupt") writeFileSync(file, "invalid sqlite");
      if (kind === "blob") writeFileSync(join(f.backup, "blobs", f.blob.slice(7)), "changed image");
      await expect(
        restoreLocalStore({
          dataDirectory: f.data,
          backupDirectory: f.backup,
          rescueDestination: join(f.root, "rescue"),
        }),
      ).rejects.toThrow();
      expect(await sessions(f.data)).toEqual(["later", "old"]);
    },
  );
  it("does not discard unknown effects and leases", async () => {
    const f = await fixture();
    const db = new DatabaseSync(join(f.data, "data.sqlite"));
    db.exec("INSERT INTO runs(id,session_id,status) VALUES('unknown-run','old','interrupted')");
    db.prepare("INSERT INTO workspace_leases(workspace_root,run_id) VALUES(?,?)").run(
      f.workspace,
      "unknown-run",
    );
    db.close();
    await expect(
      restoreLocalStore({
        dataDirectory: f.data,
        backupDirectory: f.backup,
        rescueDestination: join(f.root, "rescue"),
      }),
    ).rejects.toThrow("Unsettled");
    const check = new SqliteSessionStore(f.data);
    try {
      expect((await check.loadSession("old" as SessionId))?.leases).toHaveLength(1);
    } finally {
      check.close();
    }
  });
  it.each(["restore:before_replace", "restore:after_replace"] as const)(
    "retains a usable rescue at %s failure",
    async (point) => {
      const f = await fixture();
      await addLater(f.data, f.workspace);
      const store = new SqliteSessionStore(f.data, {
        checkpoint(at) {
          if (at === point) throw Error("injected restore failure");
        },
      });
      const rescue = join(f.root, "rescue");
      try {
        await expect(store.restoreSnapshot(f.backup, rescue)).rejects.toThrow(
          point === "restore:after_replace"
            ? "durability is unconfirmed"
            : "injected restore failure",
        );
      } finally {
        store.close();
      }
      expect(await sessions(rescue)).toEqual(["later", "old"]);
      expect(await sessions(f.data)).toEqual(
        point === "restore:after_replace" ? ["old"] : ["later", "old"],
      );
    },
  );

  it("stops before replacement if rescue publication fails", async () => {
    const f = await fixture();
    await addLater(f.data, f.workspace);
    await expect(
      restoreLocalStore({
        dataDirectory: f.data,
        backupDirectory: f.backup,
        rescueDestination: join(f.root, "rescue"),
        rescuePublished() {
          throw Error("manifest fsync failure");
        },
      }),
    ).rejects.toThrow("manifest fsync");
    expect(await sessions(f.data)).toEqual(["later", "old"]);
    expect(await sessions(join(f.root, "rescue"))).toEqual(["later", "old"]);
  });
});
