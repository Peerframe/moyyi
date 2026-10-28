import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

// Real installed DesktopProcess and unchanged production worker. The existing preload only
// denies secrets/network and reports counters; it never changes material scheduling or state.
assert.equal(process.version, "v26.12.1");
const [workspace, external, home] = process.argv.slice(2);
assert(workspace && external && home && !existsSync(home));
mkdirSync(home, { mode: 0o700 });
const directory = fileURLToPath(new URL("..", import.meta.url));
const guard = fileURLToPath(new URL("./production-settings.mjs", import.meta.url));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const paths = Array.from({ length: 8 }, (_, i) => {
  const path = join(external, `cancel-${i}.pdf`);
  writeFileSync(path, Buffer.alloc(10 * 1024 * 1024, i + 1), { flag: "wx", mode: 0o600 });
  return path;
});
const originals = new Map(paths.map((path) => [path, digest(readFileSync(path))]));
const { DesktopProcess } = await import(new URL("../bridge.mjs", import.meta.url));
const originalFork = childProcess.fork;
let child, counters, state, desktop, cancel, sessionId;
let armCancel = false;
let stderr = "";
childProcess.fork = (module, args, options) => {
  assert.equal(module, join(directory, "worker.mjs"));
  assert.deepEqual(options.execArgv, []);
  child = originalFork(module, args, {
    ...options,
    execArgv: ["--no-experimental-strip-types", "--import", guard],
    env: { ...options.env, HOME: home },
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  const emit = child.emit;
  child.emit = function (event, ...values) {
    if (event === "message" && values[0]?.type === "probe.guard") {
      counters = values[0].counts;
      return true;
    }
    return emit.call(this, event, ...values);
  };
  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-4096);
  });
  return child;
};
syncBuiltinESMExports();
try {
  desktop = new DesktopProcess(directory, process.execPath, (next) => {
    state = next;
    if (armCancel && next.importing === true) {
      armCancel = false;
      cancel = desktop.send({ type: "material.cancel", sessionId });
      void cancel.catch(() => {});
    }
  });
} finally {
  childProcess.fork = originalFork;
  syncBuiltinESMExports();
}
assert(child);
const exited = new Promise((resolve) => child.once("exit", (code) => resolve(code)));
async function bounded(promise) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(`Material IPC probe timed out: ${stderr}`)), 30000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
let closed = false;
try {
  await bounded(desktop.getState());
  assert.equal(state.connection.ready, false);
  assert.equal(state.settings.preset, "flash");
  const created = await bounded(
    desktop.send({ type: "create", workspaceRoot: workspace, askEachRead: false }),
  );
  sessionId = created.activeSessionId;
  assert(sessionId);
  armCancel = true;
  await assert.rejects(
    bounded(desktop.send({ type: "materials.import", sessionId, paths })),
    /cancelled/i,
  );
  assert(cancel, "The real importing state must trigger a separate cancel IPC request");
  await bounded(cancel);
  assert.equal(state.importing, false);
  await bounded(desktop.send({ type: "library", sessionId, offset: 0 }));
  assert.deepEqual(state.materials, [], "Cancelled batch must not be reported as selected");
  const rows = state.library.items;
  let recoveredPending = 0;
  for (const row of rows) {
    assert(["pending", "active"].includes(row.state));
    assert.equal(row.referenceCount, 0);
    assert.equal(row.sha256, originals.get(join(external, row.name)));
    const copy = join(workspace, row.path);
    if (existsSync(copy)) assert.equal(digest(readFileSync(copy)), row.sha256);
    if (row.state === "pending") {
      await bounded(
        desktop.send({ type: "material.restore", sessionId, id: row.id, revision: row.revision }),
      );
      assert.equal(digest(readFileSync(copy)), row.sha256);
      recoveredPending++;
    }
  }
  const copies = join(workspace, "moyyi-materials");
  if (existsSync(copies)) assert(readdirSync(copies).every((name) => !name.startsWith(".import-")));
  for (const [path, hash] of originals) assert.equal(digest(readFileSync(path)), hash);
  assert.deepEqual(state.permissions, { writes: false, checks: false });
  await bounded(desktop.close());
  assert.equal(await bounded(exited), 0, stderr);
  closed = true;
  assert(counters);
  for (const key of [
    "credentialReads",
    "credentialWrites",
    "forbiddenNativeCalls",
    "networkAttempts",
  ])
    assert.equal(counters[key], 0);
  const db = new DatabaseSync(join(home, ".moyyi/deepseek-data/data.sqlite"), { readOnly: true });
  let modelRequests;
  try {
    modelRequests = db
      .prepare(
        "SELECT count(*) AS n FROM entries WHERE json_extract(payload,'$.body.kind')='assistant_message'",
      )
      .get().n;
    assert.equal(modelRequests, 0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM runs").get().n, 0);
  } finally {
    db.close();
  }
  console.log(
    JSON.stringify({
      passed: true,
      actualProductionWorker: true,
      actualDesktopProcess: true,
      cancelled: true,
      retainedRows: rows.length,
      recoveredPending,
      modelRequests,
      credentialReads: counters.credentialReads,
      credentialWrites: counters.credentialWrites,
      networkAttempts: counters.networkAttempts,
      metadataChecks: counters.metadataChecks,
      liveModel: false,
    }),
  );
} finally {
  if (!closed) {
    if (child.connected) child.disconnect();
    child.kill("SIGKILL");
    await exited;
  }
}
