import { randomUUID } from "node:crypto";
import { constants, lstatSync, realpathSync } from "node:fs";
import { access, lstat, opendir, realpath, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { assertUnprotected } from "./preconditions.ts";

export interface NativeSandboxOptions {
  readonly workspaceRoot: string;
  readonly workspaceAccess?: "read-only" | "read-write";
  readonly cwd: string;
  readonly protectedPaths: readonly string[];
  /** Trusted host grants, never tool arguments. Libraries need a separate read-only grant. */
  readonly executablePaths?: readonly string[];
  readonly readOnlyPaths?: readonly string[];
  readonly scratchDirectory: string;
  readonly commandText: string;
}

export interface NativeSandboxPlan {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
  readonly backend: "seatbelt" | "bubblewrap";
}

const MAX_ENTRIES = 30_000;
const MAX_DEPTH = 64;
const credentialNames = [
  ".git",
  ".moyyi",
  ".codex",
  ".ssh",
  ".aws",
  ".azure",
  ".gnupg",
  ".kube",
  ".npmrc",
  ".netrc",
  ".pypirc",
  "credentials",
  "credentials.json",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
];
const systemReadPaths =
  process.platform === "darwin"
    ? [
        "/bin",
        "/sbin",
        "/usr/bin",
        "/usr/sbin",
        "/usr/lib",
        "/usr/libexec",
        "/usr/share",
        "/System/Library",
        "/System/Cryptexes",
        "/System/Volumes/Preboot/Cryptexes/OS",
        "/Library/Apple",
        "/private/var/select/sh",
      ]
    : [
        "/usr/bin",
        "/usr/sbin",
        "/usr/lib",
        "/usr/lib64",
        "/usr/libexec",
        "/usr/share",
        "/bin",
        "/sbin",
        "/lib",
        "/lib64",
        "/etc/ld.so.cache",
        "/etc/ld.so.conf",
        "/etc/ld.so.conf.d",
        "/etc/alternatives",
      ];

/** Produces an OS-enforced, network-denied launch; there is no unrestricted fallback. */
export async function prepareNativeSandbox(
  options: NativeSandboxOptions,
): Promise<NativeSandboxPlan> {
  if (process.platform !== "darwin" && process.platform !== "linux")
    throw Error("Native command sandbox is unavailable on this platform");
  const workspaceAccess = options.workspaceAccess ?? "read-write";
  if (!["read-only", "read-write"].includes(workspaceAccess))
    throw Error("Invalid sandbox workspace access mode");
  if (
    !options.commandText.length ||
    options.commandText.length > 32_768 ||
    options.commandText.includes("\0")
  )
    throw Error("Invalid sandbox command");
  const workspace = await directory(options.workspaceRoot);
  const cwd = await directory(options.cwd);
  const scratch = await directory(options.scratchDirectory);
  if (!within(workspace, cwd) || within(workspace, scratch) || within(scratch, workspace))
    throw Error("Sandbox directories must have separate, confined scopes");
  for (const path of [workspace, cwd, scratch]) assertUnprotected(path);
  const forbiddenRoots = [
    "/",
    "/Users",
    "/home",
    homedir(),
    "/tmp",
    "/private/tmp",
    "/var",
    "/private/var",
    "/opt",
    "/etc",
    "/private/etc",
    "/System",
    "/Library",
  ];
  if (forbiddenRoots.includes(workspace) || systemReadPaths.some((path) => within(path, workspace)))
    throw Error("Select a project directory, not a home, temporary or system root");
  const scratchStat = await lstat(scratch);
  if ((scratchStat.mode & 0o077) !== 0 || scratchStat.uid !== process.getuid?.())
    throw Error("Sandbox scratch directory must be private and owned by this user");

  const exclusions = options.protectedPaths.flatMap(resolveProtected);
  if (exclusions.some((path) => within(path, workspace) || within(path, scratch)))
    throw Error("Sandbox scope overlaps protected runtime data");
  const protectedEntries = new Map<string, boolean>();
  const pinnedAncestors = new Set<string>([workspace]);
  const protect = (path: string, isDirectory: boolean) => {
    protectedEntries.set(path, isDirectory);
    for (let parent = dirname(path); within(workspace, parent); parent = dirname(parent)) {
      pinnedAncestors.add(parent);
      if (parent === workspace) break;
    }
  };
  let visited = 0;
  const inspect = async (path: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) throw Error("Workspace exceeds sandbox scan depth");
    const stream = await opendir(path);
    for await (const entry of stream) {
      if (++visited > MAX_ENTRIES) throw Error("Workspace exceeds sandbox scan entry limit");
      const child = resolve(path, entry.name);
      const stat = await lstat(child);
      if (protectedName(child) || exclusions.some((excluded) => within(excluded, child))) {
        protect(child, stat.isDirectory());
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) await inspect(child, depth + 1);
      else if (!stat.isFile() || stat.nlink !== 1)
        throw Error("Sandbox workspace contains a special file or hard-link alias");
    }
  };
  await inspect(workspace, 0);
  if (protectedName(cwd) || exclusions.some((path) => within(path, cwd)))
    throw Error("Sandbox working directory is protected");

  const extraReads: string[] = [];
  const extraBins: string[] = [];
  const loaderMetadata = new Set<string>();
  for (const [paths, executable] of [
    [options.executablePaths ?? [], true],
    [options.readOnlyPaths ?? [], false],
  ] as const) {
    for (const input of paths) {
      if (!isAbsolute(input)) throw Error("Sandbox toolchain grants must be absolute");
      const alias = resolve(input);
      const path = await realpath(alias);
      const stat = await lstat(path);
      if ((!stat.isFile() && !stat.isDirectory()) || (executable && !stat.isFile()))
        throw Error("Sandbox toolchain grant is not a regular file or directory");
      for (const candidate of new Set([alias, path])) {
        assertUnprotected(candidate);
        if (protectedName(candidate)) throw Error("Sandbox toolchain path is protected");
        if (
          candidate === "/" ||
          within(candidate, homedir()) ||
          within(candidate, workspace) ||
          within(candidate, scratch) ||
          exclusions.some((excluded) => within(candidate, excluded) || within(excluded, candidate))
        )
          throw Error("Sandbox toolchain grant overlaps a private scope");
      }
      extraReads.push(path);
      // dyld may inspect a host-selected compatibility symlink before opening its real target.
      // Preserve only that path's metadata; data grants remain pinned to the validated target.
      if (alias !== path) {
        for (let current = alias; current !== "/"; current = dirname(current))
          loaderMetadata.add(current);
      }
      if (stat.isDirectory()) await inspect(path, 0);
      else if (stat.nlink !== 1) throw Error("Sandbox toolchain contains a hard-link alias");
      if (executable) {
        await access(path, constants.X_OK);
        extraBins.push(dirname(path));
      }
    }
  }
  const reads = [...new Set([...systemReadPaths.filter(exists), ...extraReads])];
  const env = Object.freeze({
    PATH: [...new Set([...extraBins, "/usr/bin", "/bin", "/usr/sbin", "/sbin"])].join(":"),
    HOME: scratch,
    TMPDIR: scratch,
    LANG: "C",
    LC_ALL: "C",
    PWD: cwd,
    OPENSSL_CONF: "/dev/null",
  });
  if (process.platform === "darwin") {
    await access("/usr/bin/sandbox-exec", constants.X_OK);
    const filters = (paths: readonly string[]) =>
      paths.map((path) => `(subpath ${quote(path)})`).join(" ");
    const literal = (paths: readonly string[]) =>
      paths.map((path) => `(literal ${quote(path)})`).join(" ");
    const ancestors = new Set<string>(["/"]);
    for (const path of [workspace, cwd, scratch, ...reads]) {
      for (let parent = dirname(path); parent !== "/"; parent = dirname(parent))
        ancestors.add(parent);
    }
    const protectedPattern = `/(?:${credentialNames.map(casePattern).join("|")}|[.][eE][nN][vV](?:[.][^/]*)?|[^/]*[.](?:[kK][eE][yY]|[pP][eE][mM]))(?:/|$)`;
    const profile = [
      "(version 1)",
      "(deny default)",
      "(allow process-fork process-exec)",
      "(allow signal (target same-sandbox))",
      "(allow process-info* (target same-sandbox))",
      // No kern.proc/argv/environment sysctls: hardware and OS identity are sufficient here.
      `(allow sysctl-read ${["hw.activecpu", "hw.memsize", "hw.pagesize", "hw.pagesize_compat", "hw.ncpu", "hw.cputype", "kern.osrelease", "kern.ostype", "kern.osversion", "kern.hostname", "kern.maxfilesperproc", "sysctl.proc_cputype"].map((name) => `(sysctl-name ${quote(name)})`).join(" ")})`,
      // Directory inodes are required by the loader/getcwd, without granting descendant data.
      `(allow file-read* ${literal([...ancestors])})`,
      ...(loaderMetadata.size
        ? [`(allow file-read-metadata ${literal([...loaderMetadata])})`]
        : []),
      `(allow file-read* ${filters(reads)})`,
      `(allow file-read* ${filters([workspace])})`,
      `(allow file-read* file-write* ${filters(workspaceAccess === "read-write" ? [workspace, scratch] : [scratch])})`,
      '(allow file-read* (literal "/dev/null") (literal "/dev/random") (literal "/dev/urandom"))',
      '(allow file-write-data (literal "/dev/null"))',
      `(deny file-read* file-write* (regex #${quote(protectedPattern)}))`,
      ...(exclusions.length ? [`(deny file-read* file-write* ${filters(exclusions)})`] : []),
      // A directory rename must not expose a protected descendant under an unprotected name.
      `(deny file-write-unlink ${literal([...pinnedAncestors])})`,
      ...(protectedEntries.size
        ? [`(deny file-read* file-write* ${filters([...protectedEntries.keys()])})`]
        : []),
    ].join("\n");
    return {
      command: "/usr/bin/sandbox-exec",
      args: ["-p", profile, "/bin/sh", "-c", options.commandText],
      env,
      backend: "seatbelt",
    };
  }

  const command = ["/usr/bin/bwrap", "/bin/bwrap"].find(exists);
  if (!command) throw Error("Native command sandbox requires bubblewrap");
  await access(command, constants.X_OK);
  const args = [
    "--unshare-all",
    "--unshare-user",
    "--disable-userns",
    "--die-with-parent",
    "--new-session",
    "--cap-drop",
    "ALL",
    "--clearenv",
  ];
  for (const path of reads) args.push("--ro-bind", path, path);
  args.push(
    "--proc",
    "/proc",
    "--dev",
    "/dev",
    workspaceAccess === "read-write" ? "--bind" : "--ro-bind",
    workspace,
    workspace,
    "--bind",
    scratch,
    scratch,
  );
  // Writable workspaces need containing-directory pins against protected-descendant renames.
  // Read-only workspaces must not gain writable child mounts through these pins.
  for (const path of [...pinnedAncestors]
    .filter((path) => path !== workspace)
    .sort((a, b) => a.length - b.length))
    args.push(workspaceAccess === "read-write" ? "--bind" : "--ro-bind", path, path);
  // A zero-mode, read-only bind denies reads instead of returning a misleading empty secret.
  // Pin its source too: the child must not chmod the same inode through its scratch alias.
  let mask: string | undefined;
  if ([...protectedEntries.values()].some((isDirectory) => !isDirectory)) {
    mask = resolve(scratch, `.moyyi-mask-${randomUUID()}`);
    await writeFile(mask, "", { flag: "wx", mode: 0o000 });
    args.push("--ro-bind", mask, mask);
  }
  for (const [path, isDirectory] of protectedEntries) {
    if (isDirectory) args.push("--perms", "0000", "--tmpfs", path, "--remount-ro", path);
    else if (mask) args.push("--ro-bind", mask, path);
  }
  // The synthetic namespace parents must not become an additional writable filesystem.
  // This is non-recursive: only explicitly writable mounts retain write access.
  args.push("--remount-ro", "/");
  for (const [key, value] of Object.entries(env)) args.push("--setenv", key, value);
  args.push("--chdir", cwd, "--", "/bin/sh", "-c", options.commandText);
  return { command, args, env, backend: "bubblewrap" };
}

