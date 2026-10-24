#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import type { RuntimeEvent } from "../contracts/index.ts";
import { createRuntime } from "../runtime/index.ts";

const usage = `Usage: moyyi [options] [prompt]

Options:
  -h, --help       Show this help
  -v, --version    Show the version
  -C, --cwd <dir>  Workspace root (default: current directory)`;

function version(): string {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  return String(pkg.version);
}

async function main(argv: readonly string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
      cwd: { type: "string", short: "C" },
    },
  });

  if (values.help) {
    console.log(usage);
    return 0;
  }
  if (values.version) {
    console.log(version());
    return 0;
  }
  if (positionals.length === 0) {
    console.error(usage);
    return 2;
  }

  const runtime = await createRuntime();
  for (const status of runtime.plugins) {
    if (status.state === "failed")
      console.error(`moyyi: plugin ${status.name} failed: ${status.error}`);
  }
  let rejected: string | null = null;
  const unsubscribe = runtime.subscribe((event: RuntimeEvent) => {
    if (event.type === "command.rejected") rejected = `${event.command}: ${event.reason}`;
  });
  await runtime.send({ type: "session.create", workspaceRoot: values.cwd ?? process.cwd() });
  unsubscribe();
  await runtime.close();

  if (rejected !== null) {
    console.error(`moyyi: ${rejected}`);
    return 1;
  }
  return 0;
}

process.exitCode = await main(process.argv.slice(2));
