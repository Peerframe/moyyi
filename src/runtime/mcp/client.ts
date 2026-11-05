import { type ChildProcess, spawn } from "node:child_process";

/** Protocol versions this client speaks; the newest is offered first. */
export const MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
const MAX_LINE_BYTES = 4 * 1024 * 1024;
const MAX_STDERR_BYTES = 4096;

export interface McpStdioOptions {
  readonly command: string;
  readonly args: readonly string[];
  /** Complete environment for the server; nothing else is inherited. */
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
  readonly startupTimeoutMs: number;
}

export class McpError extends Error {
  override readonly name = "McpError";
}

interface Pending {
  resolve(value: unknown): void;
  reject(error: Error): void;
}

/**
 * Minimal MCP client over the stdio transport: newline-delimited JSON-RPC 2.0. Server requests
 * other than ping are answered "method not found"; notifications are ignored. Every frame is
 * size-bounded and the server's stderr is kept only as a short tail for diagnostics.
 */
export class McpStdioClient {
  readonly #child: ChildProcess;
  readonly #pending = new Map<number, Pending>();
  #next = 1;
  #buffer = Buffer.alloc(0);
  #closed = false;
  #stderr = "";
  #exit: Promise<void>;
  protocolVersion: string | undefined;

  private constructor(options: McpStdioOptions) {
    this.#child = spawn(options.command, [...options.args], {
      cwd: options.cwd,
      env: { ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
      detached: true,
    });
    this.#exit = new Promise((resolve) => {
      this.#child.once("exit", () => resolve());
      this.#child.once("error", () => resolve());
    });
    this.#child.stdout?.on("data", (chunk: Buffer) => this.#receive(chunk));
    this.#child.stderr?.on("data", (chunk: Buffer) => {
      this.#stderr = (this.#stderr + chunk.toString("utf8")).slice(-MAX_STDERR_BYTES);
    });
    this.#child.stdin?.on("error", () => {});
    this.#child.once("error", (error) =>
      this.#fail(new McpError(`MCP server failed to start: ${error.message}`)),
    );
    this.#child.once("exit", (code, signal) =>
      this.#fail(new McpError(`MCP server exited (${signal ?? code})`)),
    );
  }

  static async start(options: McpStdioOptions): Promise<McpStdioClient> {
    const client = new McpStdioClient(options);
    try {
      const result = (await client.request(
        "initialize",
        {
          protocolVersion: MCP_PROTOCOL_VERSIONS[0],
          capabilities: {},
          clientInfo: { name: "moyyi", version: "0.0.0" },
        },
        options.startupTimeoutMs,
      )) as { protocolVersion?: unknown } | null;
      const version = result?.protocolVersion;
      if (
        typeof version !== "string" ||
        !(MCP_PROTOCOL_VERSIONS as readonly string[]).includes(version)
      )
        throw new McpError("MCP server chose an unsupported protocol version");
      client.protocolVersion = version;
      client.#send({ jsonrpc: "2.0", method: "notifications/initialized" });
      return client;
    } catch (error) {
      await client.close();
      throw error;
    }
  }

  /** Last lines the server wrote to stderr; diagnostic text, never shown to the model. */
  get stderr(): string {
    return this.#stderr;
  }

  get closed(): boolean {
    return this.#closed;
  }

  request(
    method: string,
    params: unknown,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    if (this.#closed) return Promise.reject(new McpError("MCP server is not running"));
    const id = this.#next++;
    return new Promise<unknown>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", aborted);
        this.#pending.delete(id);
      };
      const cancel = (reason: string) => {
        cleanup();
        // Ask the server to stop; its late reply, if any, is ignored.
        this.#send({
          jsonrpc: "2.0",
          method: "notifications/cancelled",
          params: { requestId: id, reason },
        });
      };
      const timer = setTimeout(() => {
        cancel("timeout");
        reject(new McpError(`MCP ${method} timed out after ${timeoutMs} ms`));
      }, timeoutMs);
      const aborted = () => {
        cancel("cancelled");
        reject(new McpError(`MCP ${method} was cancelled`));
      };
      this.#pending.set(id, {
        resolve: (value) => {
          cleanup();
          resolve(value);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      });
      if (signal?.aborted) return aborted();
      signal?.addEventListener("abort", aborted, { once: true });
      this.#send({ jsonrpc: "2.0", id, method, params });
    });
  }

  async close(): Promise<void> {
    if (!this.#closed) this.#fail(new McpError("MCP server closed"));
    const pid = this.#child.pid;
    const kill = (signal: NodeJS.Signals) => {
      try {
        if (pid && pid > 1) process.kill(-pid, signal);
      } catch {}
    };
    if (this.#child.exitCode === null && this.#child.signalCode === null) {
      this.#child.stdin?.end();
      kill("SIGTERM");
      const timer = setTimeout(() => kill("SIGKILL"), 1000);
      await Promise.race([this.#exit, new Promise((resolve) => setTimeout(resolve, 2000))]);
      clearTimeout(timer);
    }
  }

  #send(message: unknown): void {
    if (this.#closed || !this.#child.stdin?.writable) return;
    this.#child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #fail(error: Error): void {
    this.#closed = true;
    for (const waiter of [...this.#pending.values()]) waiter.reject(error);
    this.#pending.clear();
  }

  #receive(chunk: Buffer): void {
    this.#buffer = Buffer.concat([this.#buffer, chunk]);
    for (;;) {
      const newline = this.#buffer.indexOf(10);
      if (newline === -1) {
        if (this.#buffer.length > MAX_LINE_BYTES) {
          this.#fail(new McpError("MCP server sent an oversized message"));
          void this.close();
        }
        return;
      }
      if (newline > MAX_LINE_BYTES) {
        this.#fail(new McpError("MCP server sent an oversized message"));
        void this.close();
        return;
      }
      const line = this.#buffer.subarray(0, newline).toString("utf8").trim();
      this.#buffer = this.#buffer.subarray(newline + 1);
      if (!line) continue;
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      if (typeof message !== "object" || message === null) continue;
      this.#dispatch(message);
    }
  }

  #dispatch(message: Record<string, unknown>): void {
    const { id, method } = message;
    if (typeof method === "string") {
      // A request from the server: this client offers no roots, sampling or elicitation.
      if (id === undefined) return;
      if (method === "ping") this.#send({ jsonrpc: "2.0", id, result: {} });
      else this.#send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
      return;
    }
    if (typeof id !== "number") return;
    const waiter = this.#pending.get(id);
    if (!waiter) return;
    if (message.error !== undefined) {
      const detail = message.error as { message?: unknown } | null;
      waiter.reject(
        new McpError(
          `MCP server error: ${typeof detail?.message === "string" ? detail.message.slice(0, 500) : "unknown"}`,
        ),
      );
    } else waiter.resolve(message.result);
  }
}
