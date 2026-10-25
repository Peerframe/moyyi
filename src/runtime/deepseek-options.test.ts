import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RuntimeEvent, SessionId } from "../contracts/index.ts";
import { deepSeekFixtureSse, deepSeekTextFixture } from "../plugins/provider-deepseek/fixtures.ts";
import {
  createRuntime,
  DEEPSEEK_API_PROFILE,
  type DeepSeekReasoningEffort,
  deepSeekApiProfile,
  FileRecordingSink,
  loadModelRecordings,
  type Runtime,
  type RuntimeOptions,
} from "./index.ts";

const directories: string[] = [];
function temporary() {
  const root = mkdtempSync(join(tmpdir(), "moyyi-effort-"));
  directories.push(root);
  return root;
}
afterEach(() => {
  for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true });
});
function connection() {
  const getApiKey = vi.fn(async () => "synthetic-key");
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(deepSeekFixtureSse(deepSeekTextFixture("Synthetic configured answer.")), {
        headers: { "content-type": "text/event-stream" },
      }),
  );
  return { getApiKey, fetch };
}
async function answer(runtime: Runtime, workspaceRoot: string) {
  let sessionId: SessionId | undefined;
  const events: RuntimeEvent[] = [];
  const off = runtime.subscribe((event) => {
    events.push(event);
    if (event.type === "session.ready") sessionId = event.sessionId;
  });
  try {
    await runtime.send({ type: "session.create", workspaceRoot });
    if (!sessionId) throw Error("No synthetic session");
    await runtime.send({
      type: "run.start",
      sessionId,
      input: [{ type: "text", text: "Return a bounded answer." }],
    });
    await runtime.idle();
    expect(events.findLast((event) => event.type === "run.finished")).toMatchObject({
      outcome: { kind: "completed" },
    });
  } finally {
    off();
  }
}

