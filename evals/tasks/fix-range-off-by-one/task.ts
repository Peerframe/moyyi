import { execFile } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import type { EvalTask } from "../../harness/types.ts";

const run = promisify(execFile);

// Agent-edited code runs in a child process with a timeout, never inside the harness.
const probe = `
const { range } = await import(process.argv[1]);
const cases = [[1, 3, [1, 2, 3]], [0, 0, [0]], [-2, 1, [-2, -1, 0, 1]], [5, 4, []]];
const failures = cases.filter(([a, b, want]) => JSON.stringify(range(a, b)) !== JSON.stringify(want));
console.log(JSON.stringify(failures));
`;

export const fixRangeOffByOne: EvalTask = {
  id: "fix-range-off-by-one",
  title: "Fix an off-by-one bug described only by a comment",
  category: "coding",
  instruction: "range.js does not do what its comment says. Fix it.",
  fixtureDir: join(import.meta.dirname, "fixture"),
  budget: { timeoutMs: 120_000, maxModelRequests: 20 },
  async check(workspace) {
    const target = pathToFileURL(join(workspace, "range.js")).href;
    try {
      const { stdout } = await run(process.execPath, ["--input-type=module", "-e", probe, target], {
        timeout: 5_000,
      });
      const failures = JSON.parse(stdout) as unknown[];
      return failures.length === 0
        ? { passed: true, details: "all cases pass" }
        : { passed: false, details: `failing cases: ${JSON.stringify(failures)}` };
    } catch (error) {
      return { passed: false, details: `probe failed: ${(error as Error).message.split("\n")[0]}` };
    }
  },
};
