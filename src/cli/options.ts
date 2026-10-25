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
      --approve-reads    Ask before each read/list/search execution
      --dev              Enable development-only plugin loading and reload
      --dev-plugin N=P   Explicit plugin name and local module path (repeatable)

Commands: /help /new /resume ID /cancel /exit /approve EFFECT_ID /deny EFFECT_ID
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
