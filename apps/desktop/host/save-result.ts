// Adapted from OpenBot apps/desktop/src/report-save.ts at 010439bb9002fabb7e1facd8450ee85edbafa309.
// MIT; see ../renderer/OPENBOT-LICENSE.txt. Only native main selects the destination.
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  openSync,
  realpathSync,
  writeSync,
} from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { readWorkspaceFile } from "./materials.ts";

export function saveReceiptFile(
  workspace: string,
  path: string,
  sha256: string,
  destination: string,
  excluded: readonly string[],
): void {
  const file = readWorkspaceFile(workspace, path, excluded, 10 * 1024 * 1024, true);
  if (file.sha256 !== sha256 || !file.bytes)
    throw Error("The selected result changed; nothing was saved");
  if (!isAbsolute(destination) || destination.includes("\0"))
    throw Error("Invalid save destination");
  const parent = dirname(destination);
  if (realpathSync(parent) !== parent || !lstatSync(parent).isDirectory())
    throw Error("Save directory has changed");
  const before = lstatSync(parent);
  let fd: number | undefined;
  try {
    fd = openSync(
      destination,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    const opened = fstatSync(fd),
      current = lstatSync(parent);
    if (
      before.dev !== current.dev ||
      before.ino !== current.ino ||
      !opened.isFile() ||
      opened.nlink !== 1
    )
      throw Error("Save destination changed");
    let offset = 0;
    while (offset < file.bytes.length)
      offset += writeSync(fd, file.bytes, offset, file.bytes.length - offset);
    fsyncSync(fd);
    const after = lstatSync(destination);
    if (after.dev !== opened.dev || after.ino !== opened.ino || realpathSync(parent) !== parent)
      throw Error("Save destination changed");
  } finally {
    // On an exceptional write retain the partial user-selected file; never unlink a replaced path.
    if (fd !== undefined) closeSync(fd);
  }
}
