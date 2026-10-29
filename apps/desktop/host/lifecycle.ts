import type { SessionId } from "moyyi/contracts";
import { createRuntime, discoverNodeToolchain, WebPolicy } from "moyyi/runtime";
import type { DesktopPermissions, DesktopWebAccess } from "../shared.ts";
import { BoundaryError, type HostContext } from "./feature.ts";
import { DesktopPolicy } from "./permissions.ts";
import { EMPTY_WEB_ACCESS, normalizeDesktopWebAccess } from "./web.ts";

export async function openRuntime(
  host: HostContext,
  askEachRead: boolean,
  target: string | null = null,
  permissions: DesktopPermissions = { writes: false, checks: false },
  webAccess: DesktopWebAccess = EMPTY_WEB_ACCESS,
): Promise<void> {
  const access = normalizeDesktopWebAccess(webAccess);
  host.update({ webAccess: EMPTY_WEB_ACCESS });
  if (host.runtime) {
    await host.runtime.close();
    host.unsubscribe?.();
    host.runtime = undefined;
  }
  if (host.state.status !== "ready") throw Error("Desktop host is closing");
  // Connection composition never supplies effect grants; only explicit desktop actions can.
  const {
    policy: _policy,
    workspaceWrites: _writes,
    workspaceProcesses: _processes,
    web: _web,
    developmentPlugins: _development,
    ...base
  } = host.options;
  const runtime = await createRuntime({
    ...base,
    ...((target || permissions.writes) && host.state.workspaceRoot
      ? { workspaceWrites: { roots: [host.state.workspaceRoot], approval: "ask" as const } }
      : {}),
    ...(permissions.checks && host.state.workspaceRoot
      ? {
          workspaceProcesses: {
            roots: [host.state.workspaceRoot],
            approval: "ask" as const,
            workspaceAccess: "read-only" as const,
            ...(await discoverNodeToolchain()),
          },
        }
      : {}),
    ...(access.allowedOrigins.length ? { web: { ...access, approval: "ask" as const } } : {}),
    policy: access.allowedOrigins.length
      ? new WebPolicy({
          previous: new DesktopPolicy(permissions, askEachRead, target),
          fetch: true,
          approval: "ask",
        })
      : new DesktopPolicy(permissions, askEachRead, target),
  });
  if (host.state.status !== "ready") {
    await runtime.close();
    throw Error("Desktop host is closing");
  }
  host.runtime = runtime;
  host.unsubscribe = runtime.subscribe((event) => host.event(event));
  host.pluginWarning = runtime.plugins.some((plugin) => plugin.state === "failed")
    ? "A runtime plugin is unavailable; some capabilities may not work"
    : null;
  host.update({
    askEachRead,
    reportTarget: target,
    permissions,
    webAccess: access,
    error: host.pluginWarning,
  });
}

export async function reloadSelected(host: HostContext): Promise<void> {
  const sessionId = host.state.activeSessionId,
    workspace = host.state.workspaceRoot;
  if (!sessionId || !workspace) {
    await host.send({ type: "session.list", offset: 0, limit: 20 });
    return;
  }
  host.entryIds.clear();
  host.toolNames.clear();
  host.pendingWorkspace = workspace;
  host.expectedSession = sessionId;
  host.update({
    messages: [],
    sources: { items: [], truncated: false },
    streamText: "",
    historyTruncated: false,
    artifactPreview: null,
    effectInspection: null,
    pendingApproval: null,
  });
  try {
    await host.send({ type: "session.load", sessionId: sessionId as SessionId });
  } finally {
    host.pendingWorkspace = undefined;
    host.expectedSession = undefined;
  }
  await host.refreshArtifacts(0);
}

export async function changeReport(host: HostContext, target: string | null): Promise<void> {
  try {
    await host.open(
      host.state.askEachRead,
      target,
      { writes: false, checks: false },
      host.state.webAccess,
    );
    await host.reloadSelected();
  } catch {
    host.update({ reportTarget: null });
    if (host.state.status === "ready") {
      await host.open(host.state.askEachRead);
      await host.reloadSelected();
    }
    throw new BoundaryError(
      "Report permission could not be changed; no report permission was retained",
    );
  }
}
