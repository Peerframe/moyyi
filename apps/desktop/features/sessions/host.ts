import { realpath, stat } from "node:fs/promises";
import type { SessionId, SessionQuery } from "moyyi/contracts";
import { BoundaryError, defineHostFeature } from "../../host/feature.ts";
import type { DesktopSessionSummary } from "../../shared.ts";
import { commandTypes, stateKeys } from "./contract.ts";

export const hostFeature = defineHostFeature({
  id: "sessions",
  stateKeys,
  commands: commandTypes,
  async catalog(host, query: SessionQuery = {}): Promise<void> {
    if (!host.runtime) throw new BoundaryError("Session store is unavailable");
    const page = await host.runtime.sessions.list(query);
    host.knownSessions.clear();
    for (const item of page.items) host.knownSessions.set(item.sessionId, item);
    host.update({
      sessions: { items: page.items, offset: 0, hasMore: page.nextCursor !== null },
      catalog: { query, nextCursor: page.nextCursor },
    });
  },
  async handle(host, command) {
    if (command.type === "catalog") {
      await host.catalog(command.query);
      return;
    }
    if (command.type === "session.update") {
      if (!host.runtime || !host.knownSessions.has(command.update.sessionId))
        throw new BoundaryError("Select a listed session first");
      const changed = await host.runtime.sessions.update({
        ...command.update,
        sessionId: command.update.sessionId as SessionId,
      });
      if (changed.sessionId === host.state.activeSessionId)
        host.update({ activeMetadata: changed.metadata });
      if (changed.sessionId === host.state.activeSessionId && changed.metadata.removedAt) {
        await host.open(host.state.askEachRead);
        host.transition("session.removed", {
          activeSessionId: null,
          activeMetadata: null,
          workspaceRoot: null,
          history: null,
          messageDetail: null,
          historyOnly: false,
        });
      }
      const { cursor: _cursor, ...query } = host.state.catalog?.query ?? {};
      await host.catalog(query);
      return;
    }
    if (command.type === "history.close") {
      host.update({ history: null, messageDetail: null });
      return;
    }
    if (command.type === "history" || command.type === "history.message") {
      host.selected(command.sessionId);
      if (!host.runtime) throw new BoundaryError("Session history is unavailable");
      if (command.type === "history")
        host.update({
          history: await host.runtime.sessions.history({
            sessionId: command.sessionId as SessionId,
            ...(command.cursor ? { cursor: command.cursor } : {}),
            limit: 20,
          }),
          messageDetail: null,
        });
      else {
        host.update({ messageDetail: null });
        const chunk = await host.runtime.sessions.readMessage({
          sessionId: command.sessionId as SessionId,
          messageId: command.messageId,
          offset: command.offset,
        });
        host.update({
          messageDetail: { ...chunk, messageId: command.messageId, offset: command.offset },
        });
      }
      return;
    }
    if (command.type === "create" || command.type === "load") {
      const record =
        command.type === "load" ? host.knownSessions.get(command.sessionId) : undefined;
      if (command.type === "load" && record?.metadata?.removedAt && host.runtime) {
        await host.open(command.askEachRead);
        host.transition("session.recycled", {
          activeSessionId: command.sessionId,
          activeMetadata: record?.metadata ?? null,
          workspaceRoot: record.workspaceRoot,
          historyOnly: true,
          history: await host.runtime.sessions.history({
            sessionId: command.sessionId as SessionId,
          }),
          messageDetail: null,
          openedHistory: true,
        });
        return;
      }
      if (command.type === "load" && !record)
        throw new BoundaryError("Select a listed session first");
      const selected =
        command.type === "create"
          ? command.workspaceRoot
          : (record as DesktopSessionSummary).workspaceRoot;
      let workspace: string;
      try {
        workspace = await realpath(selected);
        if (!(await stat(workspace)).isDirectory()) throw Error();
        if (command.type === "load" && workspace !== selected) throw Error();
      } catch {
        if (command.type !== "load" || !host.runtime)
          throw new BoundaryError("The selected workspace is missing or has changed");
        await host.open(command.askEachRead);
        const history = await host.runtime.sessions.history({
          sessionId: command.sessionId as SessionId,
          limit: 20,
        });
        host.transition("session.unavailable", {
          activeSessionId: command.sessionId,
          activeMetadata: record?.metadata ?? null,
          workspaceRoot: selected,
          historyOnly: true,
          history,
          messageDetail: null,
          openedHistory: true,
        });
        return;
      }
      if (host.state.status !== "ready") throw new BoundaryError("Desktop host is closing");
      if (
        !host.runtime ||
        command.askEachRead !== host.state.askEachRead ||
        host.state.reportTarget !== null ||
        host.state.permissions.writes ||
        host.state.permissions.checks ||
        host.state.webAccess.allowedOrigins.length > 0 ||
        host.state.webAccess.dns !== "system"
      )
        await host.open(command.askEachRead);
      host.approvals.clear();
      host.effectRuns.clear();
      host.toolNames.clear();
      host.entryIds.clear();
      host.pendingWorkspace = workspace;
      host.expectedSession = command.type === "load" ? command.sessionId : undefined;
      host.transition("session.opening", {
        history: null,
        messageDetail: null,
        historyOnly: false,
        openedHistory: command.type === "load",
      });
      try {
        await host.send(
          command.type === "create"
            ? { type: "session.create", workspaceRoot: workspace }
            : { type: "session.load", sessionId: command.sessionId as SessionId },
        );
      } finally {
        host.pendingWorkspace = undefined;
        host.expectedSession = undefined;
      }
      await host.refreshArtifacts(0);
      if (command.type === "load" && host.state.catalog) {
        const { cursor: _cursor, ...query } = host.state.catalog.query;
        await host.catalog(query);
      }
      await host.refreshMaterials();
      return;
    }
    if (command.type === "list") {
      await host.send({ type: "session.list", offset: command.offset, limit: 20 });
      return;
    }
  },
  events: ["session.ready", "session.listed", "entry.appended"],
  event(host, event) {
    switch (event.type) {
      case "session.ready": {
        if (
          !host.pendingWorkspace ||
          (host.expectedSession && event.sessionId !== host.expectedSession)
        )
          return;
        const listed = host.knownSessions.get(event.sessionId);
        // Filtering the catalog must not reset the selected session when grants rebuild its runtime.
        const metadata = listed?.metadata ??
          (event.sessionId === host.state.activeSessionId ? host.state.activeMetadata : null) ?? {
            title: null,
            group: null,
            pinned: false,
            muted: false,
            removedAt: null,
            revision: 0,
          };
        const summary = listed
          ? { ...listed, metadata }
          : {
              sessionId: event.sessionId,
              workspaceRoot: host.pendingWorkspace,
              lastActivityAt: null,
              promptPreview: null,
              metadata,
            };
        host.knownSessions.set(event.sessionId, summary);
        let sessions = host.state.sessions;
        if (!host.expectedSession && sessions.offset === 0) {
          const items = [
            summary,
            ...sessions.items.filter((item) => item.sessionId !== event.sessionId),
          ];
          sessions = {
            ...sessions,
            items: items.slice(0, 20),
            hasMore: sessions.hasMore || items.length > 20,
          };
        }
        host.update({
          activeSessionId: event.sessionId,
          activeMetadata: summary.metadata ?? null,
          workspaceRoot: host.pendingWorkspace,
          sessions,
        });
        break;
      }
      case "session.listed":
        for (const session of event.page.sessions)
          host.knownSessions.set(session.sessionId, session);
        host.update({
          sessions: {
            items: event.page.sessions,
            offset: event.page.offset,
            hasMore: event.page.hasMore,
          },
        });
        break;
      case "entry.appended": {
        const entry = event.entry,
          body = entry.body;
        const summary = host.knownSessions.get(entry.sessionId);
        // Loading replays historical entries; keep the catalog's current summary during replay.
        if (summary && !host.expectedSession) {
          let preview = summary.promptPreview;
          if (body.kind === "user_message") {
            preview = body.content.find((part) => part.type === "text")?.text.slice(0, 160) ?? null;
            if (preview && /[\uD800-\uDBFF]$/u.test(preview)) preview = preview.slice(0, -1);
          }
          const next = { ...summary, promptPreview: preview, lastActivityAt: entry.createdAt };
          host.knownSessions.set(entry.sessionId, next);
          host.update({
            sessions: {
              ...host.state.sessions,
              items: host.state.sessions.items.map((item) =>
                item.sessionId === entry.sessionId ? next : item,
              ),
            },
          });
        }
        break;
      }
    }
  },
});
