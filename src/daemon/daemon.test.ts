import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { RuntimeEvent } from "../contracts/index.ts";
import { createCliRuntime } from "../runtime/cli-host.ts";
import type { Runtime } from "../runtime/index.ts";
import { connectDaemon, type DaemonConnection } from "./client.ts";
import { readToken } from "./paths.ts";
import { startDaemonServer } from "./server.ts";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function daemon(options: { approveReads?: boolean; helloTimeoutMs?: number } = {}) {
  const root = mkdtempSync(join(tmpdir(), "moyyi-d-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "w");
  const data = join(root, "d");
  mkdirSync(workspace);
  writeFileSync(join(workspace, "README.md"), "Daemon fixture.\n");
  const runtime = await createCliRuntime({
    demo: true,
    dataDirectory: data,
    approveReads: options.approveReads ?? false,
    launch: { workspaceRoot: workspace },
  });
  cleanups.push(() => runtime.close());
  const server = await startDaemonServer({
    runtime,
    dataDirectory: data,
    workspaceRoot: workspace,
    notices: ["grants | none"],
    ...(options.helloTimeoutMs ? { helloTimeoutMs: options.helloTimeoutMs } : {}),
  });
  cleanups.push(() => server.close());
  return { root, workspace, data, runtime, server };
}

async function client(data: string) {
  const connection = await connectDaemon({ dataDirectory: data });
  cleanups.push(() => connection.close());
  const events: RuntimeEvent[] = [];
  connection.subscribe((event) => events.push(event));
  return { connection, events };
}

function waitFor<T>(check: () => T | undefined, timeoutMs = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      const value = check();
      if (value !== undefined) return resolve(value);
      if (Date.now() - started > timeoutMs) return reject(Error("Timed out waiting"));
      setTimeout(poll, 10);
    };
    poll();
  });
}

async function createSession(c: { connection: DaemonConnection; events: RuntimeEvent[] }) {
  await c.connection.send({ type: "session.create", workspaceRoot: c.connection.workspaceRoot });
  const ready = c.events.find((event) => event.type === "session.ready");
  if (ready?.type !== "session.ready") throw Error("No session.ready before the ack");
  return ready.sessionId;
}

/** Raw socket for wire-level misuse; resolves with everything received once the daemon closes. */
function raw(path: string, lines: string[]): Promise<string> {
  return new Promise((resolve) => {
    const socket = connect(path);
    let received = "";
    socket.on("connect", () => {
      for (const line of lines) socket.write(line);
    });
    socket.on("data", (chunk) => {
      received += chunk.toString();
    });
    socket.on("error", () => {});
    socket.on("close", () => resolve(received));
  });
}

const finished = (events: RuntimeEvent[]) =>
  events.find((event) => event.type === "run.finished") as
    | Extract<RuntimeEvent, { type: "run.finished" }>
    | undefined;

