import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { Precondition, PreconditionVerifier, ToolContext } from "../contracts/index.ts";

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const protectedNames = new Set([
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

/** A host-side preflight check, not a filesystem capability or an atomic write primitive. */
export class WorkspacePreconditions implements PreconditionVerifier {
  async check(
    conditions: readonly Precondition[],
    context: ToolContext,
  ): Promise<{ readonly valid: true } | { readonly valid: false; readonly reason: string }> {
    try {
      if (context.signal.aborted) throw new Error("Precondition check cancelled");
      if (!isAbsolute(context.workspaceRoot)) throw new Error("Workspace must be absolute");
      const workspaceStat = lstatSync(context.workspaceRoot);
      if (!workspaceStat.isDirectory() || workspaceStat.isSymbolicLink())
        throw new Error("Workspace must be a real directory");
      const workspace = realpathSync(context.workspaceRoot);
      assertUnprotected(context.workspaceRoot);
      assertUnprotected(workspace);
      for (const condition of conditions) {
        if (context.signal.aborted) throw new Error("Precondition check cancelled");
        const target = authorizedPath(workspace, condition.path, context.workspaceRoot);
        switch (condition.kind) {
          case "path_resolves_within": {
            const boundary = authorizedPath(workspace, condition.root, context.workspaceRoot);
            if (!boundary.exists || !lstatSync(boundary.path).isDirectory())
              throw new Error("Precondition root must exist as a directory");
            assertWithin(boundary.path, target.path);
            break;
          }
          case "file_hash": {
            if (condition.sha256 === null) {
              if (target.exists) throw new Error("Expected target to be absent");
            } else {
              if (!/^[0-9a-f]{64}$/.test(condition.sha256))
                throw new Error("Invalid SHA-256 precondition");
              if (!target.exists || hashFile(target.path, context.signal) !== condition.sha256)
                throw new Error("File content changed");
            }
            break;
          }
          default:
            throw new Error("Unknown precondition kind");
        }
      }
      if (context.signal.aborted) throw new Error("Precondition check cancelled");
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        reason: error instanceof Error ? error.message : "Precondition check failed",
      };
    }
  }
}

function authorizedPath(
  workspace: string,
  input: string,
  declaredWorkspace: string,
): { path: string; exists: boolean } {
  if (typeof input !== "string" || input.length === 0 || input.includes("\0"))
    throw new Error("Invalid precondition path");
  let lexical = resolve(declaredWorkspace, input);
  // OS aliases in the workspace's ancestors (e.g. macOS /var -> /private/var) do
  // not widen its scope; accept either spelling of that same selected directory.
  const fromDeclared = relative(resolve(declaredWorkspace), lexical);
  if (fromDeclared !== ".." && !fromDeclared.startsWith(`..${sep}`) && !isAbsolute(fromDeclared)) {
    lexical = resolve(workspace, fromDeclared);
  }
  assertWithin(workspace, lexical);
  assertUnprotected(lexical);
  let existing = lexical;
  const missing: string[] = [];
  while (true) {
    try {
      lstatSync(existing);
      break;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      if (existing === workspace) throw new Error("Workspace disappeared");
      missing.unshift(basename(existing));
      existing = dirname(existing);
    }
  }
  // Resolve the nearest existing ancestor, so a missing leaf cannot conceal a symlink escape.
  const ancestor = realpathSync(existing);
  assertWithin(workspace, ancestor);
  const path = resolve(ancestor, ...missing);
  assertWithin(workspace, path);
  assertUnprotected(path);
  return { path, exists: missing.length === 0 };
}

function assertWithin(root: string, path: string): void {
  const child = relative(root, path);
  if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child))
    throw new Error("Path escapes the authorized workspace or narrower root");
}

function assertUnprotected(path: string): void {
  for (const component of path.split(sep)) {
    const name = component.toLowerCase();
    if (
      protectedNames.has(name) ||
      name === ".env" ||
      name.startsWith(".env.") ||
      name.endsWith(".key") ||
      name.endsWith(".pem")
    ) {
      throw new Error("Protected credential path is not authorized by a workspace grant");
    }
  }
}

function hashFile(path: string, signal: AbortSignal): string {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > MAX_FILE_BYTES)
      throw new Error("Hash precondition requires a regular file of at most 64 MiB");
    const hash = createHash("sha256");
    const buffer = Buffer.alloc(64 * 1024);
    let total = 0;
    while (true) {
      if (signal.aborted) throw new Error("Precondition check cancelled");
      const bytes = readSync(fd, buffer);
      if (bytes === 0) break;
      total += bytes;
      if (total > MAX_FILE_BYTES) throw new Error("File grew beyond the hash precondition limit");
      hash.update(buffer.subarray(0, bytes));
    }
    const after = fstatSync(fd);
    if (
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    )
      throw new Error("File changed while checking preconditions");
    return hash.digest("hex");
  } finally {
    closeSync(fd);
  }
}
