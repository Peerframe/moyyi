import { homedir } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { SessionId } from "../contracts/index.ts";

export const usage = `Usage: moyyi (--demo | --host FILE) [options] [prompt]
       moyyi --daemon (--demo | --host FILE) [grant options]
       moyyi --connect [--data DIR] [--session ID] [-i] [prompt]

Without a prompt, a terminal starts an interactive session; piped input is one prompt.
--demo is an offline, finite script that reads README.md. It is not a language model.
--host explicitly loads trusted local RuntimeOptions code, including any credential callback.

Options:
  -h, --help             Show this help
  -v, --version          Show the version
  -C, --cwd DIR          Workspace root (default: current directory)
      --data DIR         Private session data directory (default: ~/.moyyi/data)
      --session ID       Resume a stored session
  -i, --interactive      Keep a terminal session open after an initial prompt
      --approve-reads    Ask before each read/list/search/document execution
      --allow-write      Ask before snapshot-backed writes in this workspace
      --allow-shell      Ask before commands; workspace stays read-only, network denied
      --allow-shell-write  Like --allow-shell, but commands may change the workspace (no snapshots)
      --shell-toolchain node  Explicitly enable this Node executable and its exact libraries
      --web-origin URL   Allow HTTPS fetches for this exact origin (repeatable; asks)
      --web-dns MODE     system (default) or cloudflare-doh; requires --web-origin
      --max-requests N   Model requests per turn, 1..500; includes the final answer
      --timeout SECONDS  Time per turn, 10..86400 (default 60)
      --auto-compact     Summarize older turns, or earlier steps of a long turn, when a request
                         nears the model's context window (one request per summary)
      --long             Long tasks: --max-requests 200 --timeout 3600 --auto-compact unless set
      --dev              Enable development-only plugin loading and reload
      --dev-plugin N=P   Explicit plugin name and local module path (repeatable)
      --daemon           Serve this runtime to local clients until Ctrl-C; grants stay fixed
      --connect          Use the running daemon for --data instead of a local runtime

Commands: /help /new /resume ID /compact /cancel /exit /approve EFFECT_ID /always EFFECT_ID
          /deny EFFECT_ID
Compaction: /compact makes one request to the selected model; originals remain in history.
Development: /reload NAME. Ctrl-C cancels an active run, or exits when idle.
No workspace configuration, environment credential or plugin is auto-discovered.`;

