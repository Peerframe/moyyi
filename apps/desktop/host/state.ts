import type { RuntimeOptions } from "moyyi/runtime";
import { DEFAULT_DESKTOP_SETTINGS, type DesktopState } from "../shared.ts";
import type { DesktopHostOptions } from "./types.ts";
import { EMPTY_WEB_ACCESS } from "./web.ts";

export function initialState(
  options: RuntimeOptions,
  display: Pick<DesktopHostOptions, "connection" | "maxOutputTokens" | "settings">,
): DesktopState {
  return {
    status: "ready",
    connection: display.connection ?? { ready: true },
    settings: display.settings ?? DEFAULT_DESKTOP_SETTINGS,
    materials: [],
    reportTarget: null,
    permissions: { writes: false, checks: false },
    webAccess: EMPTY_WEB_ACCESS,
    sources: { items: [], truncated: false },
    openedHistory: false,
    effects: { items: [], offset: 0, hasMore: false },
    effectInspection: null,
    artifacts: { items: [], offset: 0, hasMore: false },
    artifactPreview: null,
    sessions: { items: [], offset: 0, hasMore: false },
    activeSessionId: null,
    workspaceRoot: null,
    model: options.model ? { ...options.model } : null,
    budgets: {
      maxRequests: options.limits?.maxModelRequests ?? null,
      timeoutMs: options.limits?.timeoutMs ?? null,
      maxOutputTokens: display.maxOutputTokens ?? null,
    },
    askEachRead: false,
    messages: [],
    historyTruncated: false,
    streamText: "",
    run: null,
    outcome: null,
    pendingApproval: null,
    error: null,
  };
}
