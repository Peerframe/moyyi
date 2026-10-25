import { spawn } from "node:child_process";
import { accessSync, constants, lstatSync, realpathSync, type Stats } from "node:fs";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type {
  PreparedProcess,
  ProcessRequest,
  ProcessResult,
  ToolContext,
  WorkspaceProcesses,
  WorkspaceProcessesFactory,
  WorkspaceWriteScope,
} from "../contracts/index.ts";
import { assertUnprotected } from "./preconditions.ts";
import { prepareNativeSandbox } from "./sandbox.ts";

const MAX_COMMAND_BYTES = 16_384;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const TERMINATE_GRACE_MS = 200;
const STOP_DEADLINE_MS = 1_500;

type Identity = { readonly path: string; readonly dev: number; readonly ino: number };
export interface WorkspaceProcessOptions {
  readonly roots: readonly string[];
  readonly protectedPaths?: readonly string[];
  /** Explicit trusted tool installations; never taken from model input or PATH. */
  readonly executablePaths?: readonly string[];
  readonly readOnlyPaths?: readonly string[];
}

/** One executor-approved command, with independent authority and an OS-enforced boundary. */
export class NodeWorkspaceProcesses implements WorkspaceProcessesFactory {
  private readonly roots: readonly Identity[];
  private readonly options: WorkspaceProcessOptions;

  constructor(options: WorkspaceProcessOptions) {
    if (!options.roots.length) throw Error("Process grants require at least one workspace");
    this.roots = options.roots.map((root) => {
      if (!isAbsolute(root)) throw Error("Process workspace must be absolute");
      const stat = lstatSync(root);
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw Error("Process workspace must be a real directory");
      const path = realpathSync(root);
      assertUnprotected(path);
      return identity(path, stat);
    });
    this.options = {
      roots: this.roots.map(({ path }) => path),
      protectedPaths: [...(options.protectedPaths ?? [])],
      executablePaths: [...(options.executablePaths ?? [])],
      readOnlyPaths: [...(options.readOnlyPaths ?? [])],
    };
  }

  create(
    context: ToolContext,
    assertAuthorized: () => void,
    scope: WorkspaceWriteScope,
  ): WorkspaceProcesses {
    let used = false;
    // A retained mutable proposal cannot change the command after capability creation.
    const approved: unknown = scope.action ? structuredClone(scope.action.payload) : undefined;
    const guard = () => {
      if (context.signal.aborted) throw Error("Process capability cancelled");
      assertAuthorized();
    };
    const prepare = (request: ProcessRequest): PreparedProcess => {
      guard();
      validateRequest(request);
      const root = this.root(context.workspaceRoot);
      const cwd = resolveDirectory(root.path, request.cwd, this.options.protectedPaths ?? []);
      const backend = availableBackend();
      guard();
      return Object.freeze({
        command: request.command,
        cwd: relative(root.path, cwd.path).split(sep).join("/") || ".",
        timeoutMs: request.timeoutMs,
        workspaceRoot: root.path,
        backend,
        directoryIdentity: `${root.dev}:${root.ino}/${cwd.dev}:${cwd.ino}`,
      });
    };
    return Object.freeze({
      prepare: async (request: ProcessRequest) => {
        if (scope.phase !== "prepare") throw Error("Process preparation capability is unavailable");
        return prepare(request);
      },
      run: async () => {
        guard();
        if (
          used ||
          scope.phase !== "execute" ||
          !scope.action ||
          !scope.effect ||
          scope.effect.state !== "started" ||
          scope.effect.profile.class !== "process" ||
          scope.effect.runId !== context.runId ||
          scope.effect.digest !== scope.action.digest
        )
          throw Error("Process execution requires a single approved, durable started effect");
        used = true;
        const proposal = parseApproved(approved);
        const fresh = prepare(proposal);
        if (
          fresh.workspaceRoot !== proposal.workspaceRoot ||
          fresh.cwd !== proposal.cwd ||
          fresh.backend !== proposal.backend ||
          fresh.directoryIdentity !== proposal.directoryIdentity
        )
          throw Error("Process workspace changed after approval; nothing executed");
        const scratch = await mkdtemp(join(tmpdir(), "moyyi-process-"));
        try {
          await chmod(scratch, 0o700);
          guard();
          const plan = await prepareNativeSandbox({
            workspaceRoot: proposal.workspaceRoot,
            cwd: resolve(proposal.workspaceRoot, proposal.cwd),
            protectedPaths: this.options.protectedPaths ?? [],
            executablePaths: this.options.executablePaths ?? [],
            readOnlyPaths: this.options.readOnlyPaths ?? [],
            scratchDirectory: realpathSync(scratch),
            commandText: proposal.command,
          });
          guard();
          // Recheck after asynchronous profile construction and immediately before spawn.
          const current = prepare(proposal);
          if (
            current.directoryIdentity !== proposal.directoryIdentity ||
            plan.backend !== proposal.backend
          )
            throw Error("Process workspace changed while preparing isolation; nothing executed");
          return await runGroup(plan, proposal, context, assertAuthorized);
        } finally {
          await rm(scratch, { recursive: true, force: true });
        }
      },
    });
  }

