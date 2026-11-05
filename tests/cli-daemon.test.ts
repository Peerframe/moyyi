import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const entry = resolve("src/cli/main.ts");
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "moyyi-cd-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "w"),
    data = join(root, "d");
  mkdirSync(workspace);
  writeFileSync(join(workspace, "README.md"), "Synthetic daemon fixture.\n");
  return { workspace, data };
}

function startDaemon(args: string[]): Promise<{ child: ChildProcess; output: () => string }> {
  const child = spawn(process.execPath, [entry, "--daemon", ...args], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  cleanups.push(() => child.kill("SIGKILL"));
  let output = "";
  child.stdout?.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr?.on("data", (chunk) => {
    output += chunk;
  });
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(Error(`Daemon did not start: ${output}`)), 8000);
    const check = setInterval(() => {
      if (output.includes("daemon | Serving")) {
        clearInterval(check);
        clearTimeout(timer);
        resolvePromise({ child, output: () => output });
      }
    }, 20);
    child.on("exit", () => {
      clearInterval(check);
      clearTimeout(timer);
      reject(Error(`Daemon exited: ${output}`));
    });
  });
}

function connectRun(args: string[]) {
  const result = spawnSync(process.execPath, [entry, "--connect", ...args], {
    encoding: "utf8",
    timeout: 10000,
  });
  expect(result.error).toBeUndefined();
  return result;
}

describe("CLI daemon and connected clients as real processes", () => {
  it("serves prompts to connected clients, resumes sessions and stops cleanly", async () => {
    const f = fixture();
    const d = await startDaemon(["--demo", "-C", f.workspace, "--data", f.data]);
    expect(d.output()).toContain(join(f.data, "daemon.sock"));
    const first = connectRun(["--data", f.data, "Inspect the README"]);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain("daemon | Connected");
    expect(first.stdout).toContain("Offline scripted demonstration.");
    const id = /session \| (session_[\w-]+)/.exec(first.stdout)?.[1];
    expect(id).toBeTruthy();
    const second = connectRun(["--data", f.data, "--session", id as string, "Continue"]);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain(id as string);
    // While the daemon holds the store, a local CLI on the same data directory cannot open it.
    const local = spawnSync(
      process.execPath,
      [entry, "--demo", "-C", f.workspace, "--data", f.data, "Hi"],
      { encoding: "utf8", timeout: 10000 },
    );
    expect(local.status).toBe(1);
    const exited = new Promise<number | null>((done) => d.child.on("exit", (code) => done(code)));
    d.child.kill("SIGINT");
    expect(await exited).toBe(0);
    expect(existsSync(join(f.data, "daemon.sock"))).toBe(false);
    expect(existsSync(join(f.data, "daemon-token"))).toBe(false);
  }, 30_000);

  it("explains a missing daemon and refuses client grant flags before connecting", () => {
    const f = fixture();
    const missing = connectRun(["--data", f.data, "Hi"]);
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("Start one with moyyi --daemon");
    const widened = connectRun(["--data", f.data, "--allow-write", "Hi"]);
    expect(widened.status).toBe(2);
    expect(widened.stderr).toContain("daemon's host");
  });

  it("denies a noninteractive client's approval request through the daemon", async () => {
    const f = fixture();
    const d = await startDaemon(["--demo", "--approve-reads", "-C", f.workspace, "--data", f.data]);
    const result = connectRun(["--data", f.data, "Inspect"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Noninteractive mode denies");
    expect(result.stdout).not.toContain(": succeeded");
    d.child.kill("SIGTERM");
  }, 30_000);
});
