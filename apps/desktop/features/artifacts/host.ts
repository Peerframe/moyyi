import { BoundaryError, defineHostFeature } from "../../host/feature.ts";
import { inspectReport, reportTarget } from "../../host/reports.ts";
import { commandTypes, stateKeys } from "./contract.ts";

export const hostFeature = defineHostFeature({
  id: "artifacts",
  stateKeys,
  commands: commandTypes,
  async handle(host, command) {
    if (command.type === "report.target" || command.type === "report.clear") {
      const workspace = host.selected(command.sessionId);
      if (command.type === "report.target" && command.path === null) return;
      const target =
        command.type === "report.clear"
          ? null
          : reportTarget(workspace, command.path as string, host.excluded());
      await host.changeReport(target);
      return;
    }
    if (command.type === "artifacts") {
      host.selected(command.sessionId);
      await host.refreshArtifacts(command.offset, "artifacts");
      return;
    }
    if (command.type === "artifact.close") {
      host.update({ artifactPreview: null });
      return;
    }
    if (command.type === "artifact.open") {
      const workspace = host.selected(command.sessionId);
      const artifact = host.state.artifacts.items.find(
        (item) => item.effectId === command.effectId,
      );
      host.update({ artifactPreview: null });
      if (!artifact) throw new BoundaryError("Select a recorded report first");
      const checked = inspectReport(workspace, artifact, host.excluded());
      host.update({
        artifacts: {
          ...host.state.artifacts,
          items: host.state.artifacts.items.map((item) =>
            item.effectId === artifact.effectId ? { ...item, state: checked.state } : item,
          ),
        },
        artifactPreview: checked.preview ?? null,
      });
      if (checked.state !== "current")
        throw new BoundaryError(`Report is ${checked.state}; the recorded version was not opened`);
      return;
    }
  },
  events: ["session.results", "run.started"],
  event(host, event) {
    switch (event.type) {
      case "session.results":
        if (
          event.page.sessionId !== host.state.activeSessionId ||
          event.page.workspaceRoot !== host.state.workspaceRoot
        )
          return;
        if (host.resultsDestination !== "effects")
          host.update({
            artifacts: {
              offset: event.page.offset,
              hasMore: event.page.hasMore,
              items: event.page.effects.flatMap((effect) =>
                effect.tool === "create" &&
                effect.state === "succeeded" &&
                effect.receipt?.kind === "file" &&
                effect.receipt.beforeHash === null &&
                effect.receipt.afterHash !== null
                  ? [
                      {
                        effectId: effect.effectId,
                        path: effect.receipt.path,
                        afterHash: effect.receipt.afterHash,
                        state: "unchecked" as const,
                      },
                    ]
                  : [],
              ),
            },
            artifactPreview: null,
          });
        break;
      case "run.started":
        if (event.sessionId !== host.eventState.activeSessionId) return;
        host.update({ artifactPreview: null });
        break;
    }
  },
});
