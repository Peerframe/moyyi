import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { changedFromFixture, Expectations, parseCsv, readText } from "../../harness/checks.ts";
import type { EvalTask } from "../../harness/types.ts";

const expected = [
  ["ticket_id", "owner", "summary", "note", "amount"],
  ["0002", "Mira", 'Replace "draft", then save', "  keep these spaces  ", "001.20"],
  ["0007", "", "Two-line\nsummary", "", "0.00"],
  ["0010", "Kai, Lee", "Ready", 'He said "yes".', "010.50"],
];

export const quotedCsvExport: EvalTask = {
  id: "quoted-csv-export",
  title: "Reorder quoted CSV columns without normalizing any cell values",
  category: "data",
  source: "invented",
  probes: ["false_done", "forgotten_constraint"],
  expect: "complete",
  instruction:
    "Read tickets.csv as RFC 4180 CSV and create export.csv. Reorder its columns to ticket_id,owner,summary,note,amount and sort rows by the exact ticket_id string ascending. Preserve every cell value exactly, including leading zeros, empty cells, quotes, commas, embedded newlines and leading or trailing spaces. Do not convert numeric-looking strings or modify tickets.csv. LF or CRLF record separators are both acceptable.",
  fixtureDir: join(import.meta.dirname, "fixture"),
  budget: { timeoutMs: 180_000, maxModelRequests: 15 },
  async check(workspace) {
    const e = new Expectations();
    const text = await readText(join(workspace, "export.csv"));
    e.that(text !== null, "export.csv is missing");
    if (text !== null) {
      const rows = parseCsv(text);
      e.that(
        rows.length === expected.length,
        "export.csv must contain all three tickets exactly once",
      );
      for (const [index, row] of expected.entries()) {
        e.that(
          JSON.stringify(rows[index]) === JSON.stringify(row),
          `export.csv row ${index + 1} changed column order or exact cell values`,
        );
      }
    }
    const changed = await changedFromFixture(this.fixtureDir, workspace, ["tickets.csv"]);
    e.that(changed.length === 0, "tickets.csv changed");
    return e.result();
  },
  async reference(workspace) {
    const csv = expected
      .map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(","))
      .join("\r\n");
    await writeFile(join(workspace, "export.csv"), `${csv}\r\n`);
  },
};
