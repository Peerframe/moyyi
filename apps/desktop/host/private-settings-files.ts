import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

export function privateDirectory(path: string, create = false): void {
  try {
    const stat = lstatSync(path);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      stat.uid !== process.getuid?.() ||
      stat.mode & 0o022
    )
      throw Error("Unsafe settings directory");
  } catch (error) {
    if (!create || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    mkdirSync(path, { mode: 0o700 });
    privateDirectory(path);
  }
}
export function readPrivateSettingsFile(path: string, limit: number): Buffer {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const s = fstatSync(fd);
    if (
      !s.isFile() ||
      s.nlink !== 1 ||
      s.uid !== process.getuid?.() ||
      s.mode & 0o077 ||
      s.size > limit
    )
      throw Error("Unsafe settings file");
    const bytes = readFileSync(fd);
    if (bytes.length > limit) throw Error("Oversized settings file");
    return bytes;
  } finally {
    closeSync(fd);
  }
}
export function writePrivateSettingsFile(
  path: string,
  bytes: string | Uint8Array,
  exclusive = false,
): void {
  privateDirectory(dirname(path));
  if (!exclusive) {
    try {
      readPrivateSettingsFile(path, 65_536);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  const temp = exclusive ? path : join(dirname(path), `.settings-${randomUUID()}.tmp`);
  let written = false;
  try {
    const fd = openSync(
      temp,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600,
    );
    written = true;
    try {
      writeFileSync(fd, bytes);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    if (!exclusive) renameSync(temp, path);
    written = false;
    const parent = openSync(dirname(path), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      fsyncSync(parent);
    } finally {
      closeSync(parent);
    }
  } finally {
    if (written) rmSync(temp, { force: true });
  }
}
