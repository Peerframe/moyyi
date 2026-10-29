import type { DesktopState } from "../shared.ts";
import { EMPTY_WEB_ACCESS } from "./web.ts";

/** Shared lifecycle invalidations; features supply only their own state changes. */
const transitions = {
  "session.removed": {
    messages: [],
    materials: [],
    library: { items: [], offset: 0, hasMore: false, housekeeping: false },
    materialPreview: null,
    artifactPreview: null,
    effects: { items: [], offset: 0, hasMore: false },
    artifacts: { items: [], offset: 0, hasMore: false },
    sources: { items: [], truncated: false },
    outcome: null,
  },
  "session.recycled": {
    messages: [],
    streamText: "",
    materials: [],
    library: { items: [], offset: 0, hasMore: false, housekeeping: false },
    materialPreview: null,
    outcome: null,
    effects: { items: [], offset: 0, hasMore: false },
    artifacts: { items: [], offset: 0, hasMore: false },
    artifactPreview: null,
    effectInspection: null,
    sources: { items: [], truncated: false },
  },
  "session.unavailable": {
    library: { items: [], offset: 0, hasMore: false, housekeeping: false },
    materialPreview: null,
    messages: [],
    streamText: "",
    materials: [],
    reportTarget: null,
    permissions: { writes: false, checks: false },
    webAccess: EMPTY_WEB_ACCESS,
    sources: { items: [], truncated: false },
    effects: { items: [], offset: 0, hasMore: false },
    effectInspection: null,
    artifacts: { items: [], offset: 0, hasMore: false },
    artifactPreview: null,
    pendingApproval: null,
    outcome: null,
  },
  "session.opening": {
    messages: [],
    streamText: "",
    historyTruncated: false,
    pendingApproval: null,
    outcome: null,
    materials: [],
    reportTarget: null,
    permissions: { writes: false, checks: false },
    webAccess: EMPTY_WEB_ACCESS,
    sources: { items: [], truncated: false },
    library: { items: [], offset: 0, hasMore: false, housekeeping: false },
    materialPreview: null,
    effects: { items: [], offset: 0, hasMore: false },
    effectInspection: null,
    artifacts: { items: [], offset: 0, hasMore: false },
    artifactPreview: null,
  },
  "conversation.starting": { history: null, messageDetail: null },
  "web.revoking": { pendingApproval: null },
  "settings.reconfiguring": {
    reportTarget: null,
    permissions: { writes: false, checks: false },
    pendingApproval: null,
    artifactPreview: null,
    effectInspection: null,
  },
  "settings.revoking": { webAccess: EMPTY_WEB_ACCESS },
  "permissions.reconfiguring": {
    reportTarget: null,
    pendingApproval: null,
    effectInspection: null,
  },
} satisfies Record<string, Partial<DesktopState>>;
export type HostTransition = keyof typeof transitions;
export function transitionPatch(name: HostTransition): Partial<DesktopState> {
  return structuredClone(transitions[name]);
}