  private root(input: string): Identity {
    if (!isAbsolute(input)) throw Error("Process workspace must be absolute");
    const stat = lstatSync(input);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error("Process workspace changed");
    const path = realpathSync(input);
    const root = this.roots.find((entry) => entry.path === path);
    if (!root || root.dev !== stat.dev || root.ino !== stat.ino)
      throw Error("Process workspace is outside the current explicit grant");
    return root;
  }
}

function validateRequest(request: ProcessRequest): void {
  if (
    !request ||
    typeof request !== "object" ||
    typeof request.command !== "string" ||
    !request.command.trim() ||
    !request.command.isWellFormed() ||
    request.command.includes("\0") ||
    Buffer.byteLength(request.command) > MAX_COMMAND_BYTES ||
    typeof request.cwd !== "string" ||
    !request.cwd ||
    request.cwd.length > 4_096 ||
    request.cwd.includes("\0") ||
    !request.cwd.isWellFormed() ||
    !Number.isSafeInteger(request.timeoutMs) ||
    request.timeoutMs < 1 ||
    request.timeoutMs > MAX_TIMEOUT_MS
  )
    throw Error("Invalid or oversized process request");
}

function parseApproved(value: unknown): PreparedProcess {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("Invalid approved process");
  const result = value as PreparedProcess;
  validateRequest(result);
  if (
    Object.keys(result).sort().join(",") !==
      "backend,command,cwd,directoryIdentity,timeoutMs,workspaceRoot" ||
    typeof result.workspaceRoot !== "string" ||
    typeof result.directoryIdentity !== "string" ||
    !["seatbelt", "bubblewrap"].includes(result.backend)
  )
    throw Error("Invalid approved process");
  return result;
}

function resolveDirectory(root: string, cwd: string, excluded: readonly string[]): Identity {
  if (isAbsolute(cwd) || cwd.split(/[\\/]/).includes(".."))
    throw Error("Process cwd must stay within the workspace");
  const target = resolve(root, cwd);
  assertUnprotected(target);
  const child = relative(root, target);
  if (child === ".." || child.startsWith(`..${sep}`) || isAbsolute(child))
    throw Error("Process cwd escapes workspace");
  let current = root;
  for (const component of child.split(sep).filter(Boolean)) {
    if ([".git", ".moyyi", ".codex"].includes(component.toLowerCase()))
      throw Error("Protected process cwd");
    current = join(current, component);
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw Error("Process cwd must use real directories");
  }
  for (const path of excluded) {
    if (!isAbsolute(path)) throw Error("Protected paths must be absolute");
    const resolved = resolveExisting(path);
    for (const denied of [resolve(path), resolved]) {
      const rel = relative(denied, target);
      if (!rel || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)))
        throw Error("Protected process cwd");
    }
  }
  return identity(realpathSync(target), lstatSync(target));
}

function resolveExisting(input: string): string {
  let ancestor = resolve(input);
  const suffix: string[] = [];
  for (;;) {
    try {
      return resolve(realpathSync(ancestor), ...suffix);
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT" ||
        dirname(ancestor) === ancestor
      )
        throw error;
      suffix.unshift(ancestor.slice(dirname(ancestor).length + 1));
      ancestor = dirname(ancestor);
    }
  }
}
function identity(path: string, stat: Stats): Identity {
  return { path, dev: stat.dev, ino: stat.ino };
}

