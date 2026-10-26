import { readFileSync, realpathSync, statSync } from "node:fs";
import { createInterface } from "node:readline";
import { createCliRuntime, loadCliHost } from "../runtime/cli-host.ts";
import { fileDevelopmentPlugin, watchDevelopmentPlugins } from "../runtime/development.ts";
import type { Runtime } from "../runtime/index.ts";
import { type CliOptions, defaultDataDirectory, parseCliOptions, usage } from "./options.ts";
import { createCliSession, terminalText } from "./session.ts";

/** Entrypoint I/O is host-owned. Tests use subprocesses/PTYs; no real credentials are needed. */
export async function main(argv: readonly string[]): Promise<number> {
  let options: CliOptions;
  try {
    options = parseCliOptions(argv);
  } catch (error) {
    process.stderr.write(
      `moyyi: ${terminalText(error instanceof Error ? error.message : "Invalid arguments")}\n`,
    );
    return 2;
  }
  if (options.help) {
    process.stdout.write(`${usage}\n`);
    return 0;
  }
  if (options.version) {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    process.stdout.write(`${String(pkg.version)}\n`);
    return 0;
  }
  const tty = !!process.stdin.isTTY && !!process.stdout.isTTY;
  const interactive = options.interactive || (options.prompt === undefined && tty);
  if (interactive && !tty) {
    process.stderr.write(
      "moyyi: Interactive mode needs a terminal; supply a prompt or pipe input for one-shot mode.\n",
    );
    return 2;
  }
  let initialPrompt = options.prompt;
  if (!interactive && initialPrompt === undefined) {
    try {
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of process.stdin) {
        size += chunk.length;
        if (size > 64 * 1024) throw Error("Input limit");
        chunks.push(chunk);
      }
      initialPrompt = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    } catch {
      process.stderr.write("moyyi: Piped input must be valid UTF-8 within 64 KiB.\n");
      return 2;
    }
    if (!initialPrompt.trim()) {
      process.stderr.write("moyyi: A nonempty prompt is required.\n");
      return 2;
    }
  }
  let runtime: Runtime;
  let development: ReturnType<typeof fileDevelopmentPlugin>[];
  let workspaceRoot: string;
  try {
    workspaceRoot = realpathSync(options.workspaceRoot);
    if (!statSync(workspaceRoot).isDirectory()) throw Error("Invalid workspace");
    const host = options.host ? await loadCliHost(options.host) : undefined;
    if (options.dataDirectory && host?.store)
      throw Error("Cannot override an injected store directory");
    development = options.development.map((entry) => fileDevelopmentPlugin(entry.name, entry.path));
    runtime = await createCliRuntime({
      demo: options.demo,
      ...(host ? { host } : {}),
      dataDirectory: options.dataDirectory ?? host?.dataDirectory ?? defaultDataDirectory(),
      approveReads: options.approveReads,
      launch: {
        workspaceRoot,
        allowWrite: options.allowWrite,
        allowShell: options.allowShell,
        webOrigins: options.webOrigins,
        ...(options.shellToolchain ? { shellToolchain: options.shellToolchain } : {}),
        ...(options.webDns ? { webDns: options.webDns } : {}),
        ...(options.maxRequests === undefined ? {} : { maxRequests: options.maxRequests }),
      },
      ...(options.dev ? { developmentPlugins: development } : {}),
    });
  } catch {
    // Trusted configuration can throw secrets. Never echo module/credential diagnostics.
    process.stderr.write(
      "moyyi: Initialization failed. Check the workspace, private data directory and explicit host/plugin configuration.\n",
    );
    return 1;
  }
  let closed = false,
    promptVisible = false;
  const terminal = interactive
    ? createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
        historySize: 0,
      })
    : undefined;
  terminal?.setPrompt("moyyi> ");
  const write = (text: string) => {
    if (promptVisible) {
      process.stdout.write("\n");
      promptVisible = false;
    }
    process.stdout.write(text);
  };
  const session = createCliSession(runtime, {
    workspaceRoot,
    interactive,
    write,
    prompt: () => {
      if (!closed && terminal) {
        terminal.prompt(true);
        promptVisible = true;
      }
    },
    ...(options.sessionId ? { sessionId: options.sessionId } : {}),
    ...(initialPrompt === undefined ? {} : { initialPrompt }),
    developmentPluginNames: development.map((entry) => entry.name),
  });
  const pending = new Set<string>();
  let reloadTask: Promise<void> | undefined;
  const changed = (name: string) => {
    if (closed) return;
    pending.add(name);
    if (reloadTask) return;
    reloadTask = (async () => {
      while (pending.size && !closed) {
        await runtime.idle();
        if (closed) break;
        const name = pending.values().next().value as string;
        pending.delete(name);
        let rejected = false;
        const off = runtime.subscribe((event) => {
          if (event.type === "command.rejected" && event.command === "plugin.reload")
            rejected = true;
        });
        try {
          await runtime.send({ type: "plugin.reload", name });
        } finally {
          off();
        }
        if (rejected && !closed) {
          pending.add(name);
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
    })()
      .catch(() => {
        if (!closed)
          write("development | Automatic reload failed; use /reload NAME after the run.\n");
      })
      .finally(() => {
        reloadTask = undefined;
      });
  };
  let watcher: { close(): void } | undefined;
  const interrupt = () => {
    void session.interrupt();
  };
  const terminate = () => {
    void session.end();
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  terminal?.on("SIGINT", interrupt);
  // Buffer input until session creation is acknowledged; close can still cancel startup.
  terminal?.pause();
  terminal?.on("line", (line) => {
    promptVisible = false;
    if (!closed) void session.line(line);
  });
  terminal?.on("close", () => {
    if (!closed) void session.end();
  });
  try {
    if (options.demo)
      write(
        "moyyi | Offline script: reads README.md, up to 32 scripted turns; no model API or credentials.\n",
      );
    for (const plugin of runtime.plugins)
      if (plugin.state === "failed")
        write(`plugin | ${terminalText(plugin.name)} failed to load.\n`);
    if (options.allowWrite)
      write("grants | File writes: approval and snapshots; selected workspace only.\n");
    if (options.allowShell)
      write("grants | Commands: approval, read-only workspace, private scratch, no network.\n");
    if (options.shellToolchain)
      write("grants | Toolchain: this Node executable and its exact startup libraries.\n");
    for (const origin of options.webOrigins)
      write(`grants | HTTPS fetch: ${terminalText(origin)}; approval required.\n`);
    if (options.webDns === "cloudflare-doh")
      write("grants | DNS: explicit Cloudflare DoH; authorized hostnames sent to Cloudflare.\n");
    if (options.maxRequests !== undefined)
      write(
        `budget | At most ${options.maxRequests} model requests per turn, including final answer.\n`,
      );
    await session.start();
    if (interactive && options.dev && development.length) {
      watcher = watchDevelopmentPlugins(development, changed, () =>
        write("development | File watching unavailable; use /reload NAME manually.\n"),
      );
    }
    terminal?.resume();
    return await session.done;
  } catch {
    await session.end();
    return 1;
  } finally {
    closed = true;
    watcher?.close();
    pending.clear();
    terminal?.close();
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
    await runtime.close();
    await reloadTask;
  }
}
