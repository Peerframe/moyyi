import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { join } from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

// Preload only guards external I/O; the child runs the unchanged installed production worker.
const self = fileURLToPath(import.meta.url);
if (process.argv[1] === self) await verify();
else installGuard();

function installGuard() {
  const counts = {
    metadataChecks: 0,
    credentialReads: 0,
    credentialWrites: 0,
    forbiddenNativeCalls: 0,
    networkAttempts: 0,
  };
  const publish = () => process.send?.({ type: "probe.guard", counts: { ...counts } });
  const originalExecFile = childProcess.execFile;
  const originalExecute = promisify(originalExecFile);
  const isolatedKeychain = join(process.env.HOME, "Library/Keychains/login.keychain-db");
  const expected = ["moyyi.deepseek.api-key", "moyyi.kimi.cn.api-key"].map((service) => [
    "find-generic-password",
    "-a",
    "moyyi",
    "-s",
    service,
    isolatedKeychain,
  ]);
  function checkNative(file, args) {
    // Only a metadata lookup against a nonexistent, explicit isolated-HOME keychain is allowed.
    if (
      file === "/usr/bin/security" &&
      expected.some((command) => JSON.stringify(args) === JSON.stringify(command)) &&
      !existsSync(isolatedKeychain)
    ) {
      counts.metadataChecks++;
      publish();
      return;
    }
    counts.forbiddenNativeCalls++;
    if (Array.isArray(args) && (args.includes("-w") || args[0] === "read"))
      counts.credentialReads++;
    if (Array.isArray(args) && ["add", "delete"].includes(args[0])) counts.credentialWrites++;
    publish();
    throw Error("Native call forbidden by the no-secret production probe");
  }
  const guardedExecFile = (...args) => {
    checkNative(args[0], args[1]);
    return originalExecFile(...args);
  };
  guardedExecFile[promisify.custom] = async (...args) => {
    checkNative(args[0], args[1]);
    return originalExecute(...args);
  };
  childProcess.execFile = guardedExecFile;
  for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFileSync", "fork"])
    childProcess[name] = (...args) => {
      counts.forbiddenNativeCalls++;
      if (Array.isArray(args[1]) && ["add", "delete"].includes(args[1][0]))
        counts.credentialWrites++;
      publish();
      throw Error("Additional processes are forbidden by the production probe");
    };
  const denyNetwork = () => {
    counts.networkAttempts++;
    publish();
    throw Error("Network access is forbidden by the production probe");
  };
  globalThis.fetch = denyNetwork;
  globalThis.WebSocket = class {
    constructor() {
      denyNetwork();
    }
  };
  http.request = http.get = https.request = https.get = denyNetwork;
  net.connect = net.createConnection = net.Socket.prototype.connect = tls.connect = denyNetwork;
  syncBuiltinESMExports();
  publish();
}

