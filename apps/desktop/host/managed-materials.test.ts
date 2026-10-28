import { randomUUID } from "node:crypto";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Plugin } from "moyyi/contracts";
import {
  createRuntime,
  type MaterialStore,
  type Runtime,
  type StoredMaterial,
} from "moyyi/runtime";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagedMaterials, type MaterialCheckpoint } from "./managed-materials.ts";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});
async function setup(checkpoint?: (point: MaterialCheckpoint) => void) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "moyyi-managed-test-")));
  const workspaceRoot = join(root, "workspace");
  const external = join(root, "external");
  mkdirSync(workspaceRoot);
  mkdirSync(external);
  const origin = { provider: "materials-offline", model: "unused" };
  const plugin: Plugin = {
    name: origin.provider,
    apiVersion: 1,
    setup(host) {
      host.registerModelProvider({
        id: origin.provider,
        models: [
          {
            origin,
            contextWindowTokens: 200000,
            maxOutputTokens: 8192,
            parallelToolCalls: false,
            reasoning: "none",
            promptCache: "none",
            editFormat: "search_replace",
          },
        ],
        createClient: () => ({
          stream() {
            throw Error("Material actions must not call a model");
          },
        }),
      });
    },
  };
  const open = () =>
    createRuntime({ dataDirectory: join(root, "data"), model: origin, plugins: [{ plugin }] });
  let runtime: Runtime = await open();
  let sessionId = "";
  runtime.subscribe((event) => {
    if (event.type === "session.ready") sessionId = event.sessionId;
  });
  await runtime.send({ type: "session.create", workspaceRoot });
  await runtime.idle();
  cleanups.push(async () => {
    await runtime.close();
    rmSync(root, { recursive: true, force: true });
  });
  const make = () =>
    new ManagedMaterials(runtime.materials as MaterialStore, {
      excluded: [join(root, "data")],
      ...(checkpoint ? { checkpoint } : {}),
    });
  let manager = make();
  const source = (name = "source.txt", bytes: string | Buffer = "first captured version") => {
    const path = join(external, name);
    writeFileSync(path, bytes);
    return path;
  };
  const operation = (row: StoredMaterial) => ({
    workspaceRoot,
    id: row.id,
    revision: row.revision,
  });
  return {
    root,
    workspaceRoot,
    external,
    source,
    operation,
    get sessionId() {
      return sessionId;
    },
    get runtime() {
      return runtime;
    },
    get manager() {
      return manager;
    },
    async import(paths: readonly string[], signal?: AbortSignal) {
      return manager.importFiles({
        workspaceRoot,
        sessionId,
        paths,
        ...(signal ? { signal } : {}),
      });
    },
    async reopen() {
      await runtime.close();
      runtime = await open();
      manager = make();
    },
  };
}
describe("native managed material lifecycle", () => {
  it("processes a queued cancellation before reading the first external file", async () => {
    let reads = 0;
    const h = await setup((point) => {
      if (point === "source:read") reads++;
    });
    const controller = new AbortController();
    setImmediate(() => controller.abort());
    await expect(h.import([h.source()], controller.signal)).rejects.toThrow();
    expect(reads).toBe(0);
    expect(await h.manager.list(h.workspaceRoot)).toEqual([]);
    expect(readdirSync(h.workspaceRoot)).toEqual([]);
  });
  it("yields between source files so an event-loop cancellation does not read the next item", async () => {
    let reads = 0;
    const controller = new AbortController();
    const h = await setup((point) => {
      if (point === "source:read" && ++reads === 1) setImmediate(() => controller.abort());
    });
    await expect(
      h.import([h.source("one.txt"), h.source("two.txt", "second")], controller.signal),
    ).rejects.toThrow();
    expect(reads).toBe(1);
    expect(await h.manager.list(h.workspaceRoot)).toEqual([]);
    expect(readdirSync(h.workspaceRoot)).toEqual([]);
  });
  it("processes queued cancellation before publication while keeping a recoverable immutable original", async () => {
    const h = await setup();
    const controller = new AbortController();
    const store = h.runtime.materials as MaterialStore;
    const create = store.create.bind(store);
    vi.spyOn(store, "create").mockImplementationOnce(async (input) => {
      const row = await create(input);
      setImmediate(() => controller.abort());
      return row;
    });
    await expect(h.import([h.source()], controller.signal)).rejects.toThrow();
    const pending = (await h.manager.list(h.workspaceRoot))[0] as StoredMaterial;
    expect(pending.state).toBe("pending");
    expect(readdirSync(h.workspaceRoot)).toEqual([]);
    expect((await h.manager.restore(h.operation(pending))).state).toBe("active");
  });
  it("imports all seven document formats plus text, retains originals and reopens exact selections", async () => {
    const h = await setup();
    const paths = ["pdf", "docx", "xlsx", "pptx", "odt", "ods", "odp", "txt"].map((format) =>
      h.source(`source.${format}`, `original ${format}`),
    );
    const records = await h.import(paths);
    expect(records).toHaveLength(8);
    for (const [index, row] of records.entries()) {
      expect(row).toMatchObject({ state: "active", referenceCount: 1 });
      expect(readFileSync(join(h.workspaceRoot, row.path))).toEqual(
        readFileSync(paths[index] as string),
      );
    }
    await h.reopen();
    expect(
      (await h.manager.selected({ sessionId: h.sessionId, workspaceRoot: h.workspaceRoot }))
        .map((row) => row.id)
        .sort(),
    ).toEqual(records.map((row) => row.id).sort());
    await expect(h.import([h.source("ninth.txt", "nine")])).rejects.toThrow("eight");
  });
  it("deduplicates exact content but captures a new version without overwriting a prior copy", async () => {
    const h = await setup();
    const source = h.source();
    const first = (await h.import([source]))[0] as StoredMaterial;
    const again = (await h.import([source, h.source("same.txt")]))[0] as StoredMaterial;
    expect(again.id).toBe(first.id);
    writeFileSync(source, "second captured version");
    const second = (await h.import([source]))[0] as StoredMaterial;
    expect(second.id).not.toBe(first.id);
    expect(readFileSync(join(h.workspaceRoot, first.path), "utf8")).toBe("first captured version");
    expect(readFileSync(source, "utf8")).toBe("second captured version");
  });
  it("supports bounded text and image originals without claiming extraction or decoding", async () => {
    const h = await setup();
    const files = ["md", "csv", "json", "png", "jpeg"].map((format) =>
      h.source(`file.${format}`, format === "png" ? Buffer.from([137, 80, 78, 71]) : "material"),
    );
    expect(await h.import(files)).toHaveLength(5);
    await expect(h.import([h.source("invalid.txt", Buffer.from([0xff]))])).rejects.toThrow("UTF-8");
  });
  it("rejects symlink, hardlink, protected, oversized and foreign-session imports before publication", async () => {
    const h = await setup();
    const source = h.source();
    symlinkSync(source, join(h.external, "link.txt"));
    linkSync(source, join(h.external, "hard.txt"));
    h.source("large.txt", Buffer.alloc(10 * 1024 * 1024 + 1));
    h.source(".env", "private");
    for (const name of ["link.txt", "hard.txt", "large.txt", ".env"])
      await expect(h.import([join(h.external, name)])).rejects.toThrow();
    await expect(
      h.manager.importFiles({
        sessionId: "missing",
        workspaceRoot: h.workspaceRoot,
        paths: [source],
      }),
    ).rejects.toThrow("session");
    expect(await h.manager.list(h.workspaceRoot)).toEqual([]);
    expect(readdirSync(h.workspaceRoot)).toEqual([]);
  });
  it("cancels before publication and recovers a pending immutable original without partial copies", async () => {
    const abort = new AbortController();
    let once = true;
    const h = await setup((point) => {
      if (once && point === "copy:staged") {
        once = false;
        abort.abort();
      }
    });
    await expect(h.import([h.source()], abort.signal)).rejects.toThrow();
    const pending = (await h.manager.list(h.workspaceRoot))[0] as StoredMaterial;
    expect(pending.state).toBe("pending");
    expect(readdirSync(join(h.workspaceRoot, "moyyi-materials"))).toEqual([]);
    const restored = await h.manager.restore(h.operation(pending));
    expect(restored.state).toBe("active");
    expect(readFileSync(join(h.workspaceRoot, restored.path), "utf8")).toBe(
      "first captured version",
    );
  });
  it("retains pending evidence after publication abort and never labels it active prematurely", async () => {
    const abort = new AbortController();
    let once = true;
    const h = await setup((point) => {
      if (once && point === "copy:published") {
        once = false;
        abort.abort();
      }
    });
    await expect(h.import([h.source()], abort.signal)).rejects.toThrow();
    const pending = (await h.manager.list(h.workspaceRoot))[0] as StoredMaterial;
    expect(pending.state).toBe("pending");
    expect(existsSync(join(h.workspaceRoot, pending.path))).toBe(true);
    expect((await h.manager.restore(h.operation(pending))).state).toBe("active");
  });
  it("does not follow a replaced destination directory", async () => {
    let h: Awaited<ReturnType<typeof setup>>;
    let once = true;
    h = await setup((point) => {
      if (once && point === "copy:before_publish") {
        once = false;
        const folder = join(h.workspaceRoot, "moyyi-materials");
        renameSync(folder, join(h.workspaceRoot, "old"));
        symlinkSync(h.external, folder);
      }
    });
    const source = h.source();
    await expect(h.import([source])).rejects.toThrow();
    expect(readdirSync(h.external)).toEqual(["source.txt"]);
    expect(readFileSync(source, "utf8")).toBe("first captured version");
  });
  it("does not overwrite a destination collision or publish an already cancelled selection", async () => {
    let path = "";
    let once = true;
    const h = await setup((point) => {
      if (once && point === "copy:before_publish") {
        once = false;
        writeFileSync(path, "existing user file");
      }
    });
    const store = h.runtime.materials as MaterialStore;
    const create = store.create.bind(store);
    vi.spyOn(store, "create").mockImplementation(async (input) => {
      const row = await create(input);
      path = join(h.workspaceRoot, row.path);
      return row;
    });
    const source = h.source();
    await expect(h.import([source])).rejects.toThrow("changed");
    expect(readFileSync(path, "utf8")).toBe("existing user file");
    expect((await h.manager.list(h.workspaceRoot))[0]?.state).toBe("pending");
    const controller = new AbortController();
    controller.abort();
    await expect(h.import([source], controller.signal)).rejects.toThrow();
    expect(
      await h.manager.selected({ sessionId: h.sessionId, workspaceRoot: h.workspaceRoot }),
    ).toEqual([]);
    expect(readdirSync(join(h.workspaceRoot, "moyyi-materials"))).toHaveLength(1);
  });
  it("recycles selection without destroying referenced copies, restores missing copies, and blocks purge", async () => {
    const h = await setup();
    let record = (await h.import([h.source()]))[0] as StoredMaterial;
    record = await h.manager.recycle(h.operation(record));
    expect(existsSync(join(h.workspaceRoot, record.path))).toBe(true);
    expect(
      await h.manager.selected({ sessionId: h.sessionId, workspaceRoot: h.workspaceRoot }),
    ).toEqual([]);
    await expect(h.manager.purge(h.operation(record))).rejects.toThrow("unreferenced");
    unlinkSync(join(h.workspaceRoot, record.path));
    record = await h.manager.restore(h.operation(record));
    expect(readFileSync(join(h.workspaceRoot, record.path), "utf8")).toBe("first captured version");
    writeFileSync(join(h.workspaceRoot, record.path), "user edit");
    await expect(
      h.manager.attach({
        sessionId: h.sessionId,
        workspaceRoot: h.workspaceRoot,
        ids: [record.id],
      }),
    ).rejects.toThrow("changed");
    expect(Buffer.from(await h.manager.read(h.operation(record))).toString()).toBe(
      "first captured version",
    );
    record = await h.manager.recycle(h.operation(record));
    await expect(h.manager.restore(h.operation(record))).rejects.toThrow("changed");
    expect(readFileSync(join(h.workspaceRoot, record.path), "utf8")).toBe("user edit");
  });
  it("keeps housekeeping off and only soft-recycles old unreferenced originals when enabled", async () => {
    const h = await setup();
    const id = `material_${randomUUID()}`;
    let row = await (h.runtime.materials as MaterialStore).create({
      id,
      workspaceRoot: h.workspaceRoot,
      path: `moyyi-materials/${id}.txt`,
      name: "old.txt",
      format: "txt",
      bytes: Buffer.from("retained"),
      createdAt: "2020-01-01T00:00:00.000Z",
    });
    row = await h.manager.restore(h.operation(row));
    expect(await h.manager.housekeeping({ workspaceRoot: h.workspaceRoot })).toEqual([]);
    await h.manager.setHousekeeping(h.workspaceRoot, true);
    const recycled = await h.manager.housekeeping({ workspaceRoot: h.workspaceRoot });
    expect(recycled.map((value) => value.id)).toEqual([row.id]);
    expect(existsSync(join(h.workspaceRoot, row.path))).toBe(true);
    const cleared = await h.manager.purge(h.operation(recycled[0] as StoredMaterial));
    expect(cleared.state).toBe("purged");
    expect(existsSync(join(h.workspaceRoot, row.path))).toBe(false);
  });
});
