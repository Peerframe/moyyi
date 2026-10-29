// Whole-list validation and the result shape are adapted from DeepSeek Harness
// packages/todo/tool-todo at f3803c96974ad4a94195fb97e5c637e9c2a3afe3.
// Copyright (c) 2026 DeepSeek. MIT license: ./DEEPSEEK-LICENSE.txt.
import type { ActionDigest, Plugin, ToolDefinition } from "../../contracts/index.ts";

interface Todo {
  readonly content: string;
  readonly status: "pending" | "in_progress" | "completed";
}

export const todoPlugin: Plugin = {
  name: "todo",
  apiVersion: 1,
  setup(host) {
    if (host.config !== undefined) throw Error("todo does not accept configuration");
    host.registerTool(todoWrite);
  },
};

const todoWrite: ToolDefinition = {
  name: "todo_write",
  description:
    "Keep a task list for work with three or more steps or multiple user requirements. " +
    "Match each requirement to a concrete todo before starting; keep at most one in_progress " +
    "and mark each completed as soon as it is done. Send the COMPLETE list every time; " +
    "each successful call replaces the previous list. Skip this tool for simple one-step work.",
  inputSchema: {
    type: "object",
    properties: {
      todos: {
        type: "array",
        description: "The complete replacement list; an empty array clears it.",
        items: {
          type: "object",
          properties: {
            content: { type: "string", minLength: 1 },
            status: { type: "string", enum: ["pending", "in_progress", "completed"] },
          },
          required: ["content", "status"],
          additionalProperties: false,
        },
      },
    },
    required: ["todos"],
    additionalProperties: false,
  },
  effect: { class: "read", reversibility: "not_applicable", verification: "not_applicable" },
  async prepare(value, context) {
    context.signal.throwIfAborted();
    return {
      digest: "runtime-computes-action-digest" as ActionDigest,
      summary: "Update todo list",
      preconditions: [],
      payload: { todos: todoList(value) },
    };
  },
  async execute(action, context) {
    context.signal.throwIfAborted();
    const todos = todoList(action.payload);
    const counts = { pending: 0, in_progress: 0, completed: 0 };
    for (const todo of todos) counts[todo.status]++;
    return {
      status: "succeeded",
      content: [
        {
          type: "text",
          text: `Updated todo list: ${counts.pending} pending, ${counts.in_progress} in progress, ${counts.completed} completed.`,
        },
      ],
    };
  },
};

function todoList(value: unknown): readonly Todo[] {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw Error("invalid todos: expected an object containing only the todos array");
  const args = value as Record<string, unknown>;
  if (Object.keys(args).length !== 1 || !Object.hasOwn(args, "todos") || !Array.isArray(args.todos))
    throw Error("invalid todos: expected an object containing only the todos array");
  const seen = new Set<string>();
  let active = 0;
  const todos: Todo[] = [];
  for (const value of args.todos) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw Error("invalid todo: expected only content and status");
    const item = value as Record<string, unknown>;
    if (
      Object.keys(item).length !== 2 ||
      !Object.hasOwn(item, "content") ||
      !Object.hasOwn(item, "status")
    )
      throw Error("invalid todo: expected only content and status");
    if (typeof item.content !== "string" || !item.content.isWellFormed() || !item.content.trim())
      throw Error("invalid todo: content must be non-empty valid text");
    const content = item.content.trim();
    if (seen.has(content)) throw Error("invalid todos: duplicate content");
    if (item.status !== "pending" && item.status !== "in_progress" && item.status !== "completed")
      throw Error("invalid todo: status must be pending, in_progress or completed");
    seen.add(content);
    if (item.status === "in_progress") active++;
    todos.push({ content, status: item.status });
  }
  if (active > 1) throw Error("invalid todos: at most one task may be in_progress");
  return todos;
}
