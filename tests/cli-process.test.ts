import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const entry = resolve("src/cli/main.ts");
const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "moyyi-cli-process-"));
  roots.push(root);
  const workspace = join(root, "workspace"),
    data = join(root, "private");
  mkdirSync(workspace);
  writeFileSync(join(workspace, "README.md"), "Synthetic CLI fixture.\n");
  return { root, workspace, data };
}
function run(args: string[], input = "") {
  const result = spawnSync(process.execPath, [entry, ...args], {
    encoding: "utf8",
    input,
    timeout: 10000,
    maxBuffer: 1024 * 1024,
  });
  expect(result.error).toBeUndefined();
  return result;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
describe("CLI process through actual runtime", () => {
  it("supports help and version without configuring a model", () => {
    expect(run(["--help"]).stdout).toContain("--host FILE");
    expect(run(["--version"]).stdout.trim()).toBe("0.0.0");
    expect(run([]).status).toBe(2);
  });
  it("runs a real read, preserves a session and resumes it", () => {
    const f = fixture(),
      args = ["--demo", "-C", f.workspace, "--data", f.data];
    const first = run([...args, "Inspect the README"]);
    expect(first.status).toBe(0);
    expect(first.stdout).toContain("tool result |");
    expect(first.stdout).toContain("succeeded");
    expect(first.stdout).toContain("Offline scripted demonstration.");
    const id = /session \| (session_[\w-]+)/.exec(first.stdout)?.[1];
    expect(id).toBeTruthy();
    expect(existsSync(f.data)).toBe(true);
    const second = run([...args, "--session", id as string, "Continue"]);
    expect(second.status).toBe(0);
    expect(second.stdout).toContain(id as string);
    expect(second.stdout).not.toContain("already active");
  });
  it("accepts one bounded piped prompt and does not cancel on already-consumed EOF", () => {
    const f = fixture();
    const result = run(["--demo", "-C", f.workspace, "--data", f.data], "Hello\nworld\n");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("succeeded");
  });
  it("denies noninteractive approvals instead of hanging or granting", () => {
    const f = fixture();
    const result = run([
      "--demo",
      "--approve-reads",
      "-C",
      f.workspace,
      "--data",
      f.data,
      "Inspect",
    ]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Noninteractive mode denies");
    expect(result.stdout).toContain("denied");
    expect(result.stdout).not.toContain(": succeeded");
  });
  it("rejects interactive pipes and oversize input before creating storage", () => {
    const f = fixture();
    expect(run(["--demo", "--interactive", "--data", f.data], "hello").status).toBe(2);
    expect(run(["--demo", "--data", f.data], "x".repeat(65537)).status).toBe(2);
    expect(existsSync(f.data)).toBe(false);
  });
  it("never discovers project code and redacts explicit host import errors", () => {
    const f = fixture();
    const sentinel = join(f.root, "should-not-exist");
    writeFileSync(
      join(f.workspace, "moyyi.config.mjs"),
      `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(sentinel)},'bad');`,
    );
    expect(run(["--demo", "-C", f.workspace, "--data", f.data, "Inspect"]).status).toBe(0);
    expect(existsSync(sentinel)).toBe(false);
    const host = join(f.root, "host.mjs");
    writeFileSync(host, "throw Error('Bearer synthetic-secret');");
    const bad = run([
      "--host",
      host,
      "-C",
      f.workspace,
      "--data",
      join(f.root, "failed"),
      "Inspect",
    ]);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("Initialization failed");
    expect(bad.stdout + bad.stderr).not.toContain("synthetic-secret");
  });
  it.each([10_000, 100_000])(
    "loads an explicit trusted host and enforces its %i context capacity",
    (capacity) => {
      const f = fixture();
      const host = join(f.root, "host.mjs");
      writeFileSync(
        host,
        `const usage={status:'unknown',inputTokens:null,outputTokens:null,cacheReadTokens:null,cacheWriteTokens:null,reasoningTokens:null};
export default {model:{provider:'local-fixture',model:'fixture'},plugins:[{plugin:{name:'host-fixture',apiVersion:1,setup(host){host.registerModelProvider({id:'local-fixture',models:[{origin:{provider:'local-fixture',model:'fixture'},contextWindowTokens:${capacity},maxOutputTokens:100,parallelToolCalls:false,reasoning:'none',promptCache:'none',editFormat:'search_replace'}],createClient(){return{async *stream(){yield{type:'part_completed',index:0,part:{type:'text',text:'Explicit offline host'}};yield{type:'completed',stopReason:'end_turn',providerStopReason:null,usage};}};}});}}}]};`,
      );
      const result = run(["--host", host, "-C", f.workspace, "--data", f.data, "Hello"]);
      // The expanded default tool catalog no longer fits this deliberately small profile.
      // Keep its existing limit and fail closed; the ordinary profile exercises successful loading.
      if (capacity === 10_000) {
        expect(result.status).toBe(1);
        expect(result.stdout).toContain("Context capacity exceeded");
        expect(result.stdout).toContain("available 10000");
        expect(result.stdout).not.toContain("Explicit offline host");
      } else {
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("Explicit offline host");
      }
    },
  );
});
