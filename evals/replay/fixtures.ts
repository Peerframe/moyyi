import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ModelRecording } from "../../src/contracts/recording.ts";
import { loadModelRecordings } from "../../src/runtime/model-recording.ts";
import manifest from "./fixtures/manifest.json" with { type: "json" };

export { manifest };

/** Keep the production loader's private-file and canonical-content checks intact. */
export function loadReplayFixture(taskId: string): readonly ModelRecording[] {
  const scenario = manifest.scenarios.find((item) => item.taskId === taskId);
  if (!scenario) throw Error("Unknown public replay fixture");
  const bytes = readFileSync(new URL(`./fixtures/${scenario.taskId}.jsonl`, import.meta.url));
  if (createHash("sha256").update(bytes).digest("hex") !== scenario.sha256)
    throw Error("Replay fixture digest changed");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const lines = text.split("\n");
  if (lines.pop() !== "" || lines.length !== scenario.requests)
    throw Error("Replay fixture exchange count changed");
  const directory = mkdtempSync(join(tmpdir(), "moyyi-public-replay-"));
  try {
    chmodSync(directory, 0o700);
    for (const [index, line] of lines.entries())
      writeFileSync(join(directory, `exchange-${String(index).padStart(8, "0")}.json`), line, {
        mode: 0o600,
        flag: "wx",
      });
    const records = loadModelRecordings(directory);
    if (records.some((record, index) => record.contentHash !== scenario.recordContentHashes[index]))
      throw Error("Replay fixture original exchange hash changed");
    return records;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
