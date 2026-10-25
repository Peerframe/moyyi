import { describe, expect, it, vi } from "vitest";
import { ScriptedModelClient, scriptedProfile } from "../src/plugins/provider-scripted/index.ts";
import { deepSeekEvalHost } from "./agents/deepseek.ts";
import { selectEvaluation } from "./cli.ts";
import type { EvalTask } from "./harness/types.ts";

const tasks = [{ id: "public-task" }] as EvalTask[];
const base = [
  "--agent",
  "moyyi",
  "--host",
  "example-host.ts",
  "--source",
  "synthetic",
  "--max-model-requests",
  "3",
];
const host = {
  source: "synthetic",
  profile: scriptedProfile,
  createClient: () => new ScriptedModelClient([]),
};

describe("evaluation command selection", () => {
  it("defaults to public-only/null without loading a host or private corpus", async () => {
    const loaders = { host: vi.fn(), privateTasks: vi.fn() };
    const selection = await selectEvaluation([], tasks, loaders);
    expect(selection.agent.name).toBe("null");
    expect(selection.tasks).toEqual(tasks);
    expect(selection.metadata.corpus).toBe("public");
    expect(loaders.host).not.toHaveBeenCalled();
    expect(loaders.privateTasks).not.toHaveBeenCalled();
    await selection.close();
  });

  it("requires explicit private opt-in and validates flags first", async () => {
    const privateTasks = vi.fn(async () => [{ id: "private-task" }] as EvalTask[]);
    const selected = await selectEvaluation(
      ["--include-private", "--task", "private-task"],
      tasks,
      { privateTasks },
    );
    expect(selected.tasks.map((task) => task.id)).toEqual(["private-task"]);
    expect(privateTasks).toHaveBeenCalledTimes(1);
    await selected.close();
    privateTasks.mockClear();
    await expect(
      selectEvaluation(["--include-private", "--trials", "NaN"], tasks, { privateTasks }),
    ).rejects.toThrow(/positive integer/);
    expect(privateTasks).not.toHaveBeenCalled();
  });

  it("rejects unknown tasks and incomplete or invalid model flags before host import", async () => {
    const loader = vi.fn(async () => host);
    for (const args of [
      ["--trials", "0"],
      ["--trials", "1.5"],
      ["--trials", "9007199254740992"],
      ["--host", "unexpected.ts"],
      ["--agent", "moyyi"],
      [...base, "--task", "unknown"],
      [...base, "--capabilities", "all"],
      [...base, "--max-model-requests", "-1"],
      [...base, "--allow-live"],
      base.filter((_arg, i) => i !== 4 && i !== 5),
    ])
      await expect(selectEvaluation(args, tasks, { host: loader })).rejects.toThrow();
    expect(loader).not.toHaveBeenCalled();
  });

  it("selects a synthetic model lazily with read-only defaults", async () => {
    const factory = vi.fn(host.createClient);
    const selected = await selectEvaluation(base, tasks, {
      host: async () => ({ ...host, createClient: factory }),
    });
    expect(selected.agent.name).toBe("moyyi");
    expect(selected.metadata).toMatchObject({
      source: "synthetic",
      capabilities: "read",
      maxModelRequests: 3,
      maxRetries: 0,
    });
    expect(factory).not.toHaveBeenCalled();
    await selected.close();
  });

  it("requires live authorization before host import, then validates the source match", async () => {
    const args = base.map((arg) => (arg === "synthetic" ? "live" : arg));
    const loader = vi.fn(async () => host);
    await expect(selectEvaluation(args, tasks, { host: loader })).rejects.toThrow(/allow-live/);
    expect(loader).not.toHaveBeenCalled();
    await expect(
      selectEvaluation([...args, "--allow-live"], tasks, { host: loader }),
    ).rejects.toThrow(/matching source/);
  });

  it("accepts an explicitly authorized live host without reading a key or sending HTTP", async () => {
    const key = vi.fn(() => "SYNTHETIC_KEY");
    const http = vi.fn<typeof fetch>();
    const live = deepSeekEvalHost({ getApiKey: key, fetch: http });
    const args = [...base.map((arg) => (arg === "synthetic" ? "live" : arg)), "--allow-live"];
    const selected = await selectEvaluation(args, tasks, { host: async () => live });
    expect(selected.metadata.source).toBe("live");
    expect(key).not.toHaveBeenCalled();
    expect(http).not.toHaveBeenCalled();
    await selected.close();
  });

  it("does not expose secret-bearing module loader exceptions", async () => {
    await expect(
      selectEvaluation(base, tasks, {
        host: async () => {
          throw Error("SYNTHETIC_SECRET");
        },
      }),
    ).rejects.toThrow(/^Cannot load evaluation host module$/);
  });
});
