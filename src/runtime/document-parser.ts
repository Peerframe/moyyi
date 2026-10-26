import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DocumentFormat } from "../contracts/index.ts";
import { documentSandbox } from "./document-sandbox.ts";

export interface ParsedDocument {
  readonly text: string;
  readonly truncated: boolean;
  readonly coverage: string;
}
const messages: Record<string, string> = {
  unsupported_structure:
    "Document contains unsupported XML structure; no partial body text was returned",
  unsupported_encoding: "Office XML encoding is unsupported; use a document with UTF-8 XML",
  invalid_document: "Document is damaged or does not match its supported format",
  password_required:
    "Document requires decryption before reading; do not send a password to the model",
  resource_limit: "Document exceeds a parser resource limit",
  unsupported_format: "Document format or macros are unsupported",
  no_readable_text: "Document has no readable body text; OCR is not enabled",
  dependency_unavailable: "Document parser dependency unavailable",
  sandbox_unavailable: "Document native sandbox unavailable; ordinary text reads remain available",
  timeout: "Document parsing exceeded 30 seconds",
  cancelled: "Document reading cancelled",
  revoked: "Document read permission was revoked",
  parser_failed: "Document parser failed without producing a valid bounded result",
};
export class DocumentAccessError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(messages[code] ?? messages.parser_failed);
    this.code = code;
  }
}

