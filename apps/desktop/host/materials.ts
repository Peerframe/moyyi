import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  type Stats,
} from "node:fs";
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { DesktopMaterial } from "../shared.ts";

export class FileBoundaryError extends Error {
  readonly kind: "missing" | "unavailable";
  constructor(message: string, kind: "missing" | "unavailable" = "unavailable") {
    super(message);
    this.kind = kind;
  }
}
const protectedNames = new Set([
  ".git",
  ".moyyi",
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
]);
const formats = new Set([
  "pdf",
  "docx",
  "xlsx",
  "pptx",
  "odt",
  "ods",
  "odp",
  "txt",
  "text",
  "md",
  "csv",
  "json",
  "png",
  "jpg",
  "jpeg",
]);
const within = (root: string, path: string) => {
  const child = relative(root, path);
  return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
};
const same = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino;
const unchanged = (a: Stats, b: Stats) =>
  same(a, b) &&
  a.size === b.size &&
  a.mtimeMs === b.mtimeMs &&
  a.ctimeMs === b.ctimeMs &&
  a.mode === b.mode &&
  a.nlink === b.nlink;

function protectedPath(path: string, excluded: readonly string[]): void {
  if (
    path.split(sep).some((part) => {
      const name = part.toLowerCase();
      return (
        protectedNames.has(name) ||
        name === ".env" ||
        name.startsWith(".env.") ||
        name.endsWith(".key") ||
        name.endsWith(".pem")
      );
    }) ||
    excluded.some((root) => within(resolve(root), path))
  )
    throw new FileBoundaryError("Protected files are outside the desktop file scope");
}

/** Local host inspection only; this is never a new model filesystem capability. */
export function locateWorkspaceFile(
  workspace: string,
  input: string,
  excluded: readonly string[] = [],
  allowMissing = false,
) {
  try {
    if (!isAbsolute(workspace) || realpathSync(workspace) !== workspace)
      throw new FileBoundaryError("The selected workspace has changed");
    if (
      !input ||
      input.includes("\\") ||
      [...input].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
      input.split(sep).some((part) => part === ".." || part === ".")
    )
      throw new FileBoundaryError("Invalid workspace file path");
    const absolute = resolve(workspace, input);
    if (absolute === workspace || !within(workspace, absolute))
      throw new FileBoundaryError("File is outside the selected workspace");
    protectedPath(workspace, excluded);
    protectedPath(absolute, excluded);
    const parts = relative(workspace, absolute).split(sep);
    const parents: { path: string; stat: Stats }[] = [];
    let current = workspace;
    let stat: Stats | null = lstatSync(workspace);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new FileBoundaryError("Workspace must be a real directory");
    parents.push({ path: workspace, stat });
    for (const [index, part] of parts.entries()) {
      current = resolve(current, part);
      try {
        stat = lstatSync(current);
      } catch (error) {
        if (
          allowMissing &&
          index === parts.length - 1 &&
          (error as { code?: string }).code === "ENOENT"
        )
          stat = null;
        else throw error;
      }
      if (stat?.isSymbolicLink())
        throw new FileBoundaryError("Symbolic links are outside the desktop file scope");
      if (index < parts.length - 1) {
        if (!stat?.isDirectory())
          throw new FileBoundaryError("Parent directory must already exist");
        parents.push({ path: current, stat });
      }
    }
    return { absolute, path: parts.join("/"), stat, parents };
  } catch (error) {
    if (error instanceof FileBoundaryError) throw error;
    if ((error as { code?: string }).code === "ENOENT")
      throw new FileBoundaryError("The selected file no longer exists", "missing");
    throw new FileBoundaryError("The selected file could not be inspected safely");
  }
}

