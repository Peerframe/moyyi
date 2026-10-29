import type { ActionDigest, EffectId } from "moyyi/contracts";
import { inspectEffectFile } from "../../host/effects.ts";
import { BoundaryError, clip, defineHostFeature } from "../../host/feature.ts";
import { commandTypes, stateKeys } from "./contract.ts";

export const hostFeature = defineHostFeature({
  id: "effects",
  stateKeys,
  commands: commandTypes,
  async handle(host, command) {
    if (command.type === "effects") {
      host.selected(command.sessionId);
      await host.refreshArtifacts(command.offset, "effects");
      return;
    }
    if (command.type === "effect.inspect") {
      const workspace = host.selected(command.sessionId);
      host.update({ effectInspection: null });
      const effect = host.state.effects.items.find((item) => item.effectId === command.effectId);
      if (!effect) throw new BoundaryError("Select a recorded operation first");
      host.update({ effectInspection: inspectEffectFile(workspace, effect, host.excluded()) });
      return;
    }
    if (command.type !== "approve") throw new BoundaryError("Unknown desktop action");
    const pending = host.state.pendingApproval;
    if (
      host.state.run?.state !== "running" ||
      pending?.effectId !== command.effectId ||
      pending.digest !== command.digest ||
      host.replying.has(command.effectId)
    )
      throw new BoundaryError("Approval is unknown, stale or already being handled");
    host.replying.add(command.effectId);
    try {
      await host.send({
        type: "approval.respond",
        effectId: command.effectId as EffectId,
        digest: command.digest as ActionDigest,
        decision: command.decision,
      });
      if (host.approvals.get(command.effectId)?.digest === command.digest)
        host.approvals.delete(command.effectId);
      host.update({ pendingApproval: host.approvals.values().next().value ?? null });
    } finally {
      host.replying.delete(command.effectId);
    }
  },
  events: [
    "effect.updated",
    "approval.requested",
    "session.results",
    "run.started",
    "run.finished",
  ],
  event(host, event) {
    switch (event.type) {
      case "effect.updated":
        if (event.effect.runId !== host.eventState.run?.id) return;
        host.effectRuns.set(event.effect.id, event.effect.runId);
        if (host.state.effects.offset === 0) {
          const previous = host.state.effects.items;
          const projected = {
            effectId: event.effect.id,
            runId: event.effect.runId,
            tool: event.effect.tool,
            state: event.effect.state,
            updatedAt: event.effect.updatedAt,
            receipt: null,
          };
          const items = [
            projected,
            ...previous.filter((item) => item.effectId !== projected.effectId),
          ];
          host.update({
            effects: {
              offset: 0,
              hasMore: host.state.effects.hasMore || items.length > 20,
              items: items.slice(0, 20),
            },
          });
        }
        if (event.effect.state !== "awaiting_approval") {
          host.approvals.delete(event.effect.id);
          host.update({ pendingApproval: host.approvals.values().next().value ?? null });
        }
        break;
      case "approval.requested":
        if (!host.state.run || host.effectRuns.get(event.effectId) !== host.state.run.id) return;
        host.approvals.set(event.effectId, {
          effectId: event.effectId,
          digest: event.digest,
          summary: clip(event.summary),
          ...(event.preview === undefined ? {} : { preview: event.preview }),
        });
        host.update({ pendingApproval: host.approvals.values().next().value ?? null });
        break;
      case "session.results":
        if (
          event.page.sessionId !== host.state.activeSessionId ||
          event.page.workspaceRoot !== host.state.workspaceRoot
        )
          return;
        if (host.resultsDestination !== "artifacts")
          host.update({
            effects: {
              offset: event.page.offset,
              hasMore: event.page.hasMore,
              items: event.page.effects,
            },
            effectInspection: null,
          });
        break;
      case "run.started":
        if (event.sessionId !== host.eventState.activeSessionId) return;
        host.update({ effectInspection: null });
        break;
      case "run.finished":
        if (event.runId !== host.eventState.run?.id) return;
        host.approvals.clear();
        host.effectRuns.clear();
        host.update({ pendingApproval: null });
        break;
    }
  },
});
