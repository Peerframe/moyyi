import { describe, expect, it, vi } from "vitest";
import type { PluginHost, RunId, ToolContext, ToolDefinition } from "../../contracts/index.ts";
import { todoPlugin } from "./index.ts";

async function registered(config?: unknown) {
  const tools: ToolDefinition[] = [];
  const host: PluginHost = {
    pluginName: "todo",
    config,
    registerTool: (tool) => tools.push(tool),
    registerModelProvider: vi.fn(),
    registerContextSource: vi.fn(),
    registerPolicyRule: vi.fn(),
    onEvent: vi.fn(),
    onDispose: vi.fn(),
  };
  await todoPlugin.setup(host);
  expect(tools).toHaveLength(1);
  expect(host.registerContextSource).not.toHaveBeenCalled();
  expect(host.registerPolicyRule).not.toHaveBeenCalled();
  expect(host.onEvent).not.toHaveBeenCalled();
  return tools[0] as ToolDefinition;
}

function context(signal = new AbortController().signal): ToolContext {
  return {
    runId: "todo_test" as RunId,
    workspaceRoot: "/synthetic/workspace",
    signal,
    limits: { maxOutputBytes: 8192 },
  };
}

describe("todo_write", () => {
  it("registers one read tool with a closed full-list schema and no context or policy hook", async () => {
    const tool = await registered();
    expect(tool.name).toBe("todo_write");
    expect(tool.effect).toEqual({
      class: "read",
      reversibility: "not_applicable",
      verification: "not_applicable",
    });
    expect(tool.inputSchema).toMatchObject({
      required: ["todos"],
      additionalProperties: false,
      properties: {
        todos: {
          type: "array",
          items: {
            required: ["content", "status"],
            additionalProperties: false,
            properties: { status: { enum: ["pending", "in_progress", "completed"] } },
          },
        },
      },
    });
    expect(tool.description).toContain("three or more steps or multiple user requirements");
    expect(tool.reconcile).toBeUndefined();
  });

  it.each([null, {}, true])("rejects unsupported plugin configuration %j", async (config) => {
    await expect(registered(config)).rejects.toThrow("todo does not accept configuration");
  });

  it("copies trimmed items and returns only counts without accessing capabilities", async () => {
    const tool = await registered(),
      ctx = context();
    const firstTodo = { content: "  Inspect evidence  ", status: "completed" };
    const input = {
      todos: [
        firstTodo,
        { content: "Implement requirements", status: "in_progress" },
        { content: "Verify requirements", status: "pending" },
      ],
    };
    const action = await tool.prepare(input, ctx);
    firstTodo.content = "Changed by the caller";
    input.todos.push({ content: "Another requirement", status: "pending" });
    expect(action.payload).toEqual({
      todos: [
        { content: "Inspect evidence", status: "completed" },
        { content: "Implement requirements", status: "in_progress" },
        { content: "Verify requirements", status: "pending" },
      ],
    });
    expect(action.preconditions).toEqual([]);
    expect(await tool.execute(action, ctx)).toEqual({
      status: "succeeded",
      content: [
        { type: "text", text: "Updated todo list: 1 pending, 1 in progress, 1 completed." },
      ],
    });
  });

  it("treats each list as a complete replacement, including an empty list", async () => {
    const tool = await registered(),
      ctx = context();
    for (const [todos, text] of [
      [[{ content: "Inspect", status: "pending" }], "1 pending, 0 in progress, 0 completed"],
      [[{ content: "Verify", status: "completed" }], "0 pending, 0 in progress, 1 completed"],
      [[], "0 pending, 0 in progress, 0 completed"],
    ] as const) {
      const result = await tool.execute(await tool.prepare({ todos }, ctx), ctx);
      expect(result.content).toEqual([{ type: "text", text: `Updated todo list: ${text}.` }]);
    }
  });

  it.each([
    [null, "invalid todos: expected an object containing only the todos array"],
    [{}, "invalid todos: expected an object containing only the todos array"],
    [{ todos: "no" }, "invalid todos: expected an object containing only the todos array"],
    [
      { todos: [], extra: true },
      "invalid todos: expected an object containing only the todos array",
    ],
    [{ todos: [null] }, "invalid todo: expected only content and status"],
    [{ todos: [{ content: "x" }] }, "invalid todo: expected only content and status"],
    [
      { todos: [{ content: "x", status: "pending", extra: true }] },
      "invalid todo: expected only content and status",
    ],
    [
      { todos: [{ content: " \t\n ", status: "pending" }] },
      "invalid todo: content must be non-empty valid text",
    ],
    [
      { todos: [{ content: "\ud800", status: "pending" }] },
      "invalid todo: content must be non-empty valid text",
    ],
    [
      { todos: [{ content: "x", status: "doing" }] },
      "invalid todo: status must be pending, in_progress or completed",
    ],
    [
      {
        todos: [
          { content: "same", status: "pending" },
          { content: " same ", status: "completed" },
        ],
      },
      "invalid todos: duplicate content",
    ],
    [
      {
        todos: [
          { content: "first", status: "in_progress" },
          { content: "second", status: "in_progress" },
        ],
      },
      "invalid todos: at most one task may be in_progress",
    ],
  ])("rejects malformed or incoherent lists with a fixed error: %j", async (value, error) => {
    const tool = await registered(),
      ctx = context();
    await expect(tool.prepare(value, ctx)).rejects.toThrow(error);
    const action = await tool.prepare({ todos: [] }, ctx);
    await expect(tool.execute({ ...action, payload: value }, ctx)).rejects.toThrow(error);
  });

  it("keeps case-sensitive and Unicode tasks distinct", async () => {
    const tool = await registered(),
      ctx = context();
    const action = await tool.prepare(
      {
        todos: [
          { content: "Read", status: "pending" },
          { content: "read", status: "pending" },
          { content: "核对证据 😀", status: "pending" },
        ],
      },
      ctx,
    );
    expect((await tool.execute(action, ctx)).content).toEqual([
      { type: "text", text: "Updated todo list: 3 pending, 0 in progress, 0 completed." },
    ]);
  });

  it("honors cancellation before preparation and between preparation and execution", async () => {
    const tool = await registered(),
      controller = new AbortController(),
      ctx = context(controller.signal);
    const value = { todos: [{ content: "Inspect", status: "in_progress" }] };
    const action = await tool.prepare(value, ctx);
    controller.abort(Error("cancelled"));
    await expect(tool.prepare(value, ctx)).rejects.toThrow("cancelled");
    await expect(tool.execute(action, ctx)).rejects.toThrow("cancelled");
    const fresh = context();
    expect((await tool.execute(await tool.prepare({ todos: [] }, fresh), fresh)).content).toEqual([
      { type: "text", text: "Updated todo list: 0 pending, 0 in progress, 0 completed." },
    ]);
  });
});
