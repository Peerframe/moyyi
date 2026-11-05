import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

/**
 * Runs the frozen quality gate (post-M6 plan v2, section 5.1) task by task with a real model.
 * PAID: every task sends live requests through the owner's private host module; the total request
 * cap is the sum below. `--dry-run` only prints the commands and the cap.
 */
export const GATE_TASKS = [
  { id: "deduplicate-roster", maxRequests: 15 },
  { id: "quoted-csv-export", maxRequests: 15 },
  { id: "homework-keep-format", maxRequests: 15 },
  { id: "release-evidence-audit", maxRequests: 10 },
  { id: "website-source-injection", maxRequests: 12 },
  { id: "document-report-seven-formats", maxRequests: 4, documents: true },
] as const;

export function gateCommands(host: string): string[][] {
  return GATE_TASKS.map((task) => [
    "evals/run.ts",
    "--agent",
    "moyyi",
    "--host",
    host,
    "--source",
    "live",
    "--allow-live",
    "--capabilities",
    "write",
    "--task",
    task.id,
    "--max-model-requests",
    String(task.maxRequests),
    ...("documents" in task && task.documents ? ["--include-documents"] : []),
  ]);
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      host: { type: "string" },
      "allow-live": { type: "boolean", default: false },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const cap = GATE_TASKS.reduce((total, task) => total + task.maxRequests, 0);
  const host = values.host ? resolve(values.host) : "<private host module>";
  const commands = gateCommands(host);
  if (values["dry-run"] || !values.host || !values["allow-live"]) {
    console.log(`Quality gate: ${GATE_TASKS.length} tasks, at most ${cap} paid model requests.`);
    for (const args of commands) console.log(`node ${args.join(" ")}`);
    if (!values["dry-run"])
      console.log("Nothing was run. Pass --host FILE --allow-live to run the paid gate.");
    process.exit(values["dry-run"] ? 0 : 2);
  }
  const results: { task: string; status: number | null; lines: string[] }[] = [];
  for (const [index, args] of commands.entries()) {
    const task = GATE_TASKS[index]?.id ?? "unknown";
    console.log(`\n== ${task}`);
    const run = spawnSync(process.execPath, args, { encoding: "utf8", stdio: "pipe" });
    process.stdout.write(run.stdout);
    process.stderr.write(run.stderr);
    results.push({
      task,
      status: run.status,
      lines: run.stdout.split("\n").filter((line) => /^(PASS|FAIL) |^results: /u.test(line)),
    });
  }
  const passed = results.filter((result) => result.lines.some((line) => line.startsWith("PASS")));
  const dir = join(import.meta.dirname, "..", "evals", "results");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${new Date().toISOString().replaceAll(":", "-")}-quality-gate.json`);
  writeFileSync(file, `${JSON.stringify({ cap, results }, null, 2)}\n`);
  console.log(`\nQuality gate: ${passed.length}/${results.length} passed. Summary: ${file}`);
  process.exit(passed.length === results.length ? 0 : 1);
}
