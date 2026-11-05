import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  BackgroundProcessAccess,
  BackgroundProcessAccessFactory,
  BackgroundProcessView,
  PreparedProcess,
  SessionId,
  ToolContext,
} from "../../contracts/index.ts";
import type { prepareNativeSandbox } from "./sandbox.ts";

type Plan = Awaited<ReturnType<typeof prepareNativeSandbox>>;

export const MAX_BACKGROUND_RUNNING = 4;
const MAX_RETAINED_BYTES = 1024 * 1024;
const MAX_ENTRIES = 32;
const TERMINATE_GRACE_MS = 200;
const STOP_DEADLINE_MS = 1_500;
const POLL_MS = 100;

interface Entry {
  readonly handle: string;
  readonly sessionId: SessionId;
  readonly command: string;
  state: BackgroundProcessView["state"];
  exitCode: number | null;
  /** Tail of the output; `retainedStart` is the absolute offset of its first byte. */
  retained: Buffer;
  retainedStart: number;
  total: number;
  readOffset: number;
  done: Promise<void>;
  stop(state: BackgroundProcessView["state"]): void;
}

/**
 * Commands the owner approved to keep running after their call returns (dev servers, watchers,
 * long builds). Each stays in the same OS sandbox as a foreground command and is stopped by
 * shell_stop, its own time limit, a grant revocation or runtime close. Handles are bound to the
 * session that started them. Output is kept as a bounded tail.
 */
export class BackgroundProcesses implements BackgroundProcessAccessFactory {
  readonly #entries = new Map<string, Entry>();
  #next = 1;
  #closed = false;

