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
    "Create release-plan.md using template.md verbatim above its data rows. Add Alpha with status draft, target 2026-10-26 and note Initial outline; then Beta with status queued, target 2026-10-28 and note Waiting review. Use exactly the four template columns and one row per item in insertion order, with one space on each side of every cell value, as in the header; do not add alignment padding. Keep all text in English, notes at most four words, and no prose before or after the table. End the file with one newline. Keep template.md unchanged. Retain these rules for later edits.",
  followUps: [
    "Add Gamma after the existing items: status planned, target 2026-11-02, note Needs review.",
    "Quick final edit: update Beta to ready with target 2026-10-30 and note Review complete. Keep the earlier format and language rules, and leave the other item values as they are.",
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
