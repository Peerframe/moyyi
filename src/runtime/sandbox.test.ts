import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type NativeSandboxOptions, prepareNativeSandbox } from "./sandbox.ts";

let base: string;
let workspace: string;
let scratch: string;
let outside: string;
let options: NativeSandboxOptions;

beforeEach(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "moyyi-sandbox-test-")));
  workspace = join(base, "workspace");
  scratch = join(base, "scratch");
  outside = join(base, "outside.txt");
  await mkdir(workspace);
  await mkdir(scratch, { mode: 0o700 });
  await writeFile(outside, "OUTSIDE_CANARY");
  options = {
    workspaceRoot: workspace,
    cwd: workspace,
    scratchDirectory: scratch,
    protectedPaths: [],
    commandText: "true",
  };
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

/** These launch the actual OS backend. Missing/broken containment fails, never silently skips. */
describe("native sandbox confinement", () => {
  it("runs shell and system tools in the real workspace with a private scratch home", async () => {
    const result = await run(
      'printf \'hello\' > result; cat result; printf scratch > "$HOME/cache"; test "$HOME" = "$TMPDIR"',
    );
    expect(result).toEqual({ code: 0, signal: null, stdout: "hello", stderr: "" });
    expect(await readFile(join(workspace, "result"), "utf8")).toBe("hello");
    expect(await readFile(join(scratch, "cache"), "utf8")).toBe("scratch");
  });

  it("denies reads and writes outside the workspace including symlink aliases", async () => {
    await symlink(outside, join(workspace, "alias"));
    for (const target of [outside, "alias"]) {
      const read = await run(`cat ${quote(target)}`);
      expect(read.stdout).not.toContain("OUTSIDE_CANARY");
      expect(read.code).not.toBe(0);
      expect((await run(`printf changed > ${quote(target)}`)).code).not.toBe(0);
    }
    expect(await readFile(outside, "utf8")).toBe("OUTSIDE_CANARY");
  });

  if (process.platform === "darwin")
    it("does not grant the macOS Data volume through system runtime read permissions", async () => {
      const alias = `/System/Volumes/Data${outside}`;
      expect(existsSync(alias)).toBe(true);
      expect((await run(`cat ${quote(alias)}`)).stdout).not.toContain("OUTSIDE_CANARY");
      expect((await run(`printf changed > ${quote(alias)}`)).code).not.toBe(0);
      expect(await readFile(outside, "utf8")).toBe("OUTSIDE_CANARY");
    });

  if (process.platform === "linux")
    it("denies nested user namespaces and cannot chmod a protected mask through its source", async () => {
      expect(existsSync("/usr/bin/unshare")).toBe(true);
      const nested = await run("/usr/bin/unshare -Ur /bin/true");
      expect(nested.code).not.toBe(0);
      expect(nested.stderr).toMatch(/unshare.*(permitted|space)/);
      await writeFile(join(workspace, ".env"), "PROTECTED_CANARY");
      const mask = await run('chmod 600 "$HOME"/.moyyi-mask-*; cat .env');
      expect(mask.code).not.toBe(0);
      expect(mask.stdout).toBe("");
      expect(await readFile(join(workspace, ".env"), "utf8")).toBe("PROTECTED_CANARY");
    });

  it.each([
    ".env",
    ".env.local",
    ".ENV",
    "token.pem",
    "token.key",
    ".npmrc",
    "credentials.json",
    ".git/config",
    ".ssh/id_ed25519",
    ".moyyi/session",
    ".codex/config",
  ])("protects existing %s from disclosure and mutation", async (path) => {
    const target = join(workspace, path);
    if (path.includes("/")) await mkdir(join(workspace, path.split("/")[0] as string));
    await writeFile(target, "PROTECTED_CANARY");
    expect((await run(`cat ${quote(path)}`)).code).not.toBe(0);
    const result = await run(`cat ${quote(path)}; printf changed > ${quote(path)}`);
    expect(result.stdout).not.toContain("PROTECTED_CANARY");
    expect(result.code).not.toBe(0);
    expect(await readFile(target, "utf8")).toBe("PROTECTED_CANARY");
  });

  it("does not disclose protected contents through rename or hardlink creation", async () => {
    await mkdir(join(workspace, "nested"));
    await writeFile(join(workspace, "nested/.env"), "PROTECTED_CANARY");
    for (const command of [
      "mv nested moved; cat moved/.env",
      "mv nested/.env public; cat public",
      "ln nested/.env public; cat public",
    ])
      expect((await run(command)).stdout).not.toContain("PROTECTED_CANARY");
    expect(await readFile(join(workspace, "nested/.env"), "utf8")).toBe("PROTECTED_CANARY");
  });

  it("masks explicit private runtime data and protects its containing directory", async () => {
    await mkdir(join(workspace, "nested/private"), { recursive: true });
    await writeFile(join(workspace, "nested/private/data"), "RUNTIME_CANARY");
    options = { ...options, protectedPaths: [join(workspace, "nested/private")] };
    for (const command of ["cat nested/private/data", "mv nested moved; cat moved/private/data"])
      expect((await run(command)).stdout).not.toContain("RUNTIME_CANARY");
    expect(await readFile(join(workspace, "nested/private/data"), "utf8")).toBe("RUNTIME_CANARY");
  });

  it("never inherits host environment credentials or shell startup hooks", async () => {
    const plan = await prepareNativeSandbox(options);
    expect(Object.keys(plan.env).sort()).toEqual([
      "HOME",
      "LANG",
      "LC_ALL",
      "PATH",
      "PWD",
      "TMPDIR",
    ]);
    expect((await run("env")).stdout).not.toMatch(
      /(?:API_KEY|TOKEN|BASH_ENV|NODE_OPTIONS|SSH_AUTH_SOCK)=/,
    );
  });

  it("denies TCP connections to an actual host listener", async () => {
    let connections = 0;
    const server = createServer((socket) => {
      connections++;
      socket.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw Error("No test listener");
    try {
      const script = `use IO::Socket::INET; my $s = IO::Socket::INET->new(PeerAddr=>"127.0.0.1", PeerPort=>${address.port}, Timeout=>1); print $s ? "CONNECTED" : "DENIED";`;
      expect((await run(`/usr/bin/perl -e ${quote(script)}`)).stdout).toBe("DENIED");
      expect(connections).toBe(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("denies Unix socket connections to a host service", async () => {
    const socketPath = join(base, "host.sock");
    let connections = 0;
    const server = createServer((socket) => {
      connections++;
      socket.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, resolve);
    });
    try {
      const script = `use IO::Socket::UNIX; my $s = IO::Socket::UNIX->new(Peer=>${JSON.stringify(socketPath)}, Type=>SOCK_STREAM); print $s ? "CONNECTED" : "DENIED";`;
      expect((await run(`/usr/bin/perl -e ${quote(script)}`)).stdout).toBe("DENIED");
      expect(connections).toBe(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("preserves restrictions in a newly executed child shell", async () => {
    const child = `cat ${quote(outside)}; printf changed > ${quote(outside)}`;
    const result = await run(`/bin/sh -c ${quote(child)}`);
    expect(result.stdout).not.toContain("OUTSIDE_CANARY");
    expect(result.code).not.toBe(0);
    expect(await readFile(outside, "utf8")).toBe("OUTSIDE_CANARY");
  });

  it("permits explicit read-only toolchain data without giving it write access", async () => {
    const library = join(base, "library");
    await mkdir(library);
    await writeFile(join(library, "data"), "LIBRARY");
    options = { ...options, readOnlyPaths: [library] };
    const result = await run(
      `cat ${quote(join(library, "data"))}; printf changed > ${quote(join(library, "data"))}`,
    );
    expect(result.stdout).toBe("LIBRARY");
    expect(result.code).not.toBe(0);
    expect(await readFile(join(library, "data"), "utf8")).toBe("LIBRARY");
  });

  it("keeps protected files hidden inside a host-granted toolchain directory", async () => {
    const library = join(base, "library");
    await mkdir(library);
    await writeFile(join(library, ".env"), "TOOLCHAIN_CANARY");
    options = { ...options, readOnlyPaths: [library] };
    expect((await run(`cat ${quote(join(library, ".env"))}`)).stdout).not.toContain(
      "TOOLCHAIN_CANARY",
    );
  });

  it("quotes unusual workspace paths as data in the sandbox policy", async () => {
    const quoted = join(base, 'workspace " (allow default)');
    await mkdir(quoted);
    workspace = quoted;
    options = { ...options, workspaceRoot: workspace, cwd: workspace };
    expect((await run("printf OK > result; cat result")).stdout).toBe("OK");
    expect((await run(`cat ${quote(outside)}`)).stdout).not.toContain("OUTSIDE_CANARY");
  });

  it("rejects pre-existing hardlink aliases before execution", async () => {
    await link(outside, join(workspace, "alias"));
    await expect(prepareNativeSandbox(options)).rejects.toThrow("hard-link");
  });

  it("rejects a host socket inside the writable workspace", async () => {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(join(workspace, "host.sock"), resolve);
    });
    try {
      await expect(prepareNativeSandbox(options)).rejects.toThrow("special file");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("rejects broad roots, protected cwd, overlapping scratch and unsafe toolchain grants", async () => {
    await mkdir(join(workspace, ".git"));
    for (const overrides of [
      { workspaceRoot: "/", cwd: "/" },
      { cwd: join(workspace, ".git") },
      { scratchDirectory: workspace },
      { readOnlyPaths: [base] },
      { readOnlyPaths: ["/"] },
      { protectedPaths: [base] },
      { executablePaths: [workspace] },
    ])
      await expect(prepareNativeSandbox({ ...options, ...overrides })).rejects.toThrow();
  });
});

async function run(
  commandText: string,
): Promise<{ code: number | null; signal: string | null; stdout: string; stderr: string }> {
  const marker = "MOYYI_SANDBOX_STARTED\n";
  const plan = await prepareNativeSandbox({
    ...options,
    commandText: `printf ${quote(marker)}; ${commandText}`,
  });
  return new Promise((resolve, reject) => {
    const child = spawn(plan.command, [...plan.args], {
      cwd: workspace,
      env: plan.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), 4000);
    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      // An unavailable launcher is not evidence that a running command was denied access.
      if (!stdout.startsWith(marker)) {
        reject(Error(`Sandbox did not start the probe command: ${stderr}`));
        return;
      }
      resolve({ code, signal, stdout: stdout.slice(marker.length), stderr });
    });
  });
}

function quote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
