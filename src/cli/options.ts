import { homedir } from "node:os";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import type { SessionId } from "../contracts/index.ts";

export const usage = `Usage: moyyi (--demo | --host FILE) [options] [prompt]

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
      --shell-toolchain node  Explicitly enable this Node executable and its exact libraries
      --web-origin URL   Allow HTTPS fetches for this exact origin (repeatable; asks)
      --web-dns MODE     system (default) or cloudflare-doh; requires --web-origin
      --max-requests N   Model requests per turn, 1..128; includes the final answer
      --dev              Enable development-only plugin loading and reload
      --dev-plugin N=P   Explicit plugin name and local module path (repeatable)

Commands: /help /new /resume ID /compact /cancel /exit /approve EFFECT_ID /deny EFFECT_ID
Compaction: /compact makes one request to the selected model; originals remain in history.
Development: /reload NAME. Ctrl-C cancels an active run, or exits when idle.
No workspace configuration, environment credential or plugin is auto-discovered.`;

export interface CliOptions {
  readonly help: boolean;
  readonly version: boolean;
  readonly demo: boolean;
  readonly host?: string;
  readonly workspaceRoot: string;
  readonly dataDirectory?: string;
  readonly sessionId?: SessionId;
  readonly interactive: boolean;
  readonly approveReads: boolean;
  readonly allowWrite: boolean;
  readonly allowShell: boolean;
  readonly shellToolchain?: "node";
  readonly webOrigins: readonly string[];
  readonly webDns?: "system" | "cloudflare-doh";
  readonly maxRequests?: number;
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
      "shell-toolchain": { type: "string" },
      "web-origin": { type: "string", multiple: true },
      "web-dns": { type: "string" },
      "max-requests": { type: "string" },
      dev: { type: "boolean" },
      "dev-plugin": { type: "string", multiple: true },
    },
  });
  const help = values.help ?? false,
    version = values.version ?? false;
  if (!help && !version && (values.demo ?? false) === (values.host !== undefined))
    throw Error("Select exactly one of --demo or --host FILE");
  if (values.session !== undefined && !/^[A-Za-z0-9_-]{1,512}$/.test(values.session))
    throw Error("Invalid session ID");
  if (values["dev-plugin"]?.length && !values.dev)
    throw Error("--dev-plugin requires --dev and explicit trust in local code");
  const toolchain = values["shell-toolchain"];
  if (toolchain !== undefined && (toolchain !== "node" || !values["allow-shell"]))
    throw Error("--shell-toolchain node requires --allow-shell");
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
    (!/^[1-9][0-9]{0,2}$/.test(requestText) || Number(requestText) > 128)
  )
    throw Error("--max-requests must be an integer from 1 to 128");
  if (
    values.demo &&
    (values["allow-write"] || values["allow-shell"] || webOrigins.length || requestText)
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
    demo: values.demo ?? false,
    workspaceRoot: resolve(cwd, values.cwd ?? "."),
    interactive: values.interactive ?? false,
    approveReads: values["approve-reads"] ?? false,
    allowWrite: values["allow-write"] ?? false,
    allowShell: values["allow-shell"] ?? false,
    webOrigins,
    ...(toolchain === undefined ? {} : { shellToolchain: toolchain as "node" }),
    ...(dns === undefined ? {} : { webDns: dns as "system" | "cloudflare-doh" }),
    ...(requestText === undefined ? {} : { maxRequests: Number(requestText) }),
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
