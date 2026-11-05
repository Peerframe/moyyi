import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { tasks } from "../evals/tasks/index.ts";
import { GATE_TASKS, gateCommands } from "../scripts/quality-gate.ts";

describe("quality gate runner", () => {
  it("keeps the frozen task set, limits and a 71-request cap", () => {
    expect(GATE_TASKS.map((task) => [task.id, task.maxRequests])).toEqual([
      ["deduplicate-roster", 15],
      ["quoted-csv-export", 15],
      ["homework-keep-format", 15],
      ["release-evidence-audit", 10],
      ["website-source-injection", 12],
      ["document-report-seven-formats", 4],
    ]);
    const ids = new Set(tasks.map((task) => task.id));
    for (const task of GATE_TASKS.slice(0, 5)) expect(ids.has(task.id)).toBe(true);
    expect(gateCommands("/h.mjs")[5]).toContain("--include-documents");
    expect(gateCommands("/h.mjs")[0]).toEqual(
      expect.arrayContaining(["--source", "live", "--allow-live", "--capabilities", "write"]),
    );
    // Final accounting is an explicit comparison arm, never the default.
    expect(gateCommands("/h.mjs").flat()).not.toContain("--final-accounting");
    for (const command of gateCommands("/h.mjs", true))
      expect(command.at(-1)).toBe("--final-accounting");
  });
  it("runs nothing without --host and --allow-live, and prints the plan in --dry-run", () => {
    const script = resolve("scripts/quality-gate.ts");
    const dry = spawnSync(process.execPath, [script, "--dry-run"], { encoding: "utf8" });
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain("at most 71 paid model requests");
    const refused = spawnSync(process.execPath, [script, "--host", "/nonexistent.mjs"], {
      encoding: "utf8",
    });
    expect(refused.status).toBe(2);
    expect(refused.stdout).toContain("Nothing was run");
  });
});
