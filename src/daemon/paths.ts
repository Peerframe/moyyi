import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";

/**
 * The daemon's socket and token live in the private data directory the store already created
 * (mode 0700). Only the owner can reach the socket; the token additionally proves that a client
 * read an owner-only file, so a misconfigured directory alone does not admit another user.
 */
export interface DaemonPaths {
  readonly directory: string;
  readonly socket: string;
  readonly token: string;
}

// sockaddr_un.sun_path is 104 bytes on macOS (108 on Linux), including the terminating NUL.
const MAX_SOCKET_PATH_BYTES = 103;

export function daemonPaths(dataDirectory: string): DaemonPaths {
  let directory: string;
  try {
    directory = realpathSync(dataDirectory);
  } catch {
    throw Error("The data directory does not exist");
  }
  const socket = join(directory, "daemon.sock");
  if (Buffer.byteLength(socket) > MAX_SOCKET_PATH_BYTES)
    throw Error("The data directory path is too long for a local socket; choose a shorter --data");
  return { directory, socket, token: join(directory, "daemon-token") };
}

function owner(): number {
  const uid = process.getuid?.();
  if (uid === undefined) throw Error("Local daemon requires a POSIX user id");
  return uid;
}

export function assertPrivateDirectory(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw Error("The data directory must be a real directory");
  if (stat.uid !== owner() || (stat.mode & 0o077) !== 0)
    throw Error("The data directory must be owned by this user and private (mode 0700)");
}

function lstatOrUndefined(path: string): import("node:fs").Stats | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Removes a leftover socket or token owned by this user; refuses anything else at the path. */
export function removeOwned(path: string, kind: "socket" | "file"): void {
  const stat = lstatOrUndefined(path);
  if (!stat) return;
  const matches = kind === "socket" ? stat.isSocket() : stat.isFile();
  if (!matches || stat.isSymbolicLink() || stat.uid !== owner())
    throw Error(`Refusing to replace an unexpected file at ${path}`);
  unlinkSync(path);
}

/** Writes a fresh 256-bit token with mode 0600, never following or reusing an existing file. */
export function writeToken(path: string): string {
  removeOwned(path, "file");
  const token = randomBytes(32).toString("hex");
  const fd = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    writeSync(fd, `${token}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return token;
}

export function readToken(path: string): string {
  const stat = lstatOrUndefined(path);
  if (!stat) throw Error("No daemon is running for this data directory");
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== owner() || (stat.mode & 0o077) !== 0)
    throw Error("The daemon token must be a private file owned by this user");
  if (stat.size > 256) throw Error("The daemon token is invalid");
  const token = readFileSync(path, "utf8").trim();
  if (!/^[0-9a-f]{64}$/u.test(token)) throw Error("The daemon token is invalid");
  return token;
}

export function assertOwnedSocket(path: string): void {
  const stat = lstatOrUndefined(path);
  if (!stat) throw Error("No daemon is running for this data directory");
  if (!stat.isSocket() || stat.uid !== owner())
    throw Error("The daemon socket must be owned by this user");
}
