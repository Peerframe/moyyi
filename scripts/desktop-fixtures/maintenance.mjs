import assert from "node:assert/strict";
import childProcess, { fork } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { join } from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import { UNKNOWN_USAGE } from "moyyi/contracts";
import { createRuntime } from "moyyi/runtime";

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && realpathSync(process.argv[1]) === self) await verify();
else installGuard();
function installGuard() {
  const counts = { nativeCalls: 0, networkAttempts: 0 };
  const publish = () => process.send?.({ type: "maintenance.guard", counts: { ...counts } });
  for (const method of [
    "exec",
    "execSync",
    "execFile",
    "execFileSync",
    "spawn",
    "spawnSync",
    "fork",
  ])
    childProcess[method] = () => {
      counts.nativeCalls++;
      publish();
      throw Error("Maintenance fixture forbids credential/native subprocesses");
    };
  const deny = () => {
    counts.networkAttempts++;
    publish();
    throw Error("Maintenance fixture forbids network");
  };
  globalThis.fetch = deny;
  http.request = http.get = https.request = https.get = deny;
  net.connect = net.createConnection = net.Socket.prototype.connect = tls.connect = deny;
  syncBuiltinESMExports();
  publish();
}
async function verify() {
  // External fixture only: the shipped helper and runtime use real SQLite and public exports.
  // The maintenance helper never starts a model run, imports a source checkout or reads a Keychain credential.
  assert.equal(process.version, "v26.12.1");
  const [home, workspace] = process.argv.slice(2);
  assert(home && workspace && !existsSync(home), "A fresh isolated HOME is required");
  mkdirSync(home, { mode: 0o700 });
  mkdirSync(workspace, { recursive: true, mode: 0o700 });
  const directory = fileURLToPath(new URL("..", import.meta.url));
  const helper = join(directory, "maintenance-worker.mjs");
  assert(existsSync(helper));
  assert(
    import.meta
      .resolve("moyyi/runtime")
      .startsWith(new URL("../node_modules/moyyi/", import.meta.url).href),
  );
  assert(!existsSync(join(directory, "node_modules/moyyi/src")));
  const dataDirectory = join(home, ".moyyi/deepseek-data");
  const settingsDirectory = join(home, ".moyyi/desktop");
  mkdirSync(settingsDirectory, { recursive: true, mode: 0o700 });
  const settingsPath = join(settingsDirectory, "settings.json");
  // Keep the format-1 seed: format-2 desktop must still back up and restore older settings
  // byte-for-byte without migrating them during maintenance or restoring execution authority.
  const settings = JSON.stringify({
    format: 1,
    settings: { preset: "flash", maxRequests: 3, timeoutMs: 120000 },
    credentials: {},
  });
  writeFileSync(settingsPath, settings, { mode: 0o600 });
  const canary = join(workspace, "keep.txt");
  writeFileSync(canary, "WORKSPACE_UNCHANGED");
  const cases = [];
  let modelCalls = 0;
  let credentialReads = 0;
  const origin = { provider: "installed-maintenance-fixture", model: "never-run" };
  const plugin = {
    name: origin.provider,
    apiVersion: 1,
    setup(registry) {
      registry.registerModelProvider({
        id: origin.provider,
        models: [
          {
            origin,
            contextWindowTokens: 200000,
            maxOutputTokens: 8192,
            parallelToolCalls: false,
            reasoning: "visible",
            promptCache: "none",
            editFormat: "search_replace",
          },
        ],
        createClient() {
          return {
            async *stream() {
              modelCalls++;
              if (modelCalls !== 1)
                throw Error("Only the initial fixture seed may call a scripted model");
              yield {
                type: "part_completed",
                index: 0,
                part: { type: "text", text: "PERSISTED_SYNTHETIC_HISTORY" },
              };
              yield {
                type: "completed",
                stopReason: "end_turn",
                providerStopReason: null,
                usage: UNKNOWN_USAGE,
              };
            },
          };
        },
      });
    },
  };
  const runtimeOptions = {
    dataDirectory,
    model: origin,
    plugins: [{ plugin }],
    deepseek: {
      getApiKey() {
        credentialReads++;
        throw Error("No credentials allowed");
      },
    },
  };
  async function createSession(seed = false) {
    const runtime = await createRuntime(runtimeOptions);
    let sessionId;
    runtime.subscribe((event) => {
      if (event.type === "session.ready") sessionId = event.sessionId;
    });
    try {
      await runtime.send({ type: "session.create", workspaceRoot: workspace });
      assert(sessionId);
      if (seed) {
        await runtime.send({
          type: "run.start",
          sessionId,
          input: [{ type: "text", text: "Seed a deterministic maintenance fixture" }],
        });
        await runtime.idle();
      }
      return sessionId;
    } finally {
      await runtime.close();
    }
  }
  async function invoke(request) {
    const child = fork(helper, [], {
      execPath: process.execPath,
      execArgv: ["--import", self],
      env: { HOME: home, PATH: "/usr/bin:/bin" },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });
    let output = "";
    child.stderr.on("data", (chunk) => {
      output = `${output}${chunk}`.slice(-8192);
    });
    const messages = [];
    let timer;
    const result = await new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        child.kill("SIGTERM");
        reject(Error("Maintenance fixture timeout"));
      }, 30000);
      child.on("message", (message) => {
        messages.push(message);
        if (message.type === "ready") child.send({ type: "request", id: 1, request });
      });
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        clearTimeout(timer);
        if (code !== 0 || signal)
          reject(Error(`Maintenance helper exit ${code}/${signal}: ${output}`));
        else
          resolve(
            messages.find((message) => message.type === "result" || message.type === "error"),
          );
      });
    });
    assert(result, `No terminal maintenance message: ${output}`);
    const guards = messages.filter((item) => item.type === "maintenance.guard");
    assert(guards.length > 0, "Actual helper must load the no-network/no-native guard");
    for (const guard of guards)
      assert.deepEqual(guard.counts, { nativeCalls: 0, networkAttempts: 0 });
    return result;
  }
  const seedSession = await createSession(true);
  assert.equal(modelCalls, 1);
  const lockInode = statSync(join(dataDirectory, "writer-lock.sqlite")).ino;
  const destination = join(home, "backup");
  const backup = await invoke({ mode: "backup", destination });
  assert.equal(backup.type, "result");
  assert.equal(backup.result.sessionCount, 1);
  assert.equal(backup.result.credentialsExported, false);
  assert.equal(statSync(destination).mode & 0o777, 0o700);
  assert.equal(readFileSync(join(destination, "settings.json"), "utf8"), settings);
  assert(!readdirSync(join(destination, "store")).includes("writer-lock.sqlite"));
  assert(
    readdirSync(join(destination, "store/blobs")).length > 0,
    "Actual request blobs must be included",
  );
  cases.push("installed helper creates private consistent SQLite/blob backup without credentials");
  await createSession();
  const newerSettings = settings.replace('"maxRequests":3', '"maxRequests":4');
  writeFileSync(settingsPath, newerSettings);
  const restored = await invoke({ mode: "restore", backupPath: destination });
  assert.equal(restored.type, "result");
  assert.equal(restored.result.sessionCount, 1);
  assert(restored.result.rescuePath);
  assert.equal(readFileSync(settingsPath, "utf8"), newerSettings);
  assert.equal(statSync(join(dataDirectory, "writer-lock.sqlite")).ino, lockInode);
  assert.equal(readFileSync(canary, "utf8"), "WORKSPACE_UNCHANGED");
  cases.push(
    "restore preserves settings/workspace/lock inode and publishes rescue before replacement",
  );
  const rescue = await invoke({ mode: "restore", backupPath: restored.result.rescuePath });
  assert.equal(rescue.type, "result");
  assert.equal(rescue.result.sessionCount, 2);
  cases.push("rescue backup restores later sessions through the same public workflow");
  const reader = await createRuntime(runtimeOptions);
  const entries = [];
  reader.subscribe((event) => {
    if (event.type === "entry.appended") entries.push(event.entry);
  });
  try {
    await reader.send({ type: "session.load", sessionId: seedSession });
  } finally {
    await reader.close();
  }
  assert(
    entries.some(
      (entry) =>
        entry.body.kind === "assistant_message" &&
        entry.body.content.some(
          (part) => part.type === "text" && part.text === "PERSISTED_SYNTHETIC_HISTORY",
        ),
    ),
  );
  cases.push("actual transcript and referenced request blobs reopen without replay");
  const owner = await createRuntime(runtimeOptions);
  try {
    const locked = await invoke({ mode: "backup", destination: join(home, "locked") });
    assert.equal(locked.type, "error");
    assert(!existsSync(join(home, "locked")));
  } finally {
    await owner.close();
  }
  cases.push("a second process cannot back up while the normal runtime holds its writer lock");
  writeFileSync(join(destination, "settings.json"), "tampered");
  const invalid = await invoke({ mode: "restore", backupPath: destination });
  assert.equal(invalid.type, "error");
  assert.equal(readFileSync(settingsPath, "utf8"), newerSettings);
  cases.push("tampered backup is refused without overwriting current settings");
  const denied = await invoke({ mode: "shell", command: "not-a-supported-mode" });
  assert.equal(denied.type, "error");
  cases.push("helper rejects generic commands and unrecognized fields");
  assert.equal(modelCalls, 1);
  assert.equal(credentialReads, 0);
  console.log(
    JSON.stringify({
      passed: true,
      cases,
      seedSyntheticModelRequests: modelCalls,
      maintenanceModelRequests: 0,
      credentialReads,
      helperNativeCalls: 0,
      helperNetworkAttempts: 0,
      workspaceUnchanged: true,
      dataDirectory,
      softwareRollback: "separate native/app-copy acceptance; this fixture covers data/helper only",
    }),
  );
}