function availableBackend(): PreparedProcess["backend"] {
  const command =
    process.platform === "darwin"
      ? "/usr/bin/sandbox-exec"
      : process.platform === "linux"
        ? "/usr/bin/bwrap"
        : undefined;
  if (!command) throw Error("Native process sandbox is unavailable on this platform");
  try {
    accessSync(command, constants.X_OK);
  } catch {
    throw Error("Native process sandbox is unavailable; unrestricted execution is forbidden");
  }
  return process.platform === "darwin" ? "seatbelt" : "bubblewrap";
}

async function runGroup(
  plan: Awaited<ReturnType<typeof prepareNativeSandbox>>,
  proposal: PreparedProcess,
  context: ToolContext,
  assertAuthorized: () => void,
): Promise<ProcessResult> {
  const cap = Math.min(context.limits.maxOutputBytes, MAX_OUTPUT_BYTES);
  if (!Number.isSafeInteger(cap) || cap < 1) throw Error("Invalid process output limit");
  return new Promise((resolveResult) => {
    const output: Buffer[] = [];
    let bytes = 0;
    let truncated = false;
    let termination: ProcessResult["termination"] | undefined;
    let exitCode: number | null = null;
    let exited = false;
    let closed = false;
    let finished = false;
    let stoppingAt: number | undefined;
    let killed = false;
    let groupGone = false;
    const child = spawn(plan.command, [...plan.args], {
      cwd: resolve(proposal.workspaceRoot, proposal.cwd),
      env: { ...plan.env },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const signalGroup = (signal: NodeJS.Signals) => {
      if (groupGone || !child.pid || child.pid < 2 || child.pid === process.pid) return;
      try {
        process.kill(-child.pid, signal);
      } catch {
        // A group can disappear or become unsignalable while the child exits. Confirm
        // closure below; an error is not evidence either of success or of a live group.
      }
    };
    const groupAlive = () => {
      if (groupGone || !child.pid) return false;
      try {
        process.kill(-child.pid, 0);
        return true;
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ESRCH") {
          // Never target a recycled numeric group after observing this group's disappearance.
          groupGone = true;
          return false;
        }
        return true;
      }
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      clearInterval(poll);
      context.signal.removeEventListener("abort", aborted);
      child.stdout.destroy();
      child.stderr.destroy();
      // A bounded UTF-8 decoder does not publish a cut codepoint as a replacement character.
      const text = new TextDecoder().decode(Buffer.concat(output, bytes), { stream: true });
      resolveResult({ termination: termination ?? "unknown", exitCode, output: text, truncated });
    };
    const stop = (reason: ProcessResult["termination"]) => {
      if (!termination || termination === "exited") termination = reason;
      if (stoppingAt === undefined) {
        stoppingAt = performance.now();
        signalGroup("SIGTERM");
      }
    };
    const aborted = () => stop("cancelled");
    const deadline = setTimeout(() => stop("timeout"), proposal.timeoutMs);
    const poll = setInterval(() => {
      if (finished) return;
      try {
        assertAuthorized();
      } catch {
        stop("revoked");
      }
      if (context.signal.aborted) stop("cancelled");
      if (stoppingAt === undefined) return;
      const age = performance.now() - stoppingAt;
      const alive = groupAlive();
      if (!killed && age >= TERMINATE_GRACE_MS) {
        killed = true;
        signalGroup("SIGKILL");
      }
      if (exited && closed && !alive) finish();
      else if (age >= STOP_DEADLINE_MS) {
        signalGroup("SIGKILL");
        // Detached descendants can retain pipes beyond the owned group. Never wait forever
        // or label this uncertain outcome a clean exit.
        termination = "unknown";
        finish();
      }
    }, 25);
    const collect = (chunk: Buffer) => {
      if (finished) return;
      const remaining = cap - bytes;
      if (remaining > 0) {
        const retained = Buffer.from(chunk.subarray(0, remaining));
        output.push(retained);
        bytes += retained.length;
      }
      if (chunk.length > remaining) {
        truncated = true;
        stop("output_limit");
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", () => {
      termination = "unknown";
      exited = true;
      stop("unknown");
    });
    child.once("exit", (code, signal) => {
      exited = true;
      exitCode = code;
      if (!termination) termination = signal === null && code !== null ? "exited" : "unknown";
      // Even successful shells can leave background children holding pipes or modifying files.
      stop(termination);
    });
    child.once("close", () => {
      closed = true;
      if (exited && !groupAlive()) finish();
    });
    context.signal.addEventListener("abort", aborted, { once: true });
    if (context.signal.aborted) aborted();
  });
}
