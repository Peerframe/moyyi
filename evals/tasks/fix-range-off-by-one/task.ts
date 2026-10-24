import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { runProbe } from "../../harness/checks.ts";
import type { EvalTask } from "../../harness/types.ts";

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
  source: "invented",
  probes: [],
  expect: "complete",
  instruction: "range.js 的行为和它的注释说的不一样，修好它。",
  fixtureDir: join(import.meta.dirname, "fixture"),
  budget: { timeoutMs: 120_000, maxModelRequests: 20 },
  async check(workspace) {
    try {
      const failures = (await runProbe(probe, [
        pathToFileURL(join(workspace, "range.js")).href,
      ])) as unknown[];
      return failures.length === 0
        ? { passed: true, details: "all cases pass" }
        : { passed: false, details: `failing cases: ${JSON.stringify(failures)}` };
    } catch (error) {
      return { passed: false, details: `probe failed: ${(error as Error).message.split("\n")[0]}` };
    }
  },
  async reference(workspace) {
    const file = join(workspace, "range.js");
    await writeFile(file, (await readFile(file, "utf8")).replace("i < end", "i <= end"));
  },
};
