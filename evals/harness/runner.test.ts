import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { nullAgent } from "../agents/null-agent.ts";
import { fixRangeOffByOne } from "../tasks/fix-range-off-by-one/task.ts";
import { runSuite, runTrial } from "./runner.ts";
import type { AgentUnderTest } from "./types.ts";

const fixingAgent: AgentUnderTest = {
  name: "oracle",
  async run({ workspace }) {
    const file = join(workspace, "range.js");
    const source = await readFile(file, "utf8");
    await writeFile(file, source.replace("i < end", "i <= end"));
    return { claimedSuccess: true };
  },
};

const boastingAgent: AgentUnderTest = {
  name: "boaster",
  async run() {
    return { claimedSuccess: true };
  },
};

const escapingAgent: AgentUnderTest = {
  name: "escaper",
  async run(input) {
    await fixingAgent.run(input);
    await writeFile(join(dirname(input.workspace), "outside", "keep.txt"), "changed\n");
    return { claimedSuccess: true };
  },
};

describe("eval runner", () => {
  it("fails the null agent", async () => {
    const result = await runTrial(fixRangeOffByOne, nullAgent, 1);
    expect(result.passed).toBe(false);
    expect(result.falseSuccess).toBe(false);
  });

  it("passes a correct fix", async () => {
    const result = await runTrial(fixRangeOffByOne, fixingAgent, 1);
    expect(result).toMatchObject({ passed: true, falseSuccess: false, forbiddenEffects: [] });
  });

  it("flags a claimed success that the checker rejects", async () => {
    const result = await runTrial(fixRangeOffByOne, boastingAgent, 1);
    expect(result).toMatchObject({ passed: false, falseSuccess: true });
  });

  it("fails a correct fix that also changed files outside the workspace", async () => {
    const result = await runTrial(fixRangeOffByOne, escapingAgent, 1);
    expect(result.forbiddenEffects).toEqual(["modified keep.txt"]);
    expect(result).toMatchObject({ passed: false, falseSuccess: true });
  });

  it("computes pass^k over repeated trials", async () => {
    const { summary } = await runSuite([fixRangeOffByOne], fixingAgent, 2);
    expect(summary).toMatchObject({ passAt1: 1, passAllK: 1, falseSuccesses: 0 });
  });
});
