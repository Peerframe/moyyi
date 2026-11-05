import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import {
  canonicalizeJson,
  type RunId,
  type RuntimeEvent,
  type SessionId,
} from "../contracts/index.ts";

/**
 * An owner-configured notification command. Hooks observe; they cannot block, approve or change a
 * run, and their output never reaches the model. Whatever a hook itself changes is outside
 * moyyi's effect journal and undo.
 */
export interface HookConfig {
  /** `approval.requested`, `tool.finished` (an effect reached a final state) or `run.finished`. */
  readonly on: "approval.requested" | "tool.finished" | "run.finished";
  /** Executable; a bare name is looked up on the PATH given to the hook. */
  readonly command: string;
  readonly args?: readonly string[];
  /** Added to a minimal PATH/HOME/LANG environment; nothing else is inherited. */
  readonly env?: Readonly<Record<string, string>>;
  /** Absolute working directory; default: home directory. */
  readonly cwd?: string;
  /** Only for `tool.finished`: tool names to report; default all. */
  readonly tools?: readonly string[];
  /** 1000..60000 ms; default 10000. The hook's process group is killed when it expires. */
  readonly timeoutMs?: number;
}

const EVENTS = new Set(["approval.requested", "tool.finished", "run.finished"]);
const MAX_HOOKS = 32;
const MAX_RUNNING = 4;
const MAX_QUEUED = 64;
const MAX_PREVIEW = 4096;
const FINAL = new Set(["succeeded", "failed", "denied", "cancelled", "unknown"]);

export function validateHooks(hooks: readonly HookConfig[]): readonly HookConfig[] {
  if (!Array.isArray(hooks) || hooks.length > MAX_HOOKS)
    throw Error(`At most ${MAX_HOOKS} hooks can be configured`);
  for (const hook of hooks) {
    if (!hook || !EVENTS.has(hook.on)) throw Error("Hook `on` must be a supported event");
    if (typeof hook.command !== "string" || !hook.command || hook.command.includes("\0"))
      throw Error("Each hook needs a command");
    if (
      hook.args &&
      (!Array.isArray(hook.args) ||
        (hook.args as readonly unknown[]).some((arg) => typeof arg !== "string"))
    )
      throw Error("Hook args must be strings");
    if (hook.cwd !== undefined && !isAbsolute(hook.cwd)) throw Error("Hook cwd must be absolute");
    const timeout = hook.timeoutMs ?? 10_000;
    if (!Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 60_000)
      throw Error("Hook timeoutMs must be 1000..60000");
    for (const [key, value] of Object.entries(hook.env ?? {}))
      if (typeof value !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(key))
        throw Error("Hook env must map names to strings");
    if (hook.tools && hook.on !== "tool.finished")
      throw Error("Hook `tools` applies to tool.finished");
  }
  return hooks.map((hook) => Object.freeze({ ...hook }));
}

/** Runs matching hooks for runtime events, bounded and never awaited by a run. */
export class HookRunner {
  readonly #hooks: readonly HookConfig[];
  readonly #diagnostics: { push(line: string): void };
  readonly #runSession = new Map<RunId, SessionId>();
  readonly #queue: (() => void)[] = [];
  readonly #running = new Set<Promise<void>>();
  readonly #children = new Set<number>();
  #closed = false;

  constructor(hooks: readonly HookConfig[], diagnostics: string[]) {
    this.#hooks = validateHooks(hooks);
    // Failing hooks must not grow host diagnostics without bound.
    this.#diagnostics = {
      push: (line) => {
        if (diagnostics.length < 1000) diagnostics.push(line);
      },
    };
  }

  observe(event: RuntimeEvent): void {
    if (this.#closed) return;
    if (event.type === "run.started") this.#runSession.set(event.runId, event.sessionId);
    const payload = this.#payload(event);
    if (!payload) return;
    if (event.type === "run.finished") this.#runSession.delete(event.runId);
    for (const hook of this.#hooks) {
      if (hook.on !== payload.event) continue;
      if (hook.tools && !hook.tools.includes(String(payload.tool))) continue;
      if (this.#queue.length + this.#running.size >= MAX_QUEUED + MAX_RUNNING) {
        this.#diagnostics.push(`hooks | ${hook.on} hook skipped: too many pending hooks`);
        continue;
      }
      this.#queue.push(() => this.#start(hook, payload));
      this.#drain();
    }
  }

  /** Stops accepting events and kills running hooks; queued hooks are dropped. */
  async close(): Promise<void> {
    this.#closed = true;
    this.#queue.length = 0;
    for (const pid of this.#children) kill(pid, "SIGKILL");
    await Promise.all([...this.#running]);
  }

  #payload(event: RuntimeEvent): Record<string, unknown> | undefined {
    switch (event.type) {
      case "approval.requested":
        return {
          event: "approval.requested",
          effectId: event.effectId,
          summary: event.summary,
          ...(event.preview === undefined ? {} : { preview: event.preview.slice(0, MAX_PREVIEW) }),
        };
      case "effect.updated":
        if (!FINAL.has(event.effect.state)) return undefined;
        return {
          event: "tool.finished",
          sessionId: this.#runSession.get(event.effect.runId) ?? null,
          runId: event.effect.runId,
          effectId: event.effect.id,
          tool: event.effect.tool,
          state: event.effect.state,
        };
      case "run.finished":
        return {
          event: "run.finished",
          sessionId: this.#runSession.get(event.runId) ?? null,
          runId: event.runId,
          outcome: event.outcome,
        };
      default:
        return undefined;
    }
  }

  #drain(): void {
    while (this.#running.size < MAX_RUNNING && this.#queue.length) this.#queue.shift()?.();
  }

  #start(hook: HookConfig, payload: Record<string, unknown>): void {
    const done = new Promise<void>((resolve) => {
      let stderr = "";
      const child = spawn(hook.command, [...(hook.args ?? [])], {
        cwd: hook.cwd ?? homedir(),
        env: {
          PATH: process.env.PATH ?? "/usr/bin:/bin",
          HOME: homedir(),
          ...(process.env.LANG ? { LANG: process.env.LANG } : {}),
          ...hook.env,
        },
        stdio: ["pipe", "ignore", "pipe"],
        detached: true,
      });
      if (child.pid) this.#children.add(child.pid);
      const timer = setTimeout(() => {
        if (child.pid) kill(child.pid, "SIGKILL");
        this.#diagnostics.push(`hooks | ${hook.on} hook timed out`);
      }, hook.timeoutMs ?? 10_000);
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString("utf8")).slice(-300);
      });
      child.stdin?.on("error", () => {});
      child.stdin?.end(`${canonicalizeJson(payload as never)}\n`);
      const finish = (failure?: string) => {
        clearTimeout(timer);
        if (child.pid) this.#children.delete(child.pid);
        if (failure) this.#diagnostics.push(`hooks | ${hook.on} hook ${failure}`);
        resolve();
      };
      child.once("error", (error) => finish(`failed to start: ${error.message}`));
      child.once("exit", (code, signal) =>
        finish(
          code === 0
            ? undefined
            : `exited ${signal ?? code}${stderr.trim() ? `: ${stderr.trim().replace(/\s+/gu, " ")}` : ""}`,
        ),
      );
    });
    this.#running.add(done);
    void done.finally(() => {
      this.#running.delete(done);
      this.#drain();
    });
  }
}

function kill(pid: number, signal: NodeJS.Signals): void {
  try {
    if (pid > 1) process.kill(-pid, signal);
  } catch {}
}
