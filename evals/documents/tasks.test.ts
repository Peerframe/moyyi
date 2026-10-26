import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { documentTasks } from "./tasks.ts";

it.each(documentTasks)(
  "$id rejects absent files, incorrect facts and changed sources",
  async (task) => {
    const workspace = await mkdtemp(join(tmpdir(), "moyyi-doc-checker-"));
    const report = task.id.includes("comparison") ? "comparison.json" : "report.json";
    try {
      await task.prepare?.(workspace);
      expect((await task.check(workspace)).passed).toBe(false);
      await task.reference(workspace);
      expect((await task.check(workspace)).passed).toBe(true);
      const correct = await readFile(join(workspace, report), "utf8");
      const wrong = JSON.parse(correct);
      if (report === "comparison.json") wrong.projects[0].amount++;
      else wrong.approvedTotalCny++;
      await writeFile(join(workspace, report), JSON.stringify(wrong));
      expect(await task.check(workspace)).toMatchObject({
        passed: false,
        details: expect.stringContaining("incorrect document facts"),
      });
      await writeFile(join(workspace, report), correct);
      await writeFile(join(workspace, "aster.pdf"), "overwritten");
      expect(await task.check(workspace)).toEqual({
        passed: false,
        details: "Source documents changed",
      });
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  },
);
