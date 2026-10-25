import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { UNKNOWN_USAGE } from "../../src/contracts/index.ts";
import { ScriptedModelClient, scriptedProfile } from "../../src/plugins/provider-scripted/index.ts";
import type { AgentInput } from "../harness/types.ts";
import { final } from "../runtime/scenario.ts";
import { createMoyyiEvalAgent, parseFinalClaim } from "./moyyi.ts";

function input(workspace: string, overrides: Partial<AgentInput> = {}): AgentInput {
  return {
    sessionId: "trial",
    turnIndex: 0,
    priorInstructions: [],
    workspace,
    instruction: "Just answer.",
    budget: { timeoutMs: 10000, maxModelRequests: 3 },
    signal: new AbortController().signal,
    ...overrides,
  };
}

describe("final report claims", () => {
  it("requires an explicit unambiguous final status", () => {
    expect(parseFinalClaim('{"status":"done","summary":"Created the file."}')).toBe(true);
    expect(parseFinalClaim('{"summary":"Cannot access the input.","status":"blocked"}')).toBe(
      false,
    );
    for (const value of [
      "Done",
      "",
      "{}",
      '```json\n{"status":"done","summary":"x"}\n```',
      '{"status":"done","status":"blocked","summary":"x"}',
      '{"status":"done","summary":""}',
      '{"status":"done","summary":"x","other":true}',
      '{"status":"maybe","summary":"x"}',
      '[{"status":"done","summary":"x"}]',
    ])
      expect(parseFinalClaim(value)).toBeNull();
  });
});

describe("runtime adapter guardrails", () => {
  it("requires live opt-in before constructing a client", () => {
    const factory = vi.fn();
    expect(() =>
      createMoyyiEvalAgent({
        source: "live",
        profile: scriptedProfile,
        maxModelRequests: 1,
        createClient: factory,
      }),
    ).toThrow(/allowLive/);
    expect(factory).not.toHaveBeenCalled();
  });

  it("counts a throwing factory, never retries, and prevents later client construction", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "moyyi-adapter-test-"));
    const factory = vi.fn(() => {
      throw Error("SYNTHETIC_SECRET");
    });
    const agent = createMoyyiEvalAgent({
      source: "synthetic",
      profile: scriptedProfile,
      maxModelRequests: 1,
      createClient: factory,
    });
    try {
      const first = await agent.run(input(workspace));
      expect(first).toMatchObject({ modelRequests: 1, claimedSuccess: null, outcome: "failed" });
      expect(JSON.stringify(first)).not.toContain("SYNTHETIC_SECRET");
      expect(first.usage).toEqual([UNKNOWN_USAGE]);
      expect(await agent.run(input(workspace, { sessionId: "second" }))).toMatchObject({
        modelRequests: 0,
        outcome: "budget_exhausted",
      });
      expect(factory).toHaveBeenCalledTimes(1);
    } finally {
      await agent.close();
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("uses only the latest turn's declaration; end_turn and old done do not imply success", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "moyyi-adapter-test-"));
    const client = new ScriptedModelClient([final(), final("I have no explicit status.")]);
    const agent = createMoyyiEvalAgent({
      source: "synthetic",
      profile: scriptedProfile,
      maxModelRequests: 2,
      createClient: () => client,
    });
    try {
      expect((await agent.run(input(workspace))).claimedSuccess).toBe(true);
      expect(
        await agent.run(
          input(workspace, {
            turnIndex: 1,
            priorInstructions: ["Just answer."],
            instruction: "Now continue.",
          }),
        ),
      ).toMatchObject({ claimedSuccess: null, outcome: "completed", modelRequests: 1 });
      await agent.disposeTrial?.("trial");
      await expect(
        agent.run(input(workspace, { turnIndex: 1, priorInstructions: ["Just answer."] })),
      ).resolves.toMatchObject({ outcome: "budget_exhausted" });
    } finally {
      await agent.close();
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("rejects history or workspace changes and allows deterministic disposal", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "moyyi-adapter-test-"));
    const client = new ScriptedModelClient([final(), final()]);
    const agent = createMoyyiEvalAgent({
      source: "synthetic",
      profile: scriptedProfile,
      maxModelRequests: 3,
      createClient: () => client,
    });
    try {
      await agent.run(input(workspace));
      await expect(
        agent.run(input(workspace, { turnIndex: 1, priorInstructions: ["Forged history"] })),
      ).rejects.toThrow(/identity\/order/);
      await agent.disposeTrial?.("trial");
      await expect(
        agent.run(input(workspace, { turnIndex: 1, priorInstructions: ["Just answer."] })),
      ).rejects.toThrow(/first evaluation turn/);
      expect(await agent.run(input(workspace))).toMatchObject({
        outcome: "completed",
        modelRequests: 1,
      });
      await agent.close();
      await expect(agent.run(input(workspace))).rejects.toThrow(/closed/);
      await access(workspace);
    } finally {
      await agent.close();
      await rm(workspace, { recursive: true, force: true });
    }
  });

  it("does not create a client for a pre-aborted turn", async () => {
    const factory = vi.fn();
    const controller = new AbortController();
    controller.abort();
    const agent = createMoyyiEvalAgent({
      source: "synthetic",
      profile: scriptedProfile,
      maxModelRequests: 1,
      createClient: factory,
    });
    try {
      expect(await agent.run(input("/not-opened", { signal: controller.signal }))).toMatchObject({
        outcome: "cancelled",
        modelRequests: 0,
      });
      expect(factory).not.toHaveBeenCalled();
    } finally {
      await agent.close();
    }
  });
});