export function readWorkspaceFile(
  workspace: string,
  input: string,
  excluded: readonly string[],
  maximum: number,
  collect = false,
  check: () => void = () => {},
) {
  check();
  const target = locateWorkspaceFile(workspace, input, excluded);
  const regular = (stat: Stats | null) => {
    if (!stat?.isFile() || stat.nlink !== 1 || stat.size > maximum)
      throw new FileBoundaryError(
        "The selected file must be a bounded ordinary file with one link",
      );
  };
  regular(target.stat);
  let fd: number | undefined;
  try {
    fd = openSync(
      target.absolute,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    const before = fstatSync(fd);
    regular(before);
    if (!target.stat || !unchanged(before, target.stat))
      throw new FileBoundaryError("File changed before inspection");
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(65_536);
    const chunks: Buffer[] = [];
    let bytes = 0;
    while (true) {
      check();
      const count = readSync(fd, buffer, 0, Math.min(buffer.length, maximum + 1 - bytes), null);
      if (!count) break;
      bytes += count;
      if (bytes > maximum) throw new FileBoundaryError("The selected file exceeds its size limit");
      hash.update(buffer.subarray(0, count));
      if (collect) chunks.push(Buffer.from(buffer.subarray(0, count)));
    }
    const after = fstatSync(fd);
    check();
    const current = locateWorkspaceFile(workspace, input, excluded);
    if (
      !current.stat ||
      bytes !== before.size ||
      !unchanged(before, after) ||
      !unchanged(after, current.stat) ||
      current.parents.length !== target.parents.length ||
      current.parents.some(
        (parent, index) => !same(parent.stat, target.parents[index]?.stat as Stats),
      )
    )
      throw new FileBoundaryError("File changed during inspection");
    return {
      path: target.path,
      sourceBytes: bytes,
      sha256: hash.digest("hex"),
      bytes: collect ? Buffer.concat(chunks) : undefined,
    };
  } catch (error) {
    if (error instanceof FileBoundaryError) throw error;
    throw new FileBoundaryError("The selected file could not be read safely");
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/** The native host supplies the exact approved source; this never grants its parent directory. */
export function snapshotExternalMaterial(
  source: string,
  excluded: readonly string[],
  check: () => void = () => {},
) {
  if (typeof source !== "string" || !isAbsolute(source) || source.length > 4096)
    throw new FileBoundaryError("An explicit absolute source file is required");
  protectedPath(source, excluded);
  const parent = realpathSync(dirname(source));
  const path = resolve(parent, basename(source));
  protectedPath(path, excluded);
  const format = extname(path).slice(1).toLowerCase();
  if (!formats.has(format)) throw new FileBoundaryError("Select a supported material format");
  const name = basename(source);
  if (
    !name ||
    name.length > 160 ||
    !name.isWellFormed() ||
    [...name].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)
  )
    throw new FileBoundaryError("The material name is unavailable");
  const before = lstatSync(path);
  const result = readWorkspaceFile(parent, path, excluded, 10 * 1024 * 1024, true, check);
  const after = lstatSync(path);
  if (!unchanged(before, after))
    throw new FileBoundaryError("The source file changed during import");
  const bytes = result.bytes as Buffer;
  if (["txt", "text", "md", "csv", "json"].includes(format)) {
    try {
      if (new TextDecoder("utf-8", { fatal: true }).decode(bytes).includes("\0")) throw Error();
    } catch {
      throw new FileBoundaryError("Text materials require valid UTF-8 without NUL bytes");
    }
  }
  return { name, format, sourceBytes: result.sourceBytes, sha256: result.sha256, bytes };
}

export function inspectMaterials(
  workspace: string,
  paths: readonly string[],
  excluded: readonly string[],
): DesktopMaterial[] {
  if (paths.length > 8) throw new FileBoundaryError("Select at most eight documents");
  const selected: DesktopMaterial[] = [];
  for (const path of paths) {
    const format = extname(path).slice(1).toLowerCase();
    if (!formats.has(format)) throw new FileBoundaryError("Select a supported document format");
    const file = readWorkspaceFile(workspace, path, excluded, 10 * 1024 * 1024);
    if (!selected.some((item) => item.path === file.path))
      selected.push({
        path: file.path,
        format,
        sourceBytes: file.sourceBytes,
        sha256: file.sha256,
      });
  }
  return selected;
}
