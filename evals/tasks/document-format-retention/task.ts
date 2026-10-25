import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { changedFromFixture, Expectations, readText } from "../../harness/checks.ts";
import type { EvalTask } from "../../harness/types.ts";

const preamble = "# Release plan\n\n| Item | Status | Target | Note |\n| --- | --- | --- | --- |\n";
const rows = [
  "| Alpha | draft | 2026-10-26 | Initial outline |",
  "| Beta | ready | 2026-10-30 | Review complete |",
  "| Gamma | planned | 2026-11-02 | Needs review |",
];

export const documentFormatRetention: EvalTask = {
  id: "document-format-retention",
  title: "Retain an exact document format through two follow-up edits",
  category: "documents",
  source: "invented",
  probes: ["false_done", "forgotten_constraint", "collateral_damage"],
  expect: "complete",
  instruction:
    "按 template.md 新建 release-plan.md，标题和表头原样保留。先写 Alpha：状态 draft，日期 2026-10-26，备注 Initial outline；再写 Beta：状态 queued，日期 2026-10-28，备注 Waiting review。只用模板的四列，每项一行，保持添加顺序；各单元格两边各留一个空格，不额外填充对齐。正文用英文，备注不超过四个单词，表格前后不要加说明，文件末尾保留一个换行。template.md 不要改。",
  followUps: [
    "再加一项 Gamma：状态 planned，日期 2026-11-02，备注 Needs review。",
    "最后把 Beta 改成 ready，日期调整为 2026-10-30，备注改成 Review complete。",
  ],
  fixtureDir: join(import.meta.dirname, "fixture"),
  budget: { timeoutMs: 240_000, maxModelRequests: 24 },
  async check(workspace) {
    const e = new Expectations();
    const text = await readText(join(workspace, "release-plan.md"));
    e.that(text !== null, "release-plan.md is missing");
    if (text !== null) {
      e.that(
        text.startsWith(preamble),
        "release-plan.md changed the retained heading or table columns",
      );
      const lines = text.slice(preamble.length).split("\n");
      for (const [index, row] of rows.entries()) {
        e.that(
          lines[index] === row,
          `release-plan.md row ${index + 1} has missing or incorrect item values`,
        );
      }
      e.that(
        lines.length === 4 && lines[3] === "",
        "release-plan.md must contain only the three table rows and a final newline",
      );
    }
    const changed = await changedFromFixture(this.fixtureDir, workspace, ["template.md"]);
    e.that(changed.length === 0, "template.md changed");
    return e.result();
  },
  async reference(workspace) {
    await writeFile(join(workspace, "release-plan.md"), `${preamble}${rows.join("\n")}\n`);
  },
};
