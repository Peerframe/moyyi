import { spawn, spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { link, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverNodeToolchain } from "./node-toolchain.ts";
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

  it("keeps read-only checks confined even beneath protected-file directory pins", async () => {
    options = { ...options, workspaceAccess: "read-only" };
    await mkdir(join(workspace, "nested"));
    await writeFile(join(workspace, "nested/.env"), "PROTECTED_CANARY");
    const file = join(workspace, "nested/source");
    await writeFile(file, "ORIGINAL", { mode: 0o640 });
    expect((await run('cat nested/source; printf CACHE > "$HOME/cache"')).stdout).toBe("ORIGINAL");
    for (const command of [
      "printf changed > nested/source",
      "printf new > nested/new",
      "rm nested/source",
      "mv nested/source nested/moved",
      "chmod 777 nested/source",
      "mkdir nested/new-directory",
      "/bin/sh -c 'printf child > nested/source'",
      'ln nested/source "$HOME/alias" && printf changed > "$HOME/alias"',
    ])
      expect((await run(command)).code).not.toBe(0);
    expect(await readFile(file, "utf8")).toBe("ORIGINAL");
    expect(statSync(file).mode & 0o777).toBe(0o640);
    expect(await readFile(join(scratch, "cache"), "utf8")).toBe("CACHE");
    expect((await run("cat nested/.env")).stdout).not.toContain("PROTECTED_CANARY");
    expect((await run(`cat ${quote(outside)}`)).stdout).not.toContain("OUTSIDE_CANARY");
  });

  it("runs the discovered Node toolchain with clean configuration and no workspace writes", async () => {
    options = { ...options, workspaceAccess: "read-only", ...(await discoverNodeToolchain()) };
    await writeFile(join(workspace, "source"), "SOURCE");
    const script = `const fs=require('node:fs'); process.stdout.write(fs.readFileSync('source')); if(process.env.OPENSSL_CONF!=='/dev/null') throw Error('config'); fs.writeFileSync('source','changed')`;
    const result = await run(`node -e ${quote(script)}`);
    expect(result.stdout).toBe("SOURCE");
    expect(result.code).not.toBe(0);
    expect(await readFile(join(workspace, "source"), "utf8")).toBe("SOURCE");
  });

  it("supports here documents through the selected shell in a read-only workspace", async () => {
    options = { ...options, workspaceAccess: "read-only" };
    const content = `literal $HOME \`not-a-command\`\n${"x".repeat(12_000)}\n`;
    const result = await run(`cat <<'EOF'\n${content}EOF`);
    expect(result).toEqual({ code: 0, signal: null, stdout: content, stderr: "" });
  });

  it("pipes quoted arguments and preserves an explicit failing exit status", async () => {
    options = { ...options, workspaceAccess: "read-only" };
    const result = await run("printf '%s\\n' 'two words' '$(printf forbidden)' | cat; exit 7");
    expect(result).toEqual({
      code: 7,
      signal: null,
      stdout: "two words\n$(printf forbidden)\n",
      stderr: "",
    });
  });

  it("runs Node stdin checks with heredocs while keeping only scratch writable", async () => {
    options = { ...options, workspaceAccess: "read-only", ...(await discoverNodeToolchain()) };
    await writeFile(join(workspace, "source"), "SOURCE");
    const script = `const fs = require('node:fs');
process.stdout.write(fs.readFileSync('source'));
fs.writeFileSync(process.env.TMPDIR + '/cache', 'SCRATCH');
try { fs.writeFileSync('source', 'changed'); process.exitCode = 1; }
catch (error) { if (!['EPERM', 'EACCES', 'EROFS'].includes(error.code)) throw error; }`;
    expect(await run(`node - <<'EOF'\n${script}\nEOF`)).toEqual({
      code: 0,
      signal: null,
      stdout: "SOURCE",
      stderr: "",
    });
    expect(await readFile(join(workspace, "source"), "utf8")).toBe("SOURCE");
    expect(await readFile(join(scratch, "cache"), "utf8")).toBe("SCRATCH");
  });

  it("does not load startup files from its private home", async () => {
    for (const name of [".zshenv", ".zprofile", ".zshrc", ".zlogin", ".profile", ".bashrc"])
      await writeFile(join(scratch, name), "printf STARTUP_CANARY\\n");
    expect(await run("printf clean")).toEqual({
      code: 0,
      signal: null,
      stdout: "clean",
      stderr: "",
    });
  });

  if (process.platform === "darwin")
    it("keeps host process arguments and environment hidden after allowing uname identity", async () => {
      const host = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "ARGV_CANARY"], {
        env: { PATH: "/usr/bin:/bin", MOYYI_HOST_CANARY: "ENVIRONMENT_CANARY" },
        stdio: "ignore",
      });
      const closed = new Promise<void>((resolve) => host.once("close", () => resolve()));
      try {
        await new Promise<void>((resolve, reject) => {
          host.once("spawn", resolve);
          host.once("error", reject);
        });
        const args = ["eww", "-p", String(host.pid)];
        const visible = spawnSync("/bin/ps", args, { encoding: "utf8", timeout: 2000 });
        expect(visible.status).toBe(0);
        expect(visible.stdout).toContain("ARGV_CANARY");
        expect(visible.stdout).toContain("ENVIRONMENT_CANARY");
        const denied = await run(`/bin/ps ${args.map(quote).join(" ")}`);
        expect(denied.code).not.toBe(0);
        expect(denied.stdout).not.toMatch(/ARGV_CANARY|ENVIRONMENT_CANARY/);
      } finally {
        host.kill("SIGKILL");
        await closed;
      }
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
      "OPENSSL_CONF",
      "PATH",
      "PWD",
      "TMPDIR",
      ...(process.platform === "darwin" ? ["TMPPREFIX"] : []),
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

  if (process.platform === "darwin") {
    it("preserves explicit loader alias metadata without granting sibling data or writes", async () => {
      const library = join(base, "library");
      const aliases = join(base, "opt");
      await mkdir(library);
      await mkdir(aliases);
      const target = join(library, "lib-v1");
      const alias = join(aliases, "lib-compat");
      const sibling = join(aliases, "other");
      await writeFile(target, "LIBRARY");
      await writeFile(sibling, "SIBLING_CANARY");
      await symlink(target, alias);
      options = { ...options, readOnlyPaths: [alias] };
      expect((await run(`cat ${quote(alias)}`)).stdout).toBe("LIBRARY");
      expect((await run(`cat ${quote(sibling)}`)).stdout).not.toContain("SIBLING_CANARY");
      expect((await run(`printf changed > ${quote(alias)}`)).code).not.toBe(0);
      expect(await readFile(target, "utf8")).toBe("LIBRARY");
    });

    it("does not grant a different target after an explicit loader alias is replaced", async () => {
      const target = join(base, "library");
      const alias = join(base, "library-alias");
      await writeFile(target, "LIBRARY");
      await symlink(target, alias);
      options = { ...options, readOnlyPaths: [alias] };
      const result = await run(`cat ${quote(alias)}`, async () => {
        await rm(alias);
        await symlink(outside, alias);
      });
      expect(result.code).not.toBe(0);
      expect(result.stdout).not.toContain("OUTSIDE_CANARY");
      expect(await readFile(outside, "utf8")).toBe("OUTSIDE_CANARY");
    });
  }

  it("checks both requested aliases and their actual targets against protected scopes", async () => {
    const library = join(base, "library");
    const aliases = join(base, "aliases");
    const privateDirectory = join(base, "private");
    await mkdir(library);
    await mkdir(aliases);
    await mkdir(privateDirectory);
    await writeFile(join(library, "data"), "LIBRARY");
    await writeFile(join(library, ".env"), "SECRET");
    await writeFile(join(privateDirectory, "data"), "PRIVATE");
    for (const [name, target] of [
      [".env", join(library, "data")],
      ["secret-alias", join(library, ".env")],
      ["private-alias", join(privateDirectory, "data")],
    ] as const) {
      const alias = join(aliases, name);
      await symlink(target, alias);
      await expect(
        prepareNativeSandbox({
          ...options,
          protectedPaths: [privateDirectory],
          readOnlyPaths: [alias],
        }),
      ).rejects.toThrow();
    }
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
  afterPrepare?: () => Promise<void>,
): Promise<{ code: number | null; signal: string | null; stdout: string; stderr: string }> {
  const marker = "MOYYI_SANDBOX_STARTED\n";
  const plan = await prepareNativeSandbox({
    ...options,
    commandText: `printf ${quote(marker)}; ${commandText}`,
  });
  await afterPrepare?.();
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
