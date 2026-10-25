import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ActionDigest,
  ModelClient,
  ModelStreamEvent,
  Plugin,
  RuntimeEvent,
  SessionId,
  ToolCallId,
  ToolDefinition,
} from "../src/contracts/index.ts";
import { UNKNOWN_USAGE } from "../src/contracts/index.ts";
import { ScriptedModelClient, scriptedProfile } from "../src/plugins/provider-scripted/index.ts";
import {
  createRuntime,
  type DevelopmentPlugin,
  type Runtime,
  type RuntimeOptions,
} from "../src/runtime/index.ts";

const disposables: { runtime: Runtime; directory: string }[] = [];
afterEach(async () => {
  for (const { runtime, directory } of disposables.splice(0)) {
    await runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
const done: ModelStreamEvent = {
  type: "completed",
  stopReason: "end_turn",
  providerStopReason: null,
  usage: UNKNOWN_USAGE,
};
const final = (text: string): readonly ModelStreamEvent[] => [
  { type: "part_completed", index: 0, part: { type: "text", text } },
  done,
];
const call = (id: string): readonly ModelStreamEvent[] => [
  {
    type: "part_completed",
    index: 0,
    part: {
      type: "tool_call",
      callId: id as ToolCallId,
      providerCallId: id,
      providerItemId: null,
      name: "version",
      rawArguments: "{}",
      argumentsSource: "verbatim",
    },
  },
  { ...done, type: "completed", stopReason: "tool_use" },
];
function tool(value: string, execute?: ToolDefinition["execute"]): ToolDefinition {
  return {
    name: "version",
    description: "Read synthetic version",
    inputSchema: { type: "object", additionalProperties: false },
    effect: { class: "read", reversibility: "none", verification: "none" },
    async prepare() {
      return {
        digest: "unused" as ActionDigest,
        summary: "Read synthetic version",
        preconditions: [],
        payload: null,
      };
    },
    execute:
      execute ?? (async () => ({ status: "succeeded", content: [{ type: "text", text: value }] })),
  };
}
function tools(version: string, onDispose = () => {}, execute?: ToolDefinition["execute"]): Plugin {
  return {
    name: "dev-tools",
    apiVersion: 1,
    setup(host) {
      host.registerTool(tool(version, execute));
      host.onDispose(onDispose);
    },
  };
}
function provider(client: ModelClient, createClient = vi.fn(() => client)): Plugin {
  return {
    name: "dev-model",
    apiVersion: 1,
    setup(host) {
      host.registerModelProvider({ id: "scripted", models: [scriptedProfile], createClient });
    },
  };
}
async function harness(
  plugins: readonly Plugin[],
  developmentPlugins: readonly DevelopmentPlugin[],
  extra: Partial<RuntimeOptions> = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "moyyi-reload-"));
  const workspace = join(directory, "workspace");
  mkdirSync(workspace);
  let runtime: Runtime;
  try {
    runtime = await createRuntime({
      model: scriptedProfile.origin,
      dataDirectory: join(directory, "data"),
      plugins: plugins.map((plugin) => ({ plugin })),
      developmentPlugins,
      ...extra,
    });
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  disposables.push({ runtime, directory });
  const events: RuntimeEvent[] = [];
  runtime.subscribe((event) => events.push(event));
  async function session() {
    await runtime.send({ type: "session.create", workspaceRoot: workspace });
    const ready = events.findLast((e) => e.type === "session.ready");
    if (ready?.type !== "session.ready") throw Error("Missing session");
    return ready.sessionId;
  }
  async function run(sessionId: SessionId) {
    await runtime.send({
      type: "run.start",
      sessionId,
      input: [{ type: "text", text: "Read version" }],
    });
    await runtime.idle();
  }
  return { runtime, directory, events, session, run };
}

describe("runtime development reload", () => {
  it.each([
    { stage: "load", initial: true },
    { stage: "load", initial: false },
    { stage: "setup", initial: true },
    { stage: "setup", initial: false },
    { stage: "client", initial: true },
    { stage: "client", initial: false },
  ])(
    "redacts $stage failures at startup=$initial and keeps the plugin repairable",
    async ({ stage, initial }) => {
      const secret = "Bearer SYNTHETIC-SECRET-CHECK";
      let broken = initial;
      const test = await harness(
        [],
        [
          {
            name: "dev-model",
            load: async () => {
              if (broken && stage === "load") throw Error(secret);
              return {
                plugin: {
                  name: "dev-model",
                  apiVersion: 1,
                  setup(host) {
                    if (broken && stage === "setup") throw Error(secret);
                    host.registerModelProvider({
                      id: "scripted",
                      models: [scriptedProfile],
                      createClient() {
                        if (broken && stage === "client") throw Error(secret);
                        return new ScriptedModelClient([final("safe")]);
                      },
                    });
                  },
                },
              };
            },
          },
        ],
      );
      if (!initial) {
        broken = true;
        await test.runtime.send({ type: "plugin.reload", name: "dev-model" });
      }
      const failure = test.runtime.plugins.find((plugin) => plugin.name === "dev-model");
      expect(failure).toMatchObject({
        state: "failed",
        error: expect.stringMatching(
          /Development plugin (import|setup|model initialization) failed/,
        ),
      });
      expect(
        JSON.stringify({
          plugins: test.runtime.plugins,
          events: test.events,
          diagnostics: test.runtime.diagnostics,
        }),
      ).not.toContain(secret);
      if (!initial)
        expect(test.events.filter((event) => event.type === "plugin.status").at(-1)).toMatchObject({
          name: "dev-model",
          state: "failed",
        });
      broken = false;
      await test.runtime.send({ type: "plugin.reload", name: "dev-model" });
      await test.run(await test.session());
      expect(
        test.events.filter((event) => event.type === "run.finished").at(-1)?.outcome.kind,
      ).toBe("completed");
    },
  );
  it("replaces tools between runs, preserves the session and unrelated provider client", async () => {
    const disposed = vi.fn();
    let version = "one";
    const createClient = vi.fn(
      () => new ScriptedModelClient([call("one"), final("first"), call("two"), final("second")]),
    );
    const test = await harness(
      [provider(new ScriptedModelClient([]), createClient)],
      [{ name: "dev-tools", load: async () => ({ plugin: tools(version, disposed) }) }],
    );
    const sessionId = await test.session();
    await test.run(sessionId);
    version = "two";
    await test.runtime.send({ type: "plugin.reload", name: "dev-tools" });
    await test.run(sessionId);
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledTimes(1);
    const results = test.events.flatMap((e) =>
      e.type === "entry.appended" && e.entry.body.kind === "tool_results"
        ? e.entry.body.results
        : [],
    );
    expect(results.map((r) => r.content[0])).toEqual([
      { type: "text", text: "one" },
      { type: "text", text: "two" },
    ]);
    expect(test.events.filter((e) => e.type === "run.finished").map((e) => e.outcome.kind)).toEqual(
      ["completed", "completed"],
    );
    expect(test.events).toContainEqual({
      type: "plugin.status",
      name: "dev-tools",
      state: "loaded",
    });
  });
  it("recreates a disposed selected client even when the plugin registers the same provider object", async () => {
    let dispose = () => {};
    const createClient = vi.fn((): ModelClient => {
      let closed = false;
      dispose = () => {
        closed = true;
      };
      return {
        async *stream() {
          if (closed) throw Error("Disposed client reused");
          yield* final("usable client");
        },
      };
    });
    const sharedProvider = { id: "scripted", models: [scriptedProfile], createClient };
    const sharedPlugin: Plugin = {
      name: "dev-model",
      apiVersion: 1,
      setup(host) {
        host.registerModelProvider(sharedProvider);
        host.onDispose(() => dispose());
      },
    };
    const test = await harness(
      [],
      [{ name: "dev-model", load: async () => ({ plugin: sharedPlugin }) }],
    );
    const sessionId = await test.session();
    await test.run(sessionId);
    await test.runtime.send({ type: "plugin.reload", name: "dev-model" });
    await test.run(sessionId);
    expect(createClient).toHaveBeenCalledTimes(2);
    expect(
      test.events
        .filter((event) => event.type === "run.finished")
        .map((event) => event.outcome.kind),
    ).toEqual(["completed", "completed"]);
  });
  it("unloads before import, reports failed import and removes old callable tools", async () => {
    const disposed = vi.fn();
    let broken = false;
    const test = await harness(
      [provider(new ScriptedModelClient([call("lost"), final("handled")]))],
      [
        {
          name: "dev-tools",
          load: async () => {
            if (broken) {
              expect(disposed).toHaveBeenCalledTimes(1);
              throw Error("syntax changed");
            }
            return { plugin: tools("old", disposed) };
          },
        },
      ],
    );
    const sessionId = await test.session();
    broken = true;
    await test.runtime.send({ type: "plugin.reload", name: "dev-tools" });
    await test.run(sessionId);
    expect(test.runtime.plugins).toContainEqual({
      name: "dev-tools",
      state: "failed",
      error: "Development plugin import failed; fix the entry and reload",
    });
    expect(
      test.events.some(
        (e) =>
          e.type === "entry.appended" &&
          e.entry.body.kind === "tool_results" &&
          e.entry.body.results[0]?.status === "failed",
      ),
    ).toBe(true);
  });
  it("discards staged contributions when new setup throws and allows later repair", async () => {
    let broken = false;
    const cleanup = vi.fn();
    const test = await harness(
      [provider(new ScriptedModelClient([call("fixed"), final("ok")]))],
      [
        {
          name: "dev-tools",
          load: async () => ({
            plugin: {
              name: "dev-tools",
              apiVersion: 1,
              setup(host) {
                host.registerTool(tool("repaired"));
                host.onDispose(cleanup);
                if (broken) throw Error("setup failed");
              },
            },
          }),
        },
      ],
    );
    const sessionId = await test.session();
    broken = true;
    await test.runtime.send({ type: "plugin.reload", name: "dev-tools" });
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(test.runtime.plugins.find((p) => p.name === "dev-tools")?.state).toBe("failed");
    broken = false;
    await test.runtime.send({ type: "plugin.reload", name: "dev-tools" });
    await test.run(sessionId);
    expect(test.events.filter((e) => e.type === "run.finished").at(-1)?.outcome.kind).toBe(
      "completed",
    );
  });
  it("rejects reload while a tool is active and still accepts cancellation", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const disposed = vi.fn();
    const load = vi.fn(async () => ({
      plugin: tools("held", disposed, async () => {
        entered.resolve();
        await release.promise;
        return { status: "succeeded", content: [] };
      }),
    }));
    const test = await harness(
      [provider(new ScriptedModelClient([call("held")]))],
      [{ name: "dev-tools", load }],
    );
    const sessionId = await test.session();
    await test.runtime.send({
      type: "run.start",
      sessionId,
      input: [{ type: "text", text: "start" }],
    });
    await entered.promise;
    await test.runtime.send({ type: "plugin.reload", name: "dev-tools" });
    expect(load).toHaveBeenCalledTimes(1);
    expect(disposed).not.toHaveBeenCalled();
    expect(test.events).toContainEqual({
      type: "command.rejected",
      command: "plugin.reload",
      reason: expect.stringMatching(/idle/),
    });
    const started = test.events.find((e) => e.type === "run.started");
    if (started?.type !== "run.started") throw Error("Missing run");
    await test.runtime.send({ type: "run.cancel", runId: started.runId });
    release.resolve();
    await test.runtime.idle();
    expect(test.events.filter((e) => e.type === "run.finished").at(-1)?.outcome.kind).toBe(
      "cancelled",
    );
    await test.runtime.send({ type: "plugin.reload", name: "dev-tools" });
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("holds synchronous admission across asynchronous imports and permits no half-reloaded run", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let reload = false;
    const test = await harness(
      [provider(new ScriptedModelClient([final("later")]))],
      [
        {
          name: "dev-tools",
          load: async () => {
            if (reload) {
              entered.resolve();
              await release.promise;
            }
            return { plugin: tools("ready") };
          },
        },
      ],
    );
    const sessionId = await test.session();
    reload = true;
    const loading = test.runtime.send({ type: "plugin.reload", name: "dev-tools" });
    await entered.promise;
    await test.runtime.send({
      type: "run.start",
      sessionId,
      input: [{ type: "text", text: "race" }],
    });
    expect(test.events.some((e) => e.type === "run.started")).toBe(false);
    expect(test.events).toContainEqual({
      type: "command.rejected",
      command: "run.start",
      reason: "Plugin reload is in progress",
    });
    release.resolve();
    await loading;
    await test.run(sessionId);
    expect(test.events.some((e) => e.type === "run.started")).toBe(true);
  });
  it("rejects a reload racing an already accepted run.start", async () => {
    const release = Promise.withResolvers<void>();
    const model: ModelClient = {
      async *stream() {
        await release.promise;
        yield done;
      },
    };
    const load = vi.fn(async () => ({ plugin: tools("same") }));
    const test = await harness([provider(model)], [{ name: "dev-tools", load }]);
    const sessionId = await test.session();
    const start = test.runtime.send({
      type: "run.start",
      sessionId,
      input: [{ type: "text", text: "race" }],
    });
    await test.runtime.send({ type: "plugin.reload", name: "dev-tools" });
    expect(load).toHaveBeenCalledTimes(1);
    release.resolve();
    await start;
    await test.runtime.idle();
  });
  it("missing selected provider blocks runs and a repaired provider reconnects without losing sessions", async () => {
    let broken = false;
    const load = async () => {
      if (broken) throw Error("missing provider");
      return { plugin: provider(new ScriptedModelClient([final("restored")])) };
    };
    const test = await harness([], [{ name: "dev-model", load }]);
    const sessionId = await test.session();
    broken = true;
    await test.runtime.send({ type: "plugin.reload", name: "dev-model" });
    await test.run(sessionId);
    expect(test.events).toContainEqual({
      type: "command.rejected",
      command: "run.start",
      reason: "Configured model is not registered",
    });
    broken = false;
    await test.runtime.send({ type: "plugin.reload", name: "dev-model" });
    await test.run(sessionId);
    expect(test.events.filter((e) => e.type === "run.finished").at(-1)?.outcome.kind).toBe(
      "completed",
    );
  });
  it("keeps an initially broken development provider repairable", async () => {
    let broken = true;
    const test = await harness(
      [],
      [
        {
          name: "dev-model",
          load: async () => {
            if (broken) throw Error("initial failure");
            return { plugin: provider(new ScriptedModelClient([final("ready")])) };
          },
        },
      ],
    );
    expect(test.runtime.plugins.find((p) => p.name === "dev-model")?.state).toBe("failed");
    broken = false;
    await test.runtime.send({ type: "plugin.reload", name: "dev-model" });
    await test.run(await test.session());
    expect(test.events.filter((e) => e.type === "run.finished").at(-1)?.outcome.kind).toBe(
      "completed",
    );
  });
  it("close during an import waits, discards its result and never sets up new code", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const setup = vi.fn();
    let reload = false;
    const test = await harness(
      [provider(new ScriptedModelClient([]))],
      [
        {
          name: "dev-tools",
          load: async () => {
            if (reload) {
              entered.resolve();
              await release.promise;
              return { plugin: { name: "dev-tools", apiVersion: 1, setup } };
            }
            return { plugin: tools("old") };
          },
        },
      ],
    );
    reload = true;
    const loading = test.runtime.send({ type: "plugin.reload", name: "dev-tools" });
    await entered.promise;
    const closing = test.runtime.close();
    release.resolve();
    await loading;
    await closing;
    expect(setup).not.toHaveBeenCalled();
    await test.runtime.send({ type: "plugin.reload", name: "dev-tools" });
    expect(test.events.some((e) => e.type === "plugin.status")).toBe(false);
  });

  it("close during old-plugin disposal prevents the replacement import", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const load = vi.fn(async () => ({
      plugin: {
        name: "dev-tools",
        apiVersion: 1 as const,
        setup(host: Parameters<Plugin["setup"]>[0]) {
          host.onDispose(async () => {
            entered.resolve();
            await release.promise;
          });
        },
      },
    }));
    const test = await harness(
      [provider(new ScriptedModelClient([]))],
      [{ name: "dev-tools", load }],
    );
    const loading = test.runtime.send({ type: "plugin.reload", name: "dev-tools" });
    await entered.promise;
    const closing = test.runtime.close();
    release.resolve();
    await loading;
    await closing;
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("rejects undeclared plugins and names that collide with startup plugins", async () => {
    const test = await harness([provider(new ScriptedModelClient([]))], []);
    await test.runtime.send({ type: "plugin.reload", name: "fs" });
    expect(test.events).toContainEqual({
      type: "command.rejected",
      command: "plugin.reload",
      reason: "Plugin is not configured for development reload",
    });
    await expect(
      harness(
        [provider(new ScriptedModelClient([]))],
        [{ name: "fs", load: async () => ({ plugin: tools("bad") }) }],
      ),
    ).rejects.toThrow(/cannot replace/);
  });
  it("rejects model recording/replay combined with development reload", async () => {
    await expect(
      createRuntime({
        developmentPlugins: [
          { name: "dev-tools", load: async () => ({ plugin: tools("unused") }) },
        ],
        modelReplay: { records: [], apiProfile: "test" },
      }),
    ).rejects.toThrow(/cannot be combined/);
  });
});
