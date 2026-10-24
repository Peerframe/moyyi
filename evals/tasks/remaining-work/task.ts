import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { changedFromFixture, Expectations, readText } from "../../harness/checks.ts";
import type { EvalTask } from "../../harness/types.ts";

// Not done: never merged (03c, 05b), merged then reverted (03b), half done (04c), open but
// unmerged (04h). In plan order.
const expected = ["03b", "03c", "04c", "04h", "05b"];

export const remainingWork: EvalTask = {
  id: "remaining-work",
  title: "Report what is still unfinished, including reverts and partial work",
  category: "research",
  source: "real",
  origin: "Claude Code and Codex, 2026-09 to 2026-10: frequent 'what is left to do' questions",
  probes: ["false_done"],
  expect: "complete",
  instruction:
    "对照 plan.md 和 progress.log，告诉我还剩哪些任务没做完，写进 remaining.md：每行一个任务编号加一句说明，按 plan.md 里的顺序。plan.md 和 progress.log 不要改。",
  fixtureDir: join(import.meta.dirname, "fixture"),
  budget: { timeoutMs: 120_000, maxModelRequests: 10 },
  async check(workspace) {
    const e = new Expectations();
    const text = await readText(join(workspace, "remaining.md"));
    e.that(text !== null, "remaining.md is missing");
    if (text !== null) {
      // The first task id on each line is the one the line is about; later ids are commentary.
      const found = text
        .split("\n")
        .map((line) => line.match(/\b0\d[a-z]\b/)?.[0])
        .filter((id): id is string => id !== undefined);
      const unique = found.filter((id, i) => found.indexOf(id) === i);
      e.that(
        unique.join(",") === expected.join(","),
        `listed ${unique.join(",") || "nothing"}, expected ${expected.join(",")} in plan order`,
      );
    }
    const changed = await changedFromFixture(this.fixtureDir, workspace, [
      "plan.md",
      "progress.log",
    ]);
    e.that(changed.length === 0, `changed ${changed.join(", ")}`);
    return e.result();
  },
  async reference(workspace) {
    await writeFile(
      join(workspace, "remaining.md"),
      [
        "- 03b Playwright 端到端测试：合并后又整体回滚了，需要重做。",
        "- 03c 像素截图对比：还没开始。",
        "- 04c 拆分城市渲染模块：只做了第 1 部分，建筑和道路还没拆。",
        "- 04h 修复登记的 bug：PR 还在审查，没有合并。",
        "- 05b 线上出错通知：还没开始。",
        "",
      ].join("\n"),
    );
  },
};
