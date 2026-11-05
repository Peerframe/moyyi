import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";

/** Cumulative matching time one regex search may spend before it stops as incomplete. */
export const REGEX_SEARCH_BUDGET_MS = 5_000;

// Runs as an eval worker so packaged builds need no extra file. It only tests lines; it never
// touches the filesystem, and the parent terminates it when time runs out or the run cancels.
const SOURCE = `
const { parentPort } = require("node:worker_threads");
let key, expression;
parentPort.on("message", ({ pattern, flags, text, limit }) => {
  if (key !== flags + "/" + pattern) {
    expression = new RegExp(pattern, flags);
    key = flags + "/" + pattern;
  }
  const lines = text.split("\\n");
  const hits = [];
  for (let index = 0; index < lines.length && hits.length < limit; index++)
    if (expression.test(lines[index])) hits.push(index);
  parentPort.postMessage(hits);
});
`;

/**
 * Compiles a model-supplied pattern without executing it. Unicode mode is preferred; a pattern
 * that only Annex B syntax accepts (for example an escaped quote) falls back to it, so ordinary
 * ripgrep-style escapes keep working. Lines are tested one at a time, so `^` and `$` are line
 * anchors and no flag can make a match span lines.
 */
export function compileLinePattern(
  pattern: string,
  caseSensitive: boolean,
): { pattern: string; flags: string } {
  const base = caseSensitive ? "" : "i";
  try {
    new RegExp(pattern, `${base}u`);
    return { pattern, flags: `${base}u` };
  } catch {}
  try {
    new RegExp(pattern, base);
  } catch (error) {
    throw new Error(`Invalid regular expression: ${(error as Error).message}`);
  }
  return { pattern, flags: base };
}

/**
 * Tests file lines against one regular expression in a worker thread. JavaScript regular
 * expressions can backtrack for a very long time on hostile input; running them off the runtime
 * thread keeps cancellation and every other run responsive, and a cumulative budget bounds the
 * whole search.
 */
export class RegexLines {
  readonly #pattern: string;
  readonly #flags: string;
  readonly #signal: AbortSignal;
  readonly #budgetMs: number;
  #worker: Worker | undefined;
  #spentMs = 0;

  constructor(
    compiled: { pattern: string; flags: string },
    signal: AbortSignal,
    budgetMs = REGEX_SEARCH_BUDGET_MS,
  ) {
    this.#pattern = compiled.pattern;
    this.#flags = compiled.flags;
    this.#signal = signal;
    this.#budgetMs = budgetMs;
  }

  /** Zero-based indexes of matching LF-delimited lines, at most `limit`, or `time_limit`. */
  async match(text: string, limit: number): Promise<number[] | "time_limit"> {
    if (this.#signal.aborted) throw new Error("File access cancelled");
    const remaining = this.#budgetMs - this.#spentMs;
    if (remaining <= 0) return "time_limit";
    if (!this.#worker) {
      this.#worker = new Worker(SOURCE, {
        eval: true,
        resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16 },
      });
      this.#worker.unref();
    }
    const worker = this.#worker;
    const started = performance.now();
    try {
      return await new Promise<number[] | "time_limit">((resolve, reject) => {
        const stop = (): void => {
          clearTimeout(timer);
          this.#signal.removeEventListener("abort", abort);
          worker.off("message", message);
          worker.off("error", failure);
          worker.off("exit", exit);
        };
        const discard = (): void => {
          stop();
          if (this.#worker === worker) this.#worker = undefined;
          void worker.terminate();
        };
        const timer = setTimeout(() => {
          discard();
          resolve("time_limit");
        }, remaining);
        const abort = (): void => {
          discard();
          reject(new Error("File access cancelled"));
        };
        const message = (hits: unknown): void => {
          stop();
          if (
            !Array.isArray(hits) ||
            hits.length > limit ||
            hits.some((hit) => !Number.isSafeInteger(hit) || hit < 0)
          )
            reject(new Error("Regular expression search returned an invalid result"));
          else resolve(hits as number[]);
        };
        const failure = (error: Error): void => {
          discard();
          reject(new Error(`Regular expression search failed: ${error.message}`));
        };
        const exit = (): void => {
          discard();
          reject(new Error("Regular expression search stopped unexpectedly"));
        };
        this.#signal.addEventListener("abort", abort, { once: true });
        worker.on("message", message);
        worker.once("error", failure);
        worker.once("exit", exit);
        worker.postMessage({ pattern: this.#pattern, flags: this.#flags, text, limit });
      });
    } finally {
      this.#spentMs += performance.now() - started;
    }
  }

  async close(): Promise<void> {
    const worker = this.#worker;
    this.#worker = undefined;
    await worker?.terminate();
  }
}