async function directory(input: string): Promise<string> {
  if (!isAbsolute(input) || input.includes("\0"))
    throw Error("Sandbox directories must be absolute");
  const stat = await lstat(input);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw Error("Sandbox directories must be real directories");
  return realpath(input);
}

function resolveProtected(input: string): string[] {
  if (!isAbsolute(input)) throw Error("Sandbox protected paths must be absolute");
  let ancestor = resolve(input);
  const suffix: string[] = [];
  for (;;) {
    try {
      lstatSync(ancestor);
      return [resolve(input), resolve(realpathSync(ancestor), ...suffix)];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(ancestor) === ancestor)
        throw error;
      suffix.unshift(ancestor.slice(dirname(ancestor).length + 1));
      ancestor = dirname(ancestor);
    }
  }
}

function within(root: string, path: string): boolean {
  const child = relative(root, path);
  return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function protectedName(path: string): boolean {
  try {
    assertUnprotected(path);
  } catch {
    return true;
  }
  return path.split(sep).some((part) => [".git", ".moyyi", ".codex"].includes(part.toLowerCase()));
}

function exists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch {
    return false;
  }
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function casePattern(value: string): string {
  return [...value]
    .map((char) =>
      /[a-z]/.test(char) ? `[${char}${char.toUpperCase()}]` : char === "." ? "[.]" : char,
    )
    .join("");
}