describe("DeepSeek runtime reasoning configuration", () => {
  it.each([null, "", "medium", "xhigh", "LOW", 1, false, {}])(
    "rejects invalid effort %j before credentials, HTTP or runtime storage",
    async (effort) => {
      const root = temporary(),
        deepseek = connection(),
        dataDirectory = join(root, "data");
      await expect(
        createRuntime({
          model: { provider: "deepseek", model: "deepseek-flash" },
          deepseek,
          dataDirectory,
          deepseekReasoningEffort: effort,
        } as unknown as RuntimeOptions),
      ).rejects.toThrow(/reasoning effort/);
      expect(deepseek.getApiKey).not.toHaveBeenCalled();
      expect(deepseek.fetch).not.toHaveBeenCalled();
      expect(existsSync(dataDirectory)).toBe(false);
    },
  );
  it("rejects a setting without a selected DeepSeek model", async () => {
    for (const model of [undefined, { provider: "anthropic", model: "claude-sonnet-5-5" }]) {
      await expect(
        createRuntime({
          ...(model ? { model } : {}),
          deepseekReasoningEffort: "low",
        }),
      ).rejects.toThrow(/selected DeepSeek/);
    }
  });
  it("does not silently apply a built-in setting to an unrelated custom provider", async () => {
    await expect(
      createRuntime({
        model: { provider: "deepseek", model: "deepseek-flash" },
        deepseekReasoningEffort: "low",
      }),
    ).rejects.toThrow(/built-in connection or replay/);
  });
  it.each([undefined, "high", "none", "low", "max"] as const)(
    "sends %s through the real HTTP adapter without changing model, cap or final tools",
    async (effort) => {
      const root = temporary(),
        deepseek = connection();
      const runtime = await createRuntime({
        model: { provider: "deepseek", model: "deepseek-flash" },
        dataDirectory: join(root, "data"),
        deepseek,
        ...(effort === undefined ? {} : { deepseekReasoningEffort: effort }),
        limits: { maxModelRequests: 1, maxRetries: 0 },
      });
      try {
        await answer(runtime, root);
      } finally {
        await runtime.close();
      }
      expect(deepseek.fetch).toHaveBeenCalledTimes(1);
      const [url, init] = deepseek.fetch.mock.calls[0] ?? [];
      expect(url).toBe("https://api.deepseek.com/responses");
      expect(JSON.parse(init?.body as string)).toMatchObject({
        model: "deepseek-flash",
        reasoning: { effort: effort ?? "high" },
        max_output_tokens: 8192,
        tool_choice: "none",
      });
    },
  );
  it("captures model, effort and recording identity before asynchronous plugin setup", async () => {
    const root = temporary(),
      deepseek = connection();
    const recording = {
      sink: new FileRecordingSink(join(root, "records")),
      apiProfile: deepSeekApiProfile("low"),
      source: "synthetic" as const,
    };
    const selectedModel = { provider: "deepseek", model: "deepseek-flash" };
    const options: RuntimeOptions & {
      deepseekReasoningEffort: DeepSeekReasoningEffort;
      model: { provider: string; model: string };
    } = {
      model: selectedModel,
      deepseek,
      dataDirectory: join(root, "data"),
      deepseekReasoningEffort: "low",
      modelRecording: recording,
      limits: { maxModelRequests: 1, maxRetries: 0 },
      plugins: [
        {
          plugin: {
            name: "mutate-caller",
            apiVersion: 1,
            async setup() {
              selectedModel.provider = "unrelated";
              selectedModel.model = "different-model";
              options.model = { provider: "another-provider", model: "another-model" };
              options.deepseekReasoningEffort = "max";
              recording.apiProfile = DEEPSEEK_API_PROFILE;
              await Promise.resolve();
            },
          },
        },
      ],
    };
    const runtime = await createRuntime(options);
    try {
      await answer(runtime, root);
      options.model = { provider: "late-provider", model: "late-model" };
      options.deepseekReasoningEffort = "none";
      await answer(runtime, root);
    } finally {
      await runtime.close();
    }
    expect(
      deepseek.fetch.mock.calls.every(
        ([, init]) => JSON.parse(init?.body as string).reasoning.effort === "low",
      ),
    ).toBe(true);
    const records = loadModelRecordings(recording.sink.directory);
    expect(records).toHaveLength(2);
    expect(records.every((record) => record.meta.apiProfile === deepSeekApiProfile("low"))).toBe(
      true,
    );
  });
  it("replays low records, rejects cross-effort identities, and snapshots replay before setup", async () => {
    const root = temporary(),
      deepseek = connection();
    const sink = new FileRecordingSink(join(root, "records"));
    const original = await createRuntime({
      model: { provider: "deepseek", model: "deepseek-flash" },
      deepseek,
      deepseekReasoningEffort: "low",
      dataDirectory: join(root, "original"),
      modelRecording: { sink, apiProfile: deepSeekApiProfile("low"), source: "synthetic" },
      limits: { maxModelRequests: 1, maxRetries: 0 },
    });
    try {
      await answer(original, root);
    } finally {
      await original.close();
    }
    const records = loadModelRecordings(sink.directory);
    for (const [effort, apiProfile] of [
      ["high", deepSeekApiProfile("low")],
      ["high", DEEPSEEK_API_PROFILE],
      ["low", DEEPSEEK_API_PROFILE],
    ] as const) {
      const dataDirectory = join(root, `rejected-${effort}-${apiProfile}`);
      await expect(
        createRuntime({
          model: { provider: "deepseek", model: "deepseek-flash" },
          deepseekReasoningEffort: effort,
          dataDirectory,
          modelReplay: { records, apiProfile },
        }),
      ).rejects.toThrow(/profile/i);
      expect(existsSync(dataDirectory)).toBe(false);
    }
    const replayOptions = { records: [...records], apiProfile: deepSeekApiProfile("low") };
    const replay = await createRuntime({
      model: { provider: "deepseek", model: "deepseek-flash" },
      deepseekReasoningEffort: "low",
      dataDirectory: join(root, "replay"),
      modelReplay: replayOptions,
      protectedPaths: [sink.directory],
      limits: { maxModelRequests: 1, maxRetries: 0 },
      plugins: [
        {
          plugin: {
            name: "mutate-replay",
            apiVersion: 1,
            setup() {
              replayOptions.records.splice(0);
              replayOptions.apiProfile = DEEPSEEK_API_PROFILE;
            },
          },
        },
      ],
    });
    try {
      await answer(replay, root);
    } finally {
      await replay.close();
    }
    expect(deepseek.fetch).toHaveBeenCalledTimes(1);
  });
});