async function verify() {
  assert.equal(process.version, "v26.12.1");
  const [workspace, home] = process.argv.slice(2);
  assert(workspace && home && !existsSync(home), "A fresh isolated HOME is required");
  mkdirSync(home, { mode: 0o700 });
  const appDirectory = fileURLToPath(new URL("..", import.meta.url));
  const cases = [];
  const totals = {
    metadataChecks: 0,
    credentialReads: 0,
    credentialWrites: 0,
    forbiddenNativeCalls: 0,
    networkAttempts: 0,
  };
  async function bounded(promise, label) {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error(`Production settings timeout: ${label}`)), 20_000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  // Same command/state/ACK lifecycle as the existing M1 production-worker acceptance case.
  async function launch() {
    const child = childProcess.fork(join(appDirectory, "worker.mjs"), [], {
      execPath: process.execPath,
      execArgv: ["--no-experimental-strip-types", "--import", self],
      cwd: appDirectory,
      env: { HOME: home, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "en_US.UTF-8" },
      stdio: ["ignore", "ignore", "pipe", "ipc"],
      serialization: "json",
    });
    let state, failure, counters;
    let sequence = 0;
    let stderr = "";
    const pending = new Map();
    const observers = new Set();
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-4096);
    });
    child.on("error", (error) => {
      failure = error;
      for (const observer of observers) observer();
    });
    child.on("message", (message) => {
      if (message.type === "state") state = message.state;
      else if (message.type === "probe.guard") counters = message.counts;
      else if (message.type === "fatal") failure = Error(message.message);
      else if (message.type === "ack") {
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        message.error ? request.reject(Error(message.error)) : request.resolve(state);
      }
      for (const observer of observers) observer();
    });
    const exited = new Promise((resolve) =>
      child.once("exit", (code, signal) => {
        failure ??= Error(`Worker exited: ${code}/${signal} ${stderr}`);
        for (const request of pending.values()) request.reject(failure);
        pending.clear();
        for (const observer of observers) observer();
        resolve({ code, signal });
      }),
    );
    async function request(command) {
      assert(child.connected);
      return bounded(
        new Promise((resolve, reject) => {
          const id = ++sequence;
          pending.set(id, { resolve, reject });
          child.send({ type: "command", id, command }, (error) => {
            if (error) {
              pending.delete(id);
              reject(error);
            }
          });
        }),
        command.type,
      );
    }
    async function close() {
      let acknowledgementError;
      try {
        if (child.connected && !failure) await request({ type: "close" });
      } catch (error) {
        acknowledgementError = error;
      }
      if (child.connected) child.disconnect();
      try {
        assert.equal((await bounded(exited, "exit")).code, 0);
      } catch (error) {
        child.kill("SIGKILL");
        await exited;
        throw error;
      }
      assert(counters, "The no-secret/network guard must initialize before the worker");
      for (const key of Object.keys(totals)) totals[key] += counters[key];
      if (acknowledgementError) throw acknowledgementError;
    }
    try {
      await bounded(
        new Promise((resolve, reject) => {
          const check = () => {
            if (failure) {
              observers.delete(check);
              reject(failure);
            } else if (state && counters) {
              observers.delete(check);
              resolve();
            }
          };
          observers.add(check);
          check();
        }),
        "initial state",
      );
    } catch (error) {
      if (child.connected) child.disconnect();
      child.kill("SIGKILL");
      await exited;
      throw error;
    }
    return { state: () => state, request, close };
  }
  let worker = await launch();
  let sessionId;
  const settings = { preset: "flash", maxRequests: 4, timeoutMs: 120_000 };
  const high = {
    preset: "kimi-cn",
    kimiReasoningEffort: "high",
    maxRequests: 8,
    timeoutMs: 300_000,
  };
  const savedPath = join(home, ".moyyi/desktop/settings.json");
  try {
    assert.equal(worker.state().connection.ready, false);
    assert.equal(worker.state().settings.maxRequests, 3);
    assert.equal(worker.state().budgets.maxRequests, 3);
    assert(!existsSync(savedPath), "Startup must not write default settings");
    const created = await worker.request({
      type: "create",
      workspaceRoot: workspace,
      askEachRead: false,
    });
    sessionId = created.activeSessionId;
    assert(sessionId);
    cases.push("production worker starts with Flash/3 and no stored credential or settings file");
    const saved = await worker.request({ type: "configure", settings });
    assert.deepEqual(saved.settings, settings);
    assert.equal(saved.budgets.maxRequests, 4);
    assert.equal(saved.activeSessionId, sessionId);
    assert.equal(saved.connection.ready, false);
    assert.equal(saved.run, null);
    assert.equal(saved.messages.length, 0);
    assert.deepEqual(JSON.parse(readFileSync(savedPath, "utf8")), {
      format: 1,
      settings,
      credentials: {},
    });
    assert.equal(statSync(savedPath).mode & 0o777, 0o600);
    cases.push(
      "configure persists maxRequests=4 without a credential and restores the current session",
    );
  } finally {
    await worker.close();
  }
  worker = await launch();
  try {
    assert.deepEqual(worker.state().settings, settings);
    assert.equal(worker.state().budgets.maxRequests, 4);
    assert.equal(worker.state().connection.ready, false);
    assert(worker.state().sessions.items.some((item) => item.sessionId === sessionId));
    await worker.request({ type: "load", sessionId, askEachRead: false });
    assert.equal(worker.state().activeSessionId, sessionId);
    assert.equal(worker.state().budgets.maxRequests, 4);
    assert.equal(worker.state().messages.length, 0);
    assert.equal(worker.state().reportTarget, null);
    assert.equal(worker.state().pendingApproval, null);
    cases.push(
      "fresh production process restores Flash/4 and the same SQLite session without replay",
    );
    await assert.rejects(
      worker.request({ type: "start", sessionId, text: "Must not call a model" }),
      /unavailable/,
    );
    assert.equal(worker.state().run, null);
    assert.equal(worker.state().messages.length, 0);
    cases.push(
      "missing credentials reject start before secret reads or network calls; both processes exit cleanly",
    );
    await worker.request({ type: "permissions", sessionId, writes: true, checks: false });
    assert.equal(worker.state().permissions.writes, true);
    const selected = await worker.request({ type: "configure", settings: high });
    assert.deepEqual(selected.settings, high);
    assert.equal(selected.budgets.maxRequests, 8);
    assert.equal(selected.budgets.timeoutMs, 300_000);
    assert.deepEqual(selected.permissions, { writes: false, checks: false });
    assert.equal(selected.activeSessionId, sessionId);
    assert.equal(selected.messages.length, 0);
    assert.deepEqual(JSON.parse(readFileSync(savedPath, "utf8")).settings, high);
  } finally {
    await worker.close();
  }
  worker = await launch();
  try {
    assert.deepEqual(worker.state().settings, high);
    assert.equal(worker.state().budgets.maxRequests, 8);
    assert.equal(worker.state().budgets.timeoutMs, 300_000);
    assert.equal(worker.state().connection.ready, false);
    assert.deepEqual(worker.state().permissions, { writes: false, checks: false });
    await worker.request({ type: "load", sessionId, askEachRead: false });
    await assert.rejects(
      worker.request({ type: "start", sessionId, text: "Must remain offline with high selected" }),
      /unavailable/,
    );
    assert.equal(worker.state().messages.length, 0);
    cases.push(
      "explicit Kimi high persists/restarts at 8 requests/300 seconds without credentials, replay or restored grants",
    );
    await worker.request({
      type: "configure",
      settings: { ...high, kimiReasoningEffort: "low" },
    });
    assert.deepEqual(JSON.parse(readFileSync(savedPath, "utf8")).settings, {
      preset: "kimi-cn",
      maxRequests: 8,
      timeoutMs: 300_000,
    });
    await worker.request({ type: "configure", settings });
    assert.deepEqual(JSON.parse(readFileSync(savedPath, "utf8")).settings, settings);
  } finally {
    await worker.close();
  }
  worker = await launch();
  try {
    assert.deepEqual(worker.state().settings, settings);
    assert.equal(worker.state().budgets.maxRequests, 4);
    assert.equal(worker.state().connection.ready, false);
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(savedPath, "utf8")).settings).sort(), [
      "maxRequests",
      "preset",
      "timeoutMs",
    ]);
    cases.push(
      "returning to low/Flash writes the legacy three-field settings and restarts with Flash/4",
    );
  } finally {
    await worker.close();
  }
  assert(totals.metadataChecks >= 3);
  for (const key of [
    "credentialReads",
    "credentialWrites",
    "forbiddenNativeCalls",
    "networkAttempts",
  ])
    assert.equal(totals[key], 0, key);
  console.log(
    JSON.stringify({
      passed: true,
      count: cases.length,
      cases,
      savedMaxRequests: 4,
      restoredMaxRequests: 4,
      ...totals,
      liveModel: false,
    }),
  );
}
