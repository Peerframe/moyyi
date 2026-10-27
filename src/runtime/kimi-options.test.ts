import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import type { RuntimeEvent } from "../contracts/index.ts";
import { kimiFixture } from "../plugins/provider-kimi/fixtures.ts";
import { createRuntime, kimiApiProfile, type RuntimeOptions } from "./index.ts";

it("rejects ambiguous Kimi configuration before storage, credentials or network", async () => {
  const root = mkdtempSync(join(tmpdir(), "moyyi-kimi-config-"));
  const getApiKey = vi.fn(() => "synthetic-key"),
    send = vi.fn<typeof fetch>();
  const connection = { region: "cn" as const, getApiKey, fetch: send };
  try {
    const cases = [
      { kimiReasoningEffort: "none", kimi: connection },
      { kimiReasoningEffort: "medium", kimi: connection },
      { kimiReasoningEffort: "low" },
      { kimi: { ...connection, region: "unknown" } },
      { model: { provider: "deepseek", model: "deepseek-flash" }, kimi: connection },
      { kimi: connection, modelReplay: { records: [], apiProfile: kimiApiProfile() } },
      {
        kimiReasoningEffort: "high",
        modelReplay: { records: [], apiProfile: kimiApiProfile("low") },
      },
    ];
    for (const [index, patch] of cases.entries()) {
      const dataDirectory = join(root, String(index));
      await expect(
        createRuntime({
          model: { provider: "kimi", model: "kimi-k3.1-pro" },
          dataDirectory,
          ...patch,
        } as RuntimeOptions),
      ).rejects.toThrow();
      expect(existsSync(dataDirectory)).toBe(false);
    }
    expect(getApiKey).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it.each([undefined, "low", "high", "max"] as const)(
  "freezes Kimi effort %s before async plugin setup",
  async (effort) => {
    const root = mkdtempSync(join(tmpdir(), "moyyi-kimi-config-"));
    const getApiKey = vi.fn(() => "synthetic-key");
    const send = vi.fn<typeof fetch>(
      async () =>
        new Response(kimiFixture({ text: "Synthetic answer." }), {
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const options: RuntimeOptions & { kimiReasoningEffort?: "low" | "high" | "max" } = {
      model: { provider: "kimi", model: "kimi-k3.1-pro" },
      dataDirectory: join(root, "data"),
      kimi: { region: "cn", getApiKey, fetch: send },
      ...(effort ? { kimiReasoningEffort: effort } : {}),
      limits: { maxModelRequests: 1, maxRetries: 0 },
      plugins: [
        {
          plugin: {
            name: "mutate-caller",
            apiVersion: 1,
            async setup() {
              options.kimiReasoningEffort = "max";
              await Promise.resolve();
            },
          },
        },
      ],
    };
    const runtime = await createRuntime(options);
    try {
      expect(getApiKey).not.toHaveBeenCalled();
      const events: RuntimeEvent[] = [];
      runtime.subscribe((event) => events.push(event));
      await runtime.send({ type: "session.create", workspaceRoot: root });
      const ready = events.find((event) => event.type === "session.ready");
      expect(ready).toBeDefined();
      if (!ready) throw Error("Missing synthetic session");
      await runtime.send({
        type: "run.start",
        sessionId: ready.sessionId,
        input: [{ type: "text", text: "Answer briefly." }],
      });
      await runtime.idle();
      expect(events.findLast((event) => event.type === "run.finished")?.outcome.kind).toBe(
        "completed",
      );
      expect(send).toHaveBeenCalledTimes(1);
      expect(JSON.parse(send.mock.calls[0]?.[1]?.body as string)).toMatchObject({
        model: "kimi-k3.1-pro",
        reasoning_effort: effort ?? "low",
        max_completion_tokens: 8192,
        tool_choice: "none",
      });
    } finally {
      await runtime.close();
      rmSync(root, { recursive: true, force: true });
    }
  },
);
