import { timingSafeEqual } from "node:crypto";
import { chmodSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import {
  type ClientCommand,
  type ClientFrame,
  encodeFrame,
  FrameDecoder,
  parseClientFrame,
  type RuntimeEvent,
  type ServerFrame,
  WIRE_LIMITS,
  WIRE_PROTOCOL_VERSION,
  WireError,
} from "../contracts/index.ts";
import type { Runtime } from "../runtime/index.ts";
import { assertPrivateDirectory, daemonPaths, removeOwned, writeToken } from "./paths.ts";
import { EventRouter } from "./router.ts";

export type DaemonRuntime = Pick<
  Runtime,
  "send" | "subscribe" | "idle" | "plugins" | "diagnostics"
>;

export interface DaemonServerOptions {
  readonly runtime: DaemonRuntime;
  /** Same private data directory the runtime's store holds the writer lock for. */
  readonly dataDirectory: string;
  /** Real path; the only workspace remote clients may create sessions in. */
  readonly workspaceRoot: string;
  /** Host-authored description of the fixed grants, shown to each client. */
  readonly notices: readonly string[];
  readonly maxClients?: number;
  readonly helloTimeoutMs?: number;
  /** Per-client unsent output; a client that falls further behind is disconnected. */
  readonly maxPendingBytes?: number;
  readonly maxInFlight?: number;
}

export interface DaemonServer {
  readonly socketPath: string;
  /** Number of authenticated clients. */
  readonly connections: number;
  /** Stops accepting, disconnects clients, cancels their runs and removes socket and token. */
  close(): Promise<void>;
}

interface Client {
  readonly id: number;
  readonly socket: Socket;
  readonly decoder: FrameDecoder;
  authenticated: boolean;
  inFlight: number;
  closed: boolean;
}

/**
 * Serves one runtime to local clients of the same user. Grants are fixed when the runtime is
 * created; nothing a client sends can widen them: commands are validated, session creation is
 * limited to the daemon's workspace, and approvals still bind to the displayed digest.
 */
export async function startDaemonServer(options: DaemonServerOptions): Promise<DaemonServer> {
  const paths = daemonPaths(options.dataDirectory);
  assertPrivateDirectory(paths.directory);
  const maxClients = options.maxClients ?? 8;
  const helloTimeoutMs = options.helloTimeoutMs ?? 5000;
  const maxPendingBytes = options.maxPendingBytes ?? 64 * 1024 * 1024;
  const maxInFlight = options.maxInFlight ?? 16;
  const { runtime } = options;
  // The caller's store holds this data directory's writer lock, so a leftover socket is stale.
  removeOwned(paths.socket, "socket");
  const token = Buffer.from(writeToken(paths.token));
  const router = new EventRouter();
  const clients = new Map<number, Client>();
  let nextId = 1;
  let queue = Promise.resolve();
  let closing: Promise<void> | undefined;

  const write = (client: Client, frame: ServerFrame): void => {
    if (client.closed) return;
    let line: string;
    try {
      line = encodeFrame(frame, WIRE_LIMITS.serverFrameBytes);
    } catch {
      // Dropping one event would leave the client with a silently wrong view.
      drop(client, "An event exceeded the wire limit; reconnect to reload the session.");
      return;
    }
    client.socket.write(line);
    if (client.socket.writableLength > maxPendingBytes) drop(client);
  };
  const drop = (client: Client, message?: string): void => {
    if (client.closed) return;
    if (message) {
      try {
        client.socket.write(encodeFrame({ type: "error", message }, WIRE_LIMITS.serverFrameBytes));
      } catch {}
    }
    client.closed = true;
    client.socket.end();
    client.socket.destroySoon();
    disconnect(client);
  };
  const disconnect = (client: Client): void => {
    clients.delete(client.id);
    if (!client.authenticated) return;
    client.authenticated = false;
    // Like closing an in-process CLI: work this client started does not continue unattended.
    for (const runId of router.remove(client.id)) serialize(0, { type: "run.cancel", runId });
  };
  const unsubscribe = runtime.subscribe((event: RuntimeEvent) => {
    for (const id of router.route(event)) {
      const client = clients.get(id);
      if (client?.authenticated) write(client, { type: "event", event });
    }
  });
  const reject = (client: Client, command: ClientCommand, reason: string): void => {
    write(client, {
      type: "event",
      event: { type: "command.rejected", command: command.type, reason },
    });
  };
  /** Commands run one at a time so replies can be attributed to the sender. */
  function serialize(clientId: number, command: ClientCommand, frameId?: number): void {
    queue = queue.then(async () => {
      const client = clients.get(clientId);
      if (clientId !== 0 && !client?.authenticated) return;
      try {
        if (
          client &&
          command.type === "session.create" &&
          command.workspaceRoot !== options.workspaceRoot
        )
          reject(client, command, "This daemon creates sessions only in its own workspace");
        else {
          router.begin(clientId, command);
          try {
            await runtime.send(command);
          } finally {
            router.end(clientId);
          }
        }
        if (client && frameId !== undefined) write(client, { type: "ack", id: frameId });
      } catch {
        if (client && frameId !== undefined)
          write(client, { type: "error", id: frameId, message: "Command failed in the daemon" });
      } finally {
        if (client) client.inFlight--;
      }
    });
  }
  const receive = (client: Client, frame: ClientFrame): void => {
    if (!client.authenticated) {
      if (frame.type !== "hello") {
        drop(client, "Authenticate first");
        return;
      }
      const offered = Buffer.from(frame.token);
      const valid =
        frame.version === WIRE_PROTOCOL_VERSION &&
        offered.length === token.length &&
        timingSafeEqual(offered, token);
      if (!valid) {
        drop(client, "Authentication failed");
        return;
      }
      if (clients.size > maxClients) {
        drop(client, "Too many clients");
        return;
      }
      client.authenticated = true;
      router.add(client.id);
      write(client, {
        type: "welcome",
        version: WIRE_PROTOCOL_VERSION,
        workspaceRoot: options.workspaceRoot,
        plugins: runtime.plugins.map((plugin) => ({ ...plugin })),
        notices: [...options.notices],
        diagnostics: [...runtime.diagnostics],
      });
      return;
    }
    if (frame.type === "hello") {
      drop(client, "Already authenticated");
      return;
    }
    if (++client.inFlight > maxInFlight) {
      drop(client, "Too many unanswered frames");
      return;
    }
    if (frame.type === "command") {
      serialize(client.id, frame.command, frame.id);
      return;
    }
    // Waiting for idle must not hold the command queue, or nobody could cancel a long run.
    void runtime
      .idle()
      .then(
        () => write(client, { type: "ack", id: frame.id }),
        () => write(client, { type: "error", id: frame.id, message: "Idle wait failed" }),
      )
      .finally(() => {
        client.inFlight--;
      });
  };

  const server = createServer({ allowHalfOpen: false }, (socket) => {
    const client: Client = {
      id: nextId++,
      socket,
      decoder: new FrameDecoder(WIRE_LIMITS.clientFrameBytes),
      authenticated: false,
      inFlight: 0,
      closed: false,
    };
    if (closing || clients.size >= maxClients) {
      socket.destroy();
      return;
    }
    clients.set(client.id, client);
    let helloBytes = 0;
    const timer = setTimeout(() => {
      if (!client.authenticated) drop(client, "Authentication timed out");
    }, helloTimeoutMs);
    socket.on("data", (chunk: Buffer) => {
      if (client.closed) return;
      if (!client.authenticated) {
        helloBytes += chunk.length;
        if (helloBytes > WIRE_LIMITS.helloBytes) {
          drop(client, "Authentication failed");
          return;
        }
      }
      try {
        for (const value of client.decoder.push(chunk)) {
          if (client.closed) return;
          receive(client, parseClientFrame(value));
        }
      } catch (error) {
        drop(client, error instanceof WireError ? error.message : "Invalid frame");
      }
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      clearTimeout(timer);
      client.closed = true;
      disconnect(client);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(paths.socket, () => {
      server.off("error", reject);
      resolve();
    });
  });
  try {
    chmodSync(paths.socket, 0o600);
  } catch (error) {
    server.close();
    throw error;
  }

  return {
    socketPath: paths.socket,
    get connections() {
      return [...clients.values()].filter((client) => client.authenticated).length;
    },
    close() {
      if (closing) return closing;
      closing = (async () => {
        const stopped = new Promise<void>((resolve) => server.close(() => resolve()));
        for (const client of [...clients.values()]) drop(client, "The daemon is stopping");
        await stopped;
        await queue;
        unsubscribe();
        removeOwned(paths.socket, "socket");
        removeOwned(paths.token, "file");
      })();
      return closing;
    },
  };
}