/** No model-provided executable, path or environment reaches this fixed parser process. */
export async function parseDocument(
  bytes: Buffer,
  format: DocumentFormat,
  signal: AbortSignal,
  guard: () => void,
): Promise<ParsedDocument> {
  const startedAt = performance.now();
  guard();
  if (signal.aborted) throw new DocumentAccessError("cancelled");
  if (bytes.length > 10 * 1024 * 1024) throw new DocumentAccessError("resource_limit");
  const scratch = await realpath(await mkdtemp(join(tmpdir(), "moyyi-document-")));
  try {
    guard();
    const worker = fileURLToPath(
      new URL(
        import.meta.url.endsWith(".ts") ? "./document-worker.ts" : "./document-worker.js",
        import.meta.url,
      ),
    );
    let plan: Awaited<ReturnType<typeof documentSandbox>>;
    try {
      plan = await documentSandbox(worker, scratch);
    } catch {
      throw new DocumentAccessError("sandbox_unavailable");
    }
    guard();
    const result = await runParser(
      plan,
      scratch,
      Buffer.concat([Buffer.from(`${JSON.stringify({ format, size: bytes.length })}\n`), bytes]),
      signal,
      guard,
      Math.max(1, 30_000 - (performance.now() - startedAt)),
    );
    guard();
    return result;
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

function runParser(
  plan: Awaited<ReturnType<typeof documentSandbox>>,
  scratch: string,
  input: Buffer,
  signal: AbortSignal,
  guard: () => void,
  timeoutMs: number,
): Promise<ParsedDocument> {
  return new Promise((resolveResult, reject) => {
    const bubblewrap = plan.backend === "bubblewrap";
    const child = spawn(plan.command, [...(bubblewrap ? ["--info-fd", "3"] : []), ...plan.args], {
      cwd: scratch,
      env: { ...plan.env },
      detached: true,
      stdio: ["pipe", "pipe", "pipe", ...(bubblewrap ? ["pipe" as const] : [])],
    });
    const chunks: Buffer[] = [];
    const infoChunks: Buffer[] = [];
    let length = 0,
      infoLength = 0,
      infoComplete = !bubblewrap,
      namespacePid: number | undefined,
      namespaceStart: string | undefined,
      namespaceGone = false,
      stderr = 0,
      stoppedAt: number | undefined,
      failure: string | undefined,
      spawnFailed = false,
      exited = false,
      closed = false,
      gone = false,
      finished = false,
      code: number | null = null;
    const launcherAlive = () => {
      if (gone || !child.pid) return false;
      try {
        process.kill(-child.pid, 0);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") {
          gone = true;
          return false;
        }
        return true;
      }
    };
    const namespaceAlive = () => {
      if (!bubblewrap || namespaceGone) return false;
      if (namespacePid === undefined) return !infoComplete;
      try {
        process.kill(namespacePid, 0);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") {
          namespaceGone = true;
          return false;
        }
        return true;
      }
    };
    const alive = () => {
      const launcher = launcherAlive();
      return namespaceAlive() || launcher;
    };
    const namespaceIdentity = (pid: number) => {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const fields = stat
        .slice(stat.lastIndexOf(")") + 2)
        .trim()
        .split(/\s+/u);
      const status = readFileSync(`/proc/${pid}/status`, "utf8");
      const ids = /^NSpid:\s+(.+)$/mu.exec(status)?.[1]?.trim().split(/\s+/u).map(Number);
      if (Number(fields[1]) !== child.pid || ids?.at(-1) !== 1 || !/^\d+$/u.test(fields[19] ?? ""))
        throw Error("Unexpected parser namespace identity");
      return fields[19];
    };
    const kill = (signal: NodeJS.Signals) => {
      if (bubblewrap) {
        // --new-session moves the parser outside the launcher's group. Keep the monitor
        // alive to reap namespace init; killing that monitor first races kernel teardown.
        if (namespacePid !== undefined && !namespaceGone && !exited) {
          try {
            // Refuse signals if the monitor no longer owns this exact namespace init.
            // This narrows PID-reuse races; it is not an atomic pidfd identity guarantee.
            if (namespaceIdentity(namespacePid) !== namespaceStart) {
              failure = "parser_failed";
              return;
            }
            process.kill(signal === "SIGKILL" ? namespacePid : -namespacePid, signal);
          } catch {
            // The session may not exist during setup. SIGKILL targets init itself.
          }
        }
        if (!infoComplete || namespacePid !== undefined) return;
      }
      if (!gone && child.pid) {
        try {
          process.kill(-child.pid, signal);
        } catch {
          /* Closure, not kill return, proves termination. */
        }
      }
    };
    const stop = (reason?: string) => {
      failure ??= reason;
      if (stoppedAt === undefined) {
        stoppedAt = performance.now();
        kill("SIGTERM");
      }
    };
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(deadline);
      clearInterval(poll);
      signal.removeEventListener("abort", abort);
      child.stdin.destroy();
      child.stdout.destroy();
      child.stderr.destroy();
      child.stdio[3]?.destroy();
      if (bubblewrap && namespacePid === undefined && !spawnFailed) failure = "parser_failed";
      if (failure || code !== 0) {
        reject(new DocumentAccessError(failure ?? "parser_failed"));
        return;
      }
      try {
        guard();
        const result: unknown = JSON.parse(Buffer.concat(chunks, length).toString("utf8"));
        if (!result || typeof result !== "object" || Array.isArray(result)) throw Error();
        const value = result as Record<string, unknown>;
        if (
          typeof value.error === "string" &&
          Object.keys(value).length === 1 &&
          value.error in messages
        ) {
          reject(new DocumentAccessError(value.error));
          return;
        }
        if (
          Object.keys(value).sort().join(",") !== "coverage,text,truncated" ||
          typeof value.text !== "string" ||
          value.text.length > 262144 ||
          !value.text.trim() ||
          !value.text.isWellFormed() ||
          typeof value.truncated !== "boolean" ||
          typeof value.coverage !== "string" ||
          value.coverage.length > 1024
        )
          throw Error();
        resolveResult({ text: value.text, truncated: value.truncated, coverage: value.coverage });
      } catch {
        reject(new DocumentAccessError("parser_failed"));
      }
    };
    const abort = () => stop("cancelled");
    const deadline = setTimeout(() => stop("timeout"), timeoutMs);
    const poll = setInterval(() => {
      try {
        guard();
      } catch {
        stop("revoked");
      }
      if (signal.aborted) stop("cancelled");
      if (stoppedAt === undefined) return;
      const age = performance.now() - stoppedAt;
      if (age >= 200) kill("SIGKILL");
      if (exited && closed && !alive()) finish();
      else if (age >= 1500) {
        kill("SIGKILL");
        if (!gone && child.pid) {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            /* Unconfirmed cleanup must never be reported as a completed cancellation. */
          }
        }
        failure = "parser_failed";
        finish();
      }
    }, 25);
    if (bubblewrap) {
      // Only the trusted bwrap monitor writes this separate FD; worker stdout is never PID data.
      const info = child.stdio[3];
      info?.on("data", (chunk: Buffer) => {
        infoLength += chunk.length;
        if (infoLength > 4096) {
          infoComplete = true;
          info.destroy();
          failure = "parser_failed";
          stop("parser_failed");
        } else infoChunks.push(chunk);
      });
      info?.once("end", () => {
        infoComplete = true;
        try {
          const value: unknown = JSON.parse(Buffer.concat(infoChunks, infoLength).toString("utf8"));
          if (!value || typeof value !== "object" || Array.isArray(value)) throw Error();
          const pid = (value as Record<string, unknown>)["child-pid"];
          if (!Number.isSafeInteger(pid) || (pid as number) <= 1 || pid === child.pid)
            throw Error();
          namespacePid = pid as number;
          if (!namespaceAlive()) throw Error();
          namespaceStart = namespaceIdentity(namespacePid);
        } catch {
          failure = "parser_failed";
          stop("parser_failed");
          return;
        }
        if (stoppedAt !== undefined) {
          kill("SIGTERM");
          return;
        }
        try {
          guard();
        } catch {
          stop("revoked");
          return;
        }
        if (signal.aborted) {
          stop("cancelled");
          return;
        }
        // Capture identity and recheck authority before the first document byte is delivered.
        child.stdin.end(input);
      });
      info?.once("error", () => {
        infoComplete = true;
        failure = "parser_failed";
        stop("parser_failed");
      });
    }
    child.stdout.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length > 2 * 1024 * 1024) stop("resource_limit");
      else chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.length;
      if (stderr > 65536) stop("resource_limit");
    });
    child.once("error", () => {
      spawnFailed = child.pid === undefined;
      if (spawnFailed) infoComplete = true;
      exited = true;
      stop("sandbox_unavailable");
    });
    child.once("exit", (exitCode) => {
      exited = true;
      code = exitCode;
      stop();
    });
    child.once("close", () => {
      closed = true;
      if (exited && !alive()) finish();
    });
    // A parser may reject its header before all bytes are consumed. Never leak an EPIPE.
    child.stdin.on("error", () => {});
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    if (!bubblewrap) child.stdin.end(input);
  });
}
