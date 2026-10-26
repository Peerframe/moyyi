import {
  effectTransitions,
  executionReceipt,
  type HistoryPage,
  type SessionId,
  type SessionListPage,
  type SessionResultsPage,
  type SessionStore,
  type ToolResultPart,
} from "../contracts/index.ts";

export function historyPage(offset?: number, limit?: number): HistoryPage | null {
  const page = {
    offset: offset === undefined ? 0 : offset,
    limit: limit === undefined ? 20 : limit,
  };
  return Number.isSafeInteger(page.offset) &&
    page.offset >= 0 &&
    page.offset <= 10_000 &&
    Number.isSafeInteger(page.limit) &&
    page.limit >= 1 &&
    page.limit <= 50
    ? page
    : null;
}

/** Custom stores implement the same bounded view; never forward extra store payload fields. */
export async function sessionCatalog(
  store: SessionStore,
  page: HistoryPage,
): Promise<SessionListPage> {
  if (!store.listSessionSummaries) throw Error("Session catalog unavailable");
  const result = await store.listSessionSummaries(page);
  if (
    result.offset !== page.offset ||
    result.limit !== page.limit ||
    typeof result.hasMore !== "boolean" ||
    !Array.isArray(result.sessions) ||
    result.sessions.length > page.limit
  )
    throw Error("Invalid catalog page");
  const sessions = result.sessions.map((row) => {
    if (
      typeof row.sessionId !== "string" ||
      !row.sessionId ||
      row.sessionId.length > 512 ||
      typeof row.workspaceRoot !== "string" ||
      row.workspaceRoot.length > 4096 ||
      (row.lastActivityAt !== null &&
        (typeof row.lastActivityAt !== "string" || row.lastActivityAt.length > 128)) ||
      (row.promptPreview !== null &&
        (typeof row.promptPreview !== "string" || row.promptPreview.length > 160))
    )
      throw Error("Invalid catalog record");
    return {
      sessionId: row.sessionId,
      workspaceRoot: row.workspaceRoot,
      lastActivityAt: row.lastActivityAt,
      promptPreview: row.promptPreview,
    };
  });
  return { ...page, sessions, hasMore: result.hasMore };
}

/** Bounded response using the existing full-session read; no full-history I/O efficiency claim. */
export async function sessionResults(
  store: SessionStore,
  sessionId: SessionId,
  page: HistoryPage,
): Promise<SessionResultsPage | null> {
  const snapshot = await store.loadSession(sessionId);
  if (!snapshot) return null;
  if (snapshot.sessionId !== sessionId) throw Error("Session identity mismatch");
  if (typeof snapshot.workspaceRoot !== "string" || snapshot.workspaceRoot.length > 4096)
    throw Error("Invalid session workspace");
  const runs = new Set(
    snapshot.runs.filter((run) => run.sessionId === sessionId).map((run) => run.runId),
  );
  const results = new Map<string, Map<string, ToolResultPart[]>>();
  for (const entry of snapshot.entries) {
    if (
      entry.sessionId !== sessionId ||
      entry.runId === null ||
      !runs.has(entry.runId) ||
      entry.body.kind !== "tool_results"
    )
      continue;
    let byCall = results.get(entry.runId);
    if (!byCall) {
      byCall = new Map();
      results.set(entry.runId, byCall);
    }
    for (const result of entry.body.results) {
      if (result.type !== "tool_result") continue;
      const matches = byCall.get(result.callId) ?? [];
      matches.push(result);
      byCall.set(result.callId, matches);
    }
  }
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const sorted = snapshot.effects
    .filter((effect) => runs.has(effect.runId))
    .sort((a, b) => compare(b.updatedAt, a.updatedAt) || compare(a.id, b.id));
  const effects = sorted.slice(page.offset, page.offset + page.limit).map((effect) => {
    for (const value of [effect.id, effect.runId, effect.tool])
      if (typeof value !== "string" || !value || value.length > 512)
        throw Error("Invalid historical effect identity");
    if (
      typeof effect.updatedAt !== "string" ||
      effect.updatedAt.length > 128 ||
      !Object.hasOwn(effectTransitions, effect.state)
    )
      throw Error("Invalid historical effect state");
    const matches = results.get(effect.runId)?.get(effect.callId);
    return {
      effectId: effect.id,
      runId: effect.runId,
      tool: effect.tool,
      state: effect.state,
      updatedAt: effect.updatedAt,
      receipt:
        matches?.length === 1 ? executionReceipt(effect, matches[0] as ToolResultPart) : null,
    };
  });
  return {
    ...page,
    sessionId,
    workspaceRoot: snapshot.workspaceRoot,
    effects,
    hasMore: sorted.length > page.offset + page.limit,
  };
}
