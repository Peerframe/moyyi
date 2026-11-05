import { connect } from "node:net";
import {
  type ClientFrame,
  encodeFrame,
  FrameDecoder,
  parseServerFrame,
  type RuntimeClient,
  type RuntimeEvent,
  type ServerFrame,
  WIRE_LIMITS,
  WIRE_PROTOCOL_VERSION,
} from "../contracts/index.ts";
import { assertOwnedSocket, assertPrivateDirectory, daemonPaths, readToken } from "./paths.ts";

export interface DaemonConnection extends RuntimeClient {
  readonly workspaceRoot: string;
  /** The daemon's fixed grants, as described by its host. */
  readonly notices: readonly string[];
  /** Settles when the connection ends for any reason. */
  readonly closed: Promise<void>;
}

export interface ConnectOptions {
  readonly dataDirectory: string;
  readonly timeoutMs?: number;
}

/**
 * Connects to the daemon for a data directory. The daemon is trusted because only this user can
 * create the socket inside the private directory; the token proves the same to the daemon.
 */
export async function connectDaemon(options: ConnectOptions): Promise<DaemonConnection> {
  const paths = daemonPaths(options.dataDirectory);
  assertPrivateDirectory(paths.directory);
  assertOwnedSocket(paths.socket);
  const token = readToken(paths.token);
  const socket = connect(paths.socket);
  const decoder = new FrameDecoder(WIRE_LIMITS.serverFrameBytes);
  const listeners = new Set<(event: RuntimeEvent) => void>();
  const pending = new Map<number, { resolve(): void; reject(error: Error): void }>();
  let nextId = 1;
  let ended = false;
  let resolveClosed!: () => void;
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  const welcome = await new Promise<Extract<ServerFrame, { type: "welcome" }>>(
    (resolve, reject) => {
      let welcomed = false;
      const timer = setTimeout(() => {
        reject(Error("The daemon did not answer"));
        socket.destroy();
      }, options.timeoutMs ?? 5000);
      const fail = (error: Error) => {
        ended = true;
        for (const waiter of pending.values()) waiter.reject(error);
        pending.clear();
        if (!welcomed) {
          clearTimeout(timer);
          reject(error);
        }
        socket.destroy();
      };
      socket.on("connect", () => {
        const hello: ClientFrame = { type: "hello", version: WIRE_PROTOCOL_VERSION, token };
        socket.write(encodeFrame(hello, WIRE_LIMITS.helloBytes));
      });
      socket.on("data", (chunk: Buffer) => {
        let frames: unknown[];
        try {
          frames = decoder.push(chunk);
        } catch {
          fail(Error("The daemon sent an invalid frame"));
          return;
        }
        for (const value of frames) {
          let frame: ServerFrame;
          try {
            frame = parseServerFrame(value);
          } catch {
            fail(Error("The daemon sent an invalid frame"));
            return;
          }
          if (!welcomed) {
            if (frame.type === "welcome" && frame.version === WIRE_PROTOCOL_VERSION) {
              welcomed = true;
              clearTimeout(timer);
              resolve(frame);
              continue;
            }
            fail(
              Error(frame.type === "error" ? frame.message : "The daemon refused the connection"),
            );
            return;
          }
          // Frames are handled in order, so events emitted for a command arrive before its ack.
          if (frame.type === "event") {
            for (const listener of [...listeners]) {
              try {
                listener(frame.event);
              } catch {}
            }
          } else if (frame.type === "ack" || (frame.type === "error" && frame.id !== undefined)) {
            const waiter = pending.get(frame.id as number);
            pending.delete(frame.id as number);
            if (frame.type === "ack") waiter?.resolve();
            else waiter?.reject(Error(frame.message));
          } else if (frame.type === "error") {
            fail(Error(frame.message));
            return;
          }
        }
      });
      socket.on("error", (error) => fail(Error(`Daemon connection failed: ${error.message}`)));
      socket.on("close", () => {
        fail(Error("The daemon connection closed"));
        resolveClosed();
      });
    },
  );

  const request = (frame: ClientFrame & { id: number }): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      if (ended) return reject(Error("The daemon connection closed"));
      let line: string;
      try {
        line = encodeFrame(frame, WIRE_LIMITS.clientFrameBytes);
      } catch (error) {
        return reject(error as Error);
      }
      pending.set(frame.id, { resolve, reject });
      socket.write(line);
    });

  let closing: Promise<void> | undefined;
  return {
    workspaceRoot: welcome.workspaceRoot,
    notices: welcome.notices,
    plugins: welcome.plugins,
    diagnostics: welcome.diagnostics,
    closed,
    send: (command) => request({ type: "command", id: nextId++, command }),
    idle: () => request({ type: "idle", id: nextId++ }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      closing ??= (async () => {
        ended = true;
        socket.end();
        const timer = setTimeout(() => socket.destroy(), 2000);
        await closed;
        clearTimeout(timer);
        listeners.clear();
      })();
      return closing;
    },
  };
}
