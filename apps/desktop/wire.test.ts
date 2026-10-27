import { describe, expect, it } from "vitest";
import type { DesktopState } from "./shared.ts";
import { isDesktopState, isWorkerMessage, isWorkerRequest } from "./wire.ts";

const state: DesktopState = {
  status: "ready",
  connection: { ready: true },
  sessions: { items: [], offset: 0, hasMore: false },
  activeSessionId: null,
  workspaceRoot: null,
  model: { provider: "deepseek", model: "deepseek-flash" },
  budgets: { maxRequests: 3, timeoutMs: 120_000, maxOutputTokens: 8192 },
  askEachRead: false,
  messages: [],
  historyTruncated: false,
  streamText: "",
  run: null,
  outcome: null,
  pendingApproval: null,
  error: null,
};
describe("desktop wire data", () => {
  it("accepts only the bounded display projection, including partial/denied states", () => {
    expect(isDesktopState(state)).toBe(true);
    expect(
      isDesktopState({
        ...state,
        messages: [{ id: "1", role: "tool", state: "denied", tool: "read", text: "Denied" }],
        outcome: { kind: "budget_exhausted", detail: "model_requests" },
      }),
    ).toBe(true);
    for (const changed of [
      { apiKey: "secret" },
      { connection: { ready: "yes" } },
      { sessions: { items: [], offset: -1, hasMore: false } },
      { messages: [{ id: "1", role: "system", text: "x" }] },
      { run: { id: "r", state: "executed" } },
      { pendingApproval: { effectId: "e", digest: "d", summary: "s", authority: true } },
      { streamText: "x".repeat(300_000) },
      { model: { provider: "x", model: "y", getApiKey: "secret" } },
    ])
      expect(isDesktopState({ ...state, ...changed })).toBe(false);
  });
  it("rejects malformed or oversized messages before forwarding", () => {
    expect(isWorkerMessage({ type: "state", state })).toBe(true);
    expect(isWorkerMessage({ type: "ack", id: 1 })).toBe(true);
    expect(isWorkerMessage({ type: "ack", id: 1, error: "Rejected" })).toBe(true);
    for (const message of [
      { type: "state", state, token: "secret" },
      { type: "ack", id: 1, command: "shell" },
      { type: "fatal", message: "x".repeat(5000) },
      { type: "ack", id: -1 },
    ])
      expect(isWorkerMessage(message)).toBe(false);
    expect(isWorkerRequest({ type: "command", id: 1, command: { type: "list", offset: 0 } })).toBe(
      true,
    );
    expect(isWorkerRequest({ type: "command", id: 1, command: { text: "x".repeat(70_000) } })).toBe(
      false,
    );
  });
});
