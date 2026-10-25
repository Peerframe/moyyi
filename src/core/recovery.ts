import {
  canonicalizeJson,
  type EffectRecord,
  type EntryId,
  isTerminal,
  type RunLimits,
  type SessionSnapshot,
  type ToolContext,
  type ToolResultPart,
  type TranscriptEntry,
} from "../contracts/index.ts";
import type { CoreDeps } from "./index.ts";

/** Reconciliation only: never calls prepare/execute or resends a model request. */
export async function recoverSession(
  snapshot: SessionSnapshot,
  deps: CoreDeps,
  limits: RunLimits,
): Promise<void> {
  const affected = new Set(
    snapshot.runs.filter((run) => run.status !== "completed").map((run) => run.runId),
  );
  if (!affected.size) return;
  const updates = snapshot.effects
    .filter(
      (effect) =>
        affected.has(effect.runId) && !isTerminal(effect.state) && effect.state !== "unknown",
    )
    .map(
      (effect): EffectRecord => ({
        ...effect,
        state: effect.state === "started" ? "unknown" : "cancelled",
        updatedAt: deps.clock.now(),
        evidence:
          effect.state === "started"
            ? "Process interrupted after durable start; outcome unknown"
            : "Process interrupted before execution",
      }),
    );
  await deps.store.commit({
    entries: [],
    effects: updates,
    durability: "normal",
    runs: snapshot.runs
      .filter((run) => run.status === "active")
      .map((run) => ({ ...run, status: "interrupted" })),
  });
  for (const effect of updates) deps.emit({ type: "effect.updated", effect });
  let current = await deps.store.loadSession(snapshot.sessionId);
  if (!current) throw new Error("Session disappeared during recovery");
  let reconciliationHead = current.headEntryId;
  for (const effect of current.effects) {
    if (effect.state !== "unknown") continue;
    const tool = deps.tools.find((tool) => tool.name === effect.tool);
    if (!tool?.reconcile || canonicalizeJson(tool.effect) !== canonicalizeJson(effect.profile))
      continue;
    // No approval or permission is invented during recovery. A restricted tool stays unknown.
    if (deps.policy.beforePrepare(tool.name, tool.effect, { recovery: effect.id }).kind !== "allow")
      continue;
    const controller = new AbortController();
    const stop = deps.scheduler.deadline(limits.timeoutMs, () => controller.abort());
    const revision = deps.policy.revision?.() ?? 0;
    let live = true;
    const guard = () => {
      if (
        !live ||
        controller.signal.aborted ||
        revision !== (deps.policy.revision?.() ?? 0) ||
        deps.policy.beforePrepare(tool.name, tool.effect, { recovery: effect.id }).kind !== "allow"
      )
        throw Error("Recovery inspection permission expired");
    };
    try {
      const context: ToolContext = {
        runId: effect.runId,
        workspaceRoot: current.workspaceRoot,
        signal: controller.signal,
        limits: { maxOutputBytes: limits.maxToolOutputBytes },
      };
      const result = await tool.reconcile(effect, {
        ...context,
        ...(deps.writes && effect.profile.class === "workspace_write"
          ? { writes: deps.writes.create(context, guard, { phase: "prepare", effect }) }
          : {}),
      });
      guard();
      if (
        controller.signal.aborted ||
        !result.resolved ||
        !["succeeded", "failed"].includes(result.status)
      )
        continue;
      const settled = {
        ...effect,
        state: result.status,
        updatedAt: deps.clock.now(),
        evidence: result.evidence.slice(0, 4096).toWellFormed(),
      };
      const notice: TranscriptEntry = {
        id: deps.ids.next("entry") as EntryId,
        sessionId: current.sessionId,
        runId: effect.runId,
        parentId: reconciliationHead,
        createdAt: deps.clock.now(),
        body: {
          kind: "notice",
          code: "effect_reconciled",
          text: `Previously unknown call ${effect.callId} is now ${settled.state}: ${settled.evidence}`,
        },
      };
      await deps.store.commit({
        entries: [notice],
        effects: [settled],
        durability: "normal",
        sessions: [
          {
            sessionId: current.sessionId,
            workspaceRoot: current.workspaceRoot,
            headEntryId: notice.id,
          },
        ],
      });
      reconciliationHead = notice.id;
      deps.emit({ type: "effect.updated", effect: settled });
      deps.emit({ type: "entry.appended", entry: notice });
    } catch {
      /* Failed inspection leaves the outcome unknown; never invoke the action. */
    } finally {
      live = false;
      stop();
    }
  }
  current = await deps.store.loadSession(snapshot.sessionId);
  if (!current) throw new Error("Session disappeared during recovery");
  let head = current.headEntryId;
  for (const runId of affected) {
    const effects = current.effects.filter((effect) => effect.runId === runId);
    const byCall = new Map(effects.map((effect) => [effect.callId, effect]));
    const paired = new Set(
      current.entries.flatMap((entry) =>
        entry.runId === runId && entry.body.kind === "tool_results"
          ? entry.body.results.map((result) => result.callId)
          : [],
      ),
    );
    const results: ToolResultPart[] = [];
    for (const entry of current.entries) {
      if (entry.runId !== runId || entry.body.kind !== "assistant_message") continue;
      for (const part of entry.body.content) {
        if (part.type !== "tool_call" || paired.has(part.callId)) continue;
        const effect = byCall.get(part.callId);
        const state = effect?.state;
        const status =
          state === "succeeded" || state === "failed" || state === "denied" || state === "unknown"
            ? state
            : "cancelled";
        results.push({
          type: "tool_result",
          callId: part.callId,
          status,
          content: [
            {
              type: "text",
              text: `Recovered ${status}. ${effect?.evidence ?? "Execution did not start."} Original tool output was not recorded; no automatic replay.`
                .slice(0, 4096)
                .toWellFormed(),
            },
          ],
        });
      }
    }
    const entries: TranscriptEntry[] = [];
    const add = (body: TranscriptEntry["body"]) => {
      const entry: TranscriptEntry = {
        id: deps.ids.next("entry") as EntryId,
        sessionId: current.sessionId,
        runId,
        parentId: head,
        createdAt: deps.clock.now(),
        body,
      };
      head = entry.id;
      entries.push(entry);
    };
    if (results.length) add({ kind: "tool_results", results });
    const wasActive = snapshot.runs.some((run) => run.runId === runId && run.status === "active");
    if (wasActive || results.length || updates.some((effect) => effect.runId === runId)) {
      add({
        kind: "notice",
        code: "run_recovered",
        text: `Run ${runId} was interrupted. Unknown actions require verification and are never automatically replayed.`,
      });
    }
    const retain = effects.some(
      (effect) =>
        !isTerminal(effect.state) && ["workspace_write", "process"].includes(effect.profile.class),
    );
    const release = current.leases
      .filter((lease) => lease.runId === runId && !retain)
      .map((lease) => ({ ...lease, kind: "release" as const }));
    await deps.store.commit({
      entries,
      effects: [],
      leases: release,
      durability: "normal",
      sessions: entries.length
        ? [
            {
              sessionId: current.sessionId,
              workspaceRoot: current.workspaceRoot,
              headEntryId: head,
            },
          ]
        : [],
    });
    for (const entry of entries) deps.emit({ type: "entry.appended", entry });
  }
}
