import { desktopStateSchema } from "../native/state-schema.ts";
import type { DesktopState } from "../shared.ts";

/** Synthetic DTO fixture shared by renderer tests; it never opens the desktop host. */
export function chatTestState(overrides: Partial<DesktopState> = {}): DesktopState {
  return {
    ...desktopStateSchema.initialize({ options: {}, display: {} }),
    status: "ready",
    error: null,
    openedHistory: false,
    sessions: {
      items: [
        {
          sessionId: "session-a",
          workspaceRoot: "/projects/actual-project",
          lastActivityAt: "2026-11-04T01:00:00.000Z",
          promptPreview: "已记录的问题",
        },
      ],
      offset: 0,
      hasMore: false,
    },
    activeSessionId: "session-a",
    workspaceRoot: "/projects/actual-project",
    messages: [],
    historyTruncated: false,
    streamText: "",
    run: null,
    outcome: null,
    effects: { items: [], offset: 0, hasMore: false },
    effectInspection: null,
    pendingApproval: null,
    materials: [],
    reportTarget: null,
    artifacts: { items: [], offset: 0, hasMore: false },
    artifactPreview: null,
    connection: { ready: true },
    settings: { preset: "flash", maxRequests: 3, timeoutMs: 120000 },
    model: { provider: "deepseek", model: "deepseek-v4-flash" },
    budgets: { maxRequests: 3, timeoutMs: 120000, maxOutputTokens: 8192 },
    permissions: { writes: false, checks: false },
    askEachRead: false,
    webAccess: { allowedOrigins: [], dns: "system" },
    sources: { items: [], truncated: false },
    ...overrides,
  };
}
