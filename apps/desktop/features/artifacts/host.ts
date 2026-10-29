import { defineHostFeature } from "../../host/feature.ts";
import { commandTypes, stateKeys } from "./contract.ts";
import { Buffer } from "node:buffer";
import { realpath, stat } from "node:fs/promises";
import type {
  ActionDigest,
  ClientCommand,
  EffectId,
  RunId,
  RuntimeEvent,
  SessionId,
  SessionQuery,
  TranscriptEntry,
} from "moyyi/contracts";
import {
  createRuntime,
  discoverNodeToolchain,
  type Runtime,
  type RuntimeOptions,
  WebPolicy,
} from "moyyi/runtime";
import {
  DEFAULT_DESKTOP_SETTINGS,
  type DesktopApproval,
  type DesktopCommand,
  type DesktopMessage,
  type DesktopPermissions,
  type DesktopSessionSummary,
  type DesktopSettings,
  type DesktopState,
  type DesktopWebAccess,
} from "../../shared.ts";
import { inspectEffectFile } from "../../host/effects.ts";
import { imagePreview } from "../../host/image-preview.ts";
import { ManagedMaterials } from "../../host/managed-materials.ts";
import { FileBoundaryError, inspectMaterials } from "../../host/materials.ts";
import { DesktopPolicy } from "../../host/permissions.ts";
import { inspectReport, reportTarget } from "../../host/reports.ts";
import { parseDesktopCommand } from "../../host/validation.ts";
import {
  appendWebSource,
  EMPTY_WEB_ACCESS,
  normalizeDesktopWebAccess,
  projectWebSource,
} from "../../host/web.ts";

import type { HostContext, HostFeature } from "../../host/feature.ts";
import { BoundaryError, clip, MESSAGE_BYTES } from "../../host/feature.ts";

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
        if (host.resultsDestination !== "effects") host.update({
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
