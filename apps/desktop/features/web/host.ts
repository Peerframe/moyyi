import { BoundaryError, defineHostFeature } from "../../host/feature.ts";
import {
  appendWebSource,
  EMPTY_WEB_ACCESS,
  normalizeDesktopWebAccess,
  projectWebSource,
} from "../../host/web.ts";
import { commandTypes, stateKeys } from "./contract.ts";

export const hostFeature = defineHostFeature({
  id: "web",
  stateKeys,
  commands: commandTypes,
  async handle(host, command) {
    if (command.type === "web.permissions") {
      host.selected(command.sessionId);
      const access = normalizeDesktopWebAccess({
        allowedOrigins: command.allowedOrigins,
        dns: command.dns,
      });
      const target = host.state.reportTarget;
      const permissions = host.state.permissions;
      host.transition("web.revoking", { webAccess: EMPTY_WEB_ACCESS });
      try {
        await host.open(host.state.askEachRead, target, permissions, access);
        await host.reloadSelected();
      } catch {
        host.update({ webAccess: EMPTY_WEB_ACCESS });
        if (host.state.status === "ready") {
          await host.open(host.state.askEachRead, target, permissions);
          await host.reloadSelected();
        }
        throw new BoundaryError(
          "Web access could not be changed; no network permission was retained",
        );
      }
      return;
    }
  },
  events: ["entry.appended"],
  event(host, event) {
    if (event.type !== "entry.appended") return;
    const entry = event.entry,
      body = entry.body;
    if (body.kind === "tool_results") {
      for (const result of body.results) {
        const source = projectWebSource(
          entry.id,
          entry.createdAt,
          result,
          host.toolNames.get(result.callId),
        );
        if (source) host.update({ sources: appendWebSource(host.state.sources, source) });
        else if (host.toolNames.get(result.callId) === "web_fetch" && result.status === "succeeded")
          host.update({ sources: { ...host.state.sources, truncated: true } });
      }
    }
  },
});