export interface CliOptions {
  readonly help: boolean;
  readonly version: boolean;
  readonly mode: "local" | "daemon" | "connect";
  readonly demo: boolean;
  readonly host?: string;
  readonly workspaceRoot: string;
  readonly dataDirectory?: string;
  readonly sessionId?: SessionId;
  readonly interactive: boolean;
  readonly approveReads: boolean;
  readonly allowWrite: boolean;
  readonly allowShell: boolean;
  readonly allowShellWrite: boolean;
  readonly shellToolchain?: "node";
  readonly webOrigins: readonly string[];
  readonly webDns?: "system" | "cloudflare-doh";
  readonly maxRequests?: number;
  readonly timeoutSeconds?: number;
  readonly autoCompact: boolean;
  readonly dev: boolean;
  readonly development: readonly { name: string; path: string }[];
  readonly prompt?: string;
}
export function parseCliOptions(argv: readonly string[], cwd = process.cwd()): CliOptions {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      cwd: { type: "string", short: "C" },
      demo: { type: "boolean" },
      host: { type: "string" },
      data: { type: "string" },
      session: { type: "string" },
      interactive: { type: "boolean", short: "i" },
      "approve-reads": { type: "boolean" },
      "allow-write": { type: "boolean" },
      "allow-shell": { type: "boolean" },
      "allow-shell-write": { type: "boolean" },
      timeout: { type: "string" },
      "auto-compact": { type: "boolean" },
      long: { type: "boolean" },
      "shell-toolchain": { type: "string" },
      "web-origin": { type: "string", multiple: true },
      "web-dns": { type: "string" },
      "max-requests": { type: "string" },
      dev: { type: "boolean" },
      "dev-plugin": { type: "string", multiple: true },
      daemon: { type: "boolean" },
      connect: { type: "boolean" },
    },
  });
  const help = values.help ?? false,
    version = values.version ?? false;
  if (values.daemon && values.connect) throw Error("Use either --daemon or --connect");
  const mode = values.daemon ? "daemon" : values.connect ? "connect" : "local";
  if (mode === "connect") {
    // The daemon's host and startup grants are its authority; a client cannot add to them.
    const fixed = [
      "demo",
      "host",
      "cwd",
      "approve-reads",
      "allow-write",
      "allow-shell",
      "allow-shell-write",
      "shell-toolchain",
      "web-origin",
      "web-dns",
      "max-requests",
      "timeout",
      "auto-compact",
      "long",
      "dev",
      "dev-plugin",
    ] as const;
    if (fixed.some((name) => values[name] !== undefined))
      throw Error(
        "--connect uses the daemon's host, workspace and grants; restart the daemon to change them",
      );
  } else if (!help && !version && (values.demo ?? false) === (values.host !== undefined))
    throw Error("Select exactly one of --demo or --host FILE");
  if (
    mode === "daemon" &&
    (positionals.length ||
      values.interactive ||
      values.session !== undefined ||
      values.dev ||
      values["dev-plugin"]?.length)
  )
    throw Error("--daemon takes no prompt, session, -i or development plugins");
  if (values.session !== undefined && !/^[A-Za-z0-9_-]{1,512}$/.test(values.session))
    throw Error("Invalid session ID");
  if (values["dev-plugin"]?.length && !values.dev)
    throw Error("--dev-plugin requires --dev and explicit trust in local code");
  const toolchain = values["shell-toolchain"];
  const shell = !!(values["allow-shell"] || values["allow-shell-write"]);
  if (toolchain !== undefined && (toolchain !== "node" || !shell))
    throw Error("--shell-toolchain node requires --allow-shell or --allow-shell-write");
  const webOrigins = [
    ...new Set(
      (values["web-origin"] ?? []).map((value) => {
        let url: URL;
        try {
          url = new URL(value);
        } catch {
          throw Error("--web-origin requires an HTTPS origin");
        }
        if (url.protocol !== "https:" || (value !== url.origin && value !== `${url.origin}/`))
          throw Error(
            "--web-origin requires an HTTPS origin without credentials, path, query or fragment",
          );
        return url.origin;
      }),
    ),
  ];
  if (webOrigins.length > 32) throw Error("At most 32 --web-origin grants are allowed");
  const dns = values["web-dns"];
  if (dns !== undefined && (!webOrigins.length || !["system", "cloudflare-doh"].includes(dns)))
    throw Error("--web-dns requires --web-origin and system or cloudflare-doh");
  const requestText = values["max-requests"];
  if (
    requestText !== undefined &&
    (!/^[1-9][0-9]{0,2}$/.test(requestText) || Number(requestText) > 500)
  )
    throw Error("--max-requests must be an integer from 1 to 500");
  const timeoutText = values.timeout;
  if (
    timeoutText !== undefined &&
    (!/^[1-9][0-9]{1,4}$/.test(timeoutText) || Number(timeoutText) > 86_400)
  )
    throw Error("--timeout must be an integer number of seconds from 10 to 86400");
  const long = values.long ?? false;
  if (
    values.demo &&
    (values["allow-write"] ||
      shell ||
      webOrigins.length ||
      requestText ||
      timeoutText ||
      values["auto-compact"] ||
      long)
  )
    throw Error("Daily capability options require --host; --demo is a fixed read-only script");
  const names = new Set<string>();
  const development = (values["dev-plugin"] ?? []).map((spec) => {
    const equal = spec.indexOf("="),
      name = spec.slice(0, equal),
      path = spec.slice(equal + 1);
    if (equal < 1 || !path || !/^([a-z][a-z0-9-]{0,63})$/.test(name) || names.has(name))
      throw Error("Use unique --dev-plugin NAME=PATH entries");
    names.add(name);
    return { name, path: resolve(cwd, path) };
  });
  const prompt = positionals.length ? positionals.join(" ") : undefined;
  if (prompt !== undefined && Buffer.byteLength(prompt) > 64 * 1024)
    throw Error("Prompt exceeds 64 KiB");
  return {
    help,
    version,
    mode,
    demo: values.demo ?? false,
    workspaceRoot: resolve(cwd, values.cwd ?? "."),
    interactive: values.interactive ?? false,
    approveReads: values["approve-reads"] ?? false,
    allowWrite: values["allow-write"] ?? false,
    allowShell: shell,
    allowShellWrite: values["allow-shell-write"] ?? false,
    autoCompact: values["auto-compact"] ?? long,
    webOrigins,
    ...(toolchain === undefined ? {} : { shellToolchain: toolchain as "node" }),
    ...(dns === undefined ? {} : { webDns: dns as "system" | "cloudflare-doh" }),
    ...(requestText !== undefined
      ? { maxRequests: Number(requestText) }
      : long
        ? { maxRequests: 200 }
        : {}),
    ...(timeoutText !== undefined
      ? { timeoutSeconds: Number(timeoutText) }
      : long
        ? { timeoutSeconds: 3600 }
        : {}),
    dev: values.dev ?? false,
    development,
    ...(values.host === undefined ? {} : { host: resolve(cwd, values.host) }),
    ...(values.data === undefined ? {} : { dataDirectory: resolve(cwd, values.data) }),
    ...(values.session === undefined ? {} : { sessionId: values.session as SessionId }),
    ...(prompt === undefined ? {} : { prompt }),
  };
}
export function defaultDataDirectory(): string {
  return resolve(homedir(), ".moyyi", "data");
}