describe("local daemon over a private Unix socket", () => {
  it("runs a real session for a connected client, delivering replies before the ack", async () => {
    const d = await daemon();
    const a = await client(d.data);
    expect(a.connection.workspaceRoot).toBe(d.workspace);
    expect(a.connection.notices).toEqual(["grants | none"]);
    expect(a.connection.plugins.length).toBeGreaterThan(0);
    const sessionId = await createSession(a);
    await a.connection.send({
      type: "run.start",
      sessionId,
      input: [{ type: "text", text: "Inspect the README" }],
    });
    const outcome = await waitFor(() => finished(a.events));
    expect(outcome.outcome).toEqual({ kind: "completed" });
    expect(a.events.some((event) => event.type === "assistant.delta")).toBe(true);
    expect(
      a.events.some(
        (event) => event.type === "effect.updated" && event.effect.state === "succeeded",
      ),
    ).toBe(true);
    await a.connection.idle();
  });

  it("keeps each client's replies and unrelated sessions apart, and shares a loaded session", async () => {
    const d = await daemon();
    const a = await client(d.data);
    const b = await client(d.data);
    const sessionId = await createSession(a);
    expect(b.events).toEqual([]);
    await a.connection.send({
      type: "run.start",
      sessionId,
      input: [{ type: "text", text: "Go" }],
    });
    await waitFor(() => finished(a.events));
    expect(b.events).toEqual([]);
    const before = a.events.length;
    await b.connection.send({ type: "session.load", sessionId });
    expect(b.events.filter((event) => event.type === "entry.appended").length).toBeGreaterThan(0);
    expect(a.events.length).toBe(before);
    await b.connection.send({
      type: "run.start",
      sessionId,
      input: [{ type: "text", text: "Again" }],
    });
    await waitFor(() =>
      a.events.slice(before).some((e) => e.type === "run.finished") ? 1 : undefined,
    );
    expect(finished(b.events)?.outcome).toEqual({ kind: "completed" });
  });

  it("lets a second client answer an approval with the displayed digest", async () => {
    const d = await daemon({ approveReads: true });
    const a = await client(d.data);
    const b = await client(d.data);
    const sessionId = await createSession(a);
    await b.connection.send({ type: "session.load", sessionId });
    await a.connection.send({
      type: "run.start",
      sessionId,
      input: [{ type: "text", text: "Go" }],
    });
    const approval = await waitFor(() =>
      b.events.find(
        (event): event is Extract<RuntimeEvent, { type: "approval.requested" }> =>
          event.type === "approval.requested",
      ),
    );
    expect(a.events.some((event) => event.type === "approval.requested")).toBe(true);
    await b.connection.send({
      type: "approval.respond",
      effectId: approval.effectId,
      digest: approval.digest,
      decision: "approve",
    });
    expect((await waitFor(() => finished(a.events))).outcome).toEqual({ kind: "completed" });
  });

  it("cancels the runs a client started when it disconnects", async () => {
    const d = await daemon({ approveReads: true });
    const seen: RuntimeEvent[] = [];
    const off = d.runtime.subscribe((event) => seen.push(event));
    cleanups.push(off);
    const a = await client(d.data);
    const sessionId = await createSession(a);
    await a.connection.send({
      type: "run.start",
      sessionId,
      input: [{ type: "text", text: "Go" }],
    });
    await waitFor(() => a.events.find((event) => event.type === "approval.requested"));
    await a.connection.close();
    expect((await waitFor(() => finished(seen))).outcome).toEqual({ kind: "cancelled" });
  });

  it("creates sessions only in the daemon's workspace", async () => {
    const d = await daemon();
    const a = await client(d.data);
    await a.connection.send({ type: "session.create", workspaceRoot: d.root });
    expect(a.events).toEqual([
      {
        type: "command.rejected",
        command: "session.create",
        reason: "This daemon creates sessions only in its own workspace",
      },
    ]);
  });

  it("rejects a wrong token, a missing hello, oversized input and invalid commands", async () => {
    const d = await daemon({ helloTimeoutMs: 200 });
    const hello = (token: string) => `${JSON.stringify({ type: "hello", version: 1, token })}\n`;
    expect(await raw(d.server.socketPath, [hello("0".repeat(64))])).toContain(
      "Authentication failed",
    );
    expect(await raw(d.server.socketPath, [])).toContain("Authentication timed out");
    expect(await raw(d.server.socketPath, ["x".repeat(5000)])).toContain("Authentication failed");
    const token = readToken(join(d.data, "daemon-token"));
    const bad = `${JSON.stringify({ type: "command", id: 1, command: { type: "run.cancel", runId: "r", grant: "all" } })}\n`;
    const received = await raw(d.server.socketPath, [hello(token), bad]);
    expect(received).toContain('"type":"welcome"');
    expect(received).toContain("unexpected field");
    expect(d.server.connections).toBe(0);
  });

  it("refuses a shared data directory or token and removes socket and token on close", async () => {
    const d = await daemon();
    chmodSync(join(d.data, "daemon-token"), 0o644);
    await expect(connectDaemon({ dataDirectory: d.data })).rejects.toThrow("private file");
    chmodSync(join(d.data, "daemon-token"), 0o600);
    chmodSync(d.data, 0o755);
    await expect(connectDaemon({ dataDirectory: d.data })).rejects.toThrow("private (mode 0700)");
    chmodSync(d.data, 0o700);
    const a = await client(d.data);
    await d.server.close();
    await a.connection.closed;
    expect(existsSync(join(d.data, "daemon.sock"))).toBe(false);
    expect(existsSync(join(d.data, "daemon-token"))).toBe(false);
    await expect(a.connection.send({ type: "session.list" })).rejects.toThrow("closed");
    await expect(connectDaemon({ dataDirectory: d.data })).rejects.toThrow("No daemon");
  });

  it("refuses to start on a data directory that is not private", async () => {
    const d = await daemon();
    await d.server.close();
    chmodSync(d.data, 0o750);
    await expect(
      startDaemonServer({
        runtime: d.runtime as Runtime,
        dataDirectory: d.data,
        workspaceRoot: d.workspace,
        notices: [],
      }),
    ).rejects.toThrow("private (mode 0700)");
    chmodSync(d.data, 0o700);
  });
});
