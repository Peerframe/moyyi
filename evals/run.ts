import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { selectEvaluation } from "./cli.ts";
import { runSuite } from "./harness/runner.ts";
import { tasks as publicTasks } from "./tasks/index.ts";

try {
  const selection = await selectEvaluation(process.argv.slice(2), publicTasks);
  try {
    const { results, summary } = await runSuite(selection.tasks, selection.agent, selection.trials);
    for (const r of results) {
      const mark = r.passed ? "PASS" : "FAIL";
      console.log(`${mark} ${r.taskId} #${r.trial} (${r.durationMs} ms) ${r.details}`);
    }
    console.log(JSON.stringify({ ...selection.metadata, ...summary }, null, 2));
    const dir = join(import.meta.dirname, "results");
    await mkdir(dir, { recursive: true });
    const file = join(
      dir,
      `${new Date().toISOString().replaceAll(":", "-")}-${selection.agent.name}.json`,
    );
    await writeFile(
      file,
      `${JSON.stringify({ configuration: selection.metadata, summary, results }, null, 2)}\n`,
    );
    console.log(`results: ${file}`);
  } finally {
    await selection.close();
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Evaluation failed");
  process.exitCode = 2;
}
