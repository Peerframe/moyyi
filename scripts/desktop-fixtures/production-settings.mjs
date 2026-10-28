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
  assert(
    readFileSync(join(appDirectory, "main.mjs"), "utf8").includes("./bridge.mjs"),
    "The native main and this probe must import the same production DesktopProcess boundary",
  );
  const { DesktopProcess } = await import(new URL("../bridge.mjs", import.meta.url));
  async function launch() {
    let child, state, counters;
    let stderr = "";
    const originalFork = childProcess.fork;
    // Instrument only process launch and the guard's out-of-band counters. Every production
    // state/ACK/fatal message passes through the actual DesktopProcess validator and lifecycle.
    childProcess.fork = (module, args, options) => {
      assert.equal(module, join(appDirectory, "worker.mjs"));
      assert.deepEqual(args, []);
      assert.equal(options.execPath, process.execPath);
      assert.deepEqual(options.execArgv, []);
      child = originalFork(module, args, {
        ...options,
        execArgv: ["--no-experimental-strip-types", "--import", self],
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
    let desktop;
    try {
      desktop = new DesktopProcess(appDirectory, process.execPath, (next) => {
        state = next;
      });
    } finally {
      childProcess.fork = originalFork;
      syncBuiltinESMExports();
    }
    assert(child, "DesktopProcess must launch the actual installed worker");
    const exited = new Promise((resolve) =>
      child.once("exit", (code, signal) => resolve({ code, signal })),
    );
    async function close() {
      try {
        await bounded(desktop.close(), "DesktopProcess close");
        const result = await bounded(exited, "worker exit");
        assert.equal(result.code, 0, stderr);
      } catch (error) {
        child.kill("SIGKILL");
        await exited;
        throw error;
      }
      assert(counters, "The no-secret/network guard must initialize before the worker");
      for (const key of Object.keys(totals)) totals[key] += counters[key];
    }
    try {
      await bounded(desktop.getState(), "DesktopProcess initial state");
      assert(counters, "Guard initialization must precede initial production state");
    } catch (error) {
      if (child.connected) child.disconnect();
      child.kill("SIGKILL");
      await exited;
      throw error;
    }
    return {
      state: () => state,
      request: (command) => bounded(desktop.send(command), command.type),
      getState: () => desktop.getState(),
      injectState: (next) => child.emit("message", { type: "state", state: next }),
      close,
    };
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
    const reviewed = { ...high, answerReview: true };
    await worker.request({ type: "configure", settings: reviewed });
    await worker.close();
    worker = await launch();
    assert.deepEqual(worker.state().settings, reviewed);
    assert.equal(worker.state().budgets.maxRequests, 8);
    assert.deepEqual(worker.state().permissions, { writes: false, checks: false });
    await assert.rejects(
      worker.request({
        type: "configure",
        settings: { ...reviewed, maxRequests: 3 },
      }),
    );
    assert.deepEqual(JSON.parse(readFileSync(savedPath, "utf8")).settings, reviewed);
    cases.push(
      "explicit evidence review persists without new requests, rejects insufficient total budget, and grants no authority",
    );
    const validState = await worker.getState();
    worker.injectState({
      ...validState,
      settings: { ...validState.settings, answerReview: "true" },
    });
    await assert.rejects(worker.getState(), /无效数据|意外停止/);
    await worker.close();
    worker = await launch();
    assert.deepEqual(worker.state().settings, reviewed);
    assert.equal(worker.state().connection.ready, false);
    cases.push(
      "actual DesktopProcess accepts review-enabled save/restart state and rejects nonboolean worker settings before forwarding",
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