  get running(): number {
    return [...this.#entries.values()].filter((entry) => entry.state === "running").length;
  }

  /** Spawns the sandboxed group; the caller has already re-checked the approved proposal. */
  start(input: {
    readonly plan: Plan;
    readonly proposal: PreparedProcess;
    readonly sessionId: SessionId;
    readonly scratch: string;
    /** False once the grant this command started under is revoked or replaced. */
    readonly authorized: () => boolean;
  }): string {
    if (this.#closed) throw Error("Background commands are closed");
    if (this.running >= MAX_BACKGROUND_RUNNING)
      throw Error(
        `At most ${MAX_BACKGROUND_RUNNING} background commands may run; stop one with shell_stop`,
      );
    this.#prune();
    const handle = `bg_${this.#next++}`;
    const child = spawn(input.plan.command, [...input.plan.args], {
      cwd: resolve(input.proposal.workspaceRoot, input.proposal.cwd),
      env: { ...input.plan.env },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let groupGone = false;
    let exited = false;
    let closed = false;
    let stoppingAt: number | undefined;
    let killed = false;
    let settle!: () => void;
    const entry: Entry = {
      handle,
      sessionId: input.sessionId,
      command: input.proposal.command,
      state: "running",
      exitCode: null,
      retained: Buffer.alloc(0),
      retainedStart: 0,
      total: 0,
      readOffset: 0,
      done: new Promise<void>((resolveDone) => {
        settle = resolveDone;
      }),
      stop: (state) => {
        if (entry.state === "running") entry.state = state;
        if (stoppingAt === undefined) {
          stoppingAt = performance.now();
          signal("SIGTERM");
        }
      },
    };
    const signal = (name: NodeJS.Signals) => {
      if (groupGone || !child.pid || child.pid < 2 || child.pid === process.pid) return;
      try {
        process.kill(-child.pid, name);
      } catch {}
    };
    const alive = () => {
      if (groupGone || !child.pid) return false;
      try {
        process.kill(-child.pid, 0);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") {
          groupGone = true;
          return false;
        }
        return true;
      }
    };
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      clearInterval(poll);
      child.stdout.destroy();
      child.stderr.destroy();
      void rm(input.scratch, { recursive: true, force: true }).finally(settle);
    };
    const deadline = setTimeout(() => entry.stop("timeout"), input.proposal.timeoutMs);
    const poll = setInterval(() => {
      if (finished) return;
      if (entry.state === "running" && !input.authorized()) entry.stop("revoked");
      if (stoppingAt === undefined) {
        // The shell itself exited; children it left behind are stopped with the group.
        if (exited && closed) {
          if (alive()) entry.stop(entry.state);
          else finish();
        }
        return;
      }
      const age = performance.now() - stoppingAt;
      if (!killed && age >= TERMINATE_GRACE_MS) {
        killed = true;
        signal("SIGKILL");
      }
      if (exited && closed && !alive()) finish();
      else if (age >= STOP_DEADLINE_MS) {
        signal("SIGKILL");
        if (!exited) entry.state = "unknown";
        finish();
      }
    }, POLL_MS);
    const collect = (chunk: Buffer) => {
      entry.total += chunk.length;
      const joined = Buffer.concat([entry.retained, chunk]);
      const drop = Math.max(0, joined.length - MAX_RETAINED_BYTES);
      entry.retained = drop ? Buffer.from(joined.subarray(drop)) : joined;
      entry.retainedStart += drop;
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", () => {
      exited = true;
      if (entry.state === "running") entry.state = "unknown";
      entry.stop(entry.state);
    });
    child.once("exit", (code, signalName) => {
      exited = true;
      if (entry.state === "running") {
        entry.state = signalName === null && code !== null ? "exited" : "unknown";
        entry.exitCode = code;
      }
    });
    child.once("close", () => {
      closed = true;
    });
    this.#entries.set(handle, entry);
    return handle;
  }

  create(context: ToolContext, assertAuthorized: () => void): BackgroundProcessAccess {
    const find = (handle: string): Entry => {
      if (context.signal.aborted) throw Error("Background access cancelled");
      assertAuthorized();
      const entry = typeof handle === "string" ? this.#entries.get(handle) : undefined;
      // A handle from another session is reported exactly like an unknown one.
      if (!entry || !context.sessionId || entry.sessionId !== context.sessionId)
        throw Error("Unknown background command handle for this session");
      return entry;
    };
    return Object.freeze({
      output: async (handle: string, maxBytes: number) => read(find(handle), maxBytes),
      stop: async (handle: string) => {
        const entry = find(handle);
        entry.stop("stopped");
        await entry.done;
        return read(entry, context.limits.maxOutputBytes);
      },
    });
  }

  async closeAll(): Promise<void> {
    this.#closed = true;
    const entries = [...this.#entries.values()];
    for (const entry of entries) entry.stop("stopped");
    await Promise.all(entries.map((entry) => entry.done));
  }

  #prune(): void {
    const finished = [...this.#entries.values()].filter((entry) => entry.state !== "running");
    while (this.#entries.size >= MAX_ENTRIES && finished.length) {
      const oldest = finished.shift() as Entry;
      this.#entries.delete(oldest.handle);
    }
  }
}

function read(entry: Entry, maxBytes: number): BackgroundProcessView {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 64) throw Error("Invalid output size");
  const droppedBytes = Math.max(0, entry.retainedStart - entry.readOffset);
  let start = Math.max(entry.readOffset, entry.retainedStart) - entry.retainedStart;
  // Never begin or end inside a UTF-8 sequence.
  while (start < entry.retained.length && ((entry.retained[start] as number) & 0xc0) === 0x80)
    start++;
  let end = Math.min(entry.retained.length, start + maxBytes);
  if (end < entry.retained.length)
    while (end > start && ((entry.retained[end] as number) & 0xc0) === 0x80) end--;
  entry.readOffset = entry.retainedStart + end;
  return {
    handle: entry.handle,
    command: entry.command,
    state: entry.state,
    exitCode: entry.exitCode,
    output: entry.retained.subarray(start, end).toString("utf8"),
    droppedBytes,
    more: end < entry.retained.length,
  };
}
