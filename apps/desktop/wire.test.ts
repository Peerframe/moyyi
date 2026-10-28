import { describe, expect, it } from "vitest";
import type { DesktopState } from "./shared.ts";
import { isDesktopState, isWorkerMessage, isWorkerRequest } from "./wire.ts";

const state: DesktopState = {
  status: "ready",
  connection: { ready: true },
  settings: { preset: "flash", maxRequests: 3, timeoutMs: 120_000 },
  materials: [],
  reportTarget: null,
  permissions: { writes: false, checks: false },
  openedHistory: false,
  effects: { items: [], offset: 0, hasMore: false },
  effectInspection: null,
  artifacts: { items: [], offset: 0, hasMore: false },
  artifactPreview: null,
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
  it("accepts existing high settings on saved and restarted state without relaxing the settings schema", () => {
    const settings = {
      preset: "kimi-cn",
      maxRequests: 8,
      timeoutMs: 300_000,
      kimiReasoningEffort: "high",
    };
    for (const preset of ["kimi-cn", "kimi-global"]) {
      const candidate = { ...state, settings: { ...settings, preset } };
      expect(isDesktopState(candidate)).toBe(true);
      expect(isWorkerMessage(JSON.parse(JSON.stringify({ type: "state", state: candidate })))).toBe(
        true,
      );
    }
    for (const changed of [
      ...["unsupported", null, 0, 1, {}, []].map((preset) => ({ preset })),
      { maxRequests: 9 },
      { apiKey: "must-not-cross" },
      { unexpectedFlag: true },
    ])
      expect(
        isWorkerMessage({
          type: "state",
          state: { ...state, settings: { ...settings, ...changed } },
        }),
      ).toBe(false);
    expect(isDesktopState({ ...state, settings: { ...settings, preset: "flash" } })).toBe(false);
  });

  it("preserves unknown effects, exact receipts and expected absence without accepting authority", () => {
    const effect = {
      effectId: "effect_1",
      runId: "run_1",
      tool: "undo",
      state: "succeeded",
      updatedAt: "2026-10-27T00:00:00Z",
      receipt: {
        kind: "file",
        path: "report.md",
        snapshotId: "effect_1",
        beforeHash: "a".repeat(64),
        afterHash: null,
      },
    };
    const candidate = {
      ...state,
      permissions: { writes: true, checks: true },
      openedHistory: true,
      effects: {
        items: [
          effect,
          { ...effect, effectId: "effect_2", tool: "shell", state: "unknown", receipt: null },
        ],
        offset: 20,
        hasMore: true,
      },
      effectInspection: {
        effectId: "effect_1",
        path: "report.md",
        state: "absent",
        expectedHash: null,
        actualHash: null,
      },
    };
    expect(isDesktopState(candidate)).toBe(true);
    for (const changed of [
      { permissions: { writes: true, checks: true, remembered: true } },
      { openedHistory: "replayed" },
      { effects: { ...candidate.effects, items: Array(21).fill(effect) } },
      { effects: { ...candidate.effects, items: [{ ...effect, state: "complete" }] } },
      {
        effects: {
          ...candidate.effects,
          items: [{ ...effect, receipt: { ...effect.receipt, apply: "now" } }],
        },
      },
      { effectInspection: { ...candidate.effectInspection, actualHash: "bad" } },
    ])
      expect(isDesktopState({ ...candidate, ...changed })).toBe(false);
    const process = { kind: "process", exitCode: 1, termination: "exited", outputTruncated: true };
    expect(
      isDesktopState({
        ...state,
        effects: {
          items: [{ ...effect, tool: "shell", state: "failed", receipt: process }],
          offset: 0,
          hasMore: false,
        },
      }),
    ).toBe(true);
    expect(
      isDesktopState({
        ...state,
        effects: {
          items: [{ ...effect, receipt: { ...process, exitCode: 0.5 } }],
          offset: 0,
          hasMore: false,
        },
      }),
    ).toBe(false);
  });
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
      { settings: { preset: "flash", maxRequests: 3, timeoutMs: 120000, apiKey: "secret" } },
      { settings: { preset: "flash", maxRequests: 99, timeoutMs: 120000 } },
      {
        materials: [
          {
            path: "a.pdf",
            format: "pdf",
            sha256: "a".repeat(64),
            sourceBytes: 1,
            rawBytes: "secret",
          },
        ],
      },
      {
        artifactPreview: {
          effectId: "e",
          path: "r.json",
          sha256: "a".repeat(64),
          sourceBytes: 1,
          truncated: false,
          text: "x".repeat(65537),
        },
      },
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
