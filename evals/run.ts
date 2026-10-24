import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { nullAgent } from "./agents/null-agent.ts";
import { runSuite } from "./harness/runner.ts";
import type { AgentUnderTest } from "./harness/types.ts";
import { tasks } from "./tasks/index.ts";

const agents: Record<string, AgentUnderTest> = { null: nullAgent };

const { values } = parseArgs({
  options: {
    agent: { type: "string", default: "null" },
    trials: { type: "string", default: "1" },
    task: { type: "string" },
  },
});

const agent = agents[values.agent];
if (agent === undefined) {
  console.error(`unknown agent "${values.agent}"; available: ${Object.keys(agents).join(", ")}`);
  process.exit(2);
}
const selected = values.task === undefined ? tasks : tasks.filter((t) => t.id === values.task);
const { results, summary } = await runSuite(selected, agent, Number(values.trials));

for (const r of results) {
  const mark = r.passed ? "PASS" : "FAIL";
  console.log(`${mark} ${r.taskId} #${r.trial} (${r.durationMs} ms) ${r.details}`);
}
console.log(JSON.stringify(summary, null, 2));

const dir = join(import.meta.dirname, "results");
await mkdir(dir, { recursive: true });
const file = join(dir, `${new Date().toISOString().replaceAll(":", "-")}-${agent.name}.json`);
await writeFile(file, `${JSON.stringify({ summary, results }, null, 2)}\n`);
console.log(`results: ${file}`);
