import { BoundaryError, defineHostFeature } from "../../host/feature.ts";
import { commandTypes, stateKeys } from "./contract.ts";

export const hostFeature = defineHostFeature({
  id: "settings",
  stateKeys,
  commands: commandTypes,
  events: ["run.finished", "run.started", "session.ready"],
  event(host, event) {
    if (
      event.type === "run.finished" &&
      event.runId === host.eventState.run?.id &&
      event.outcome.kind === "failed" &&
      ["quota", "rate_limited", "auth"].includes(event.outcome.modelErrorKind ?? "")
    ) {
      host.update({
        connectionFailure: {
          name:
            host.state.connections.find((c) => c.id === host.state.activeConnectionId)?.name ??
            host.state.settings.preset,
          kind: event.outcome.modelErrorKind as "quota" | "rate_limited" | "auth",
        },
      });
    } else if (event.type === "run.started" || event.type === "session.ready")
      host.update({ connectionFailure: null });
  },
  async handle(host, command) {
    if (command.type === "configure" || command.type === "connection.change") {
      if (command.type === "configure" ? !host.configure : !host.changeConnection)
        throw new BoundaryError("Desktop settings cannot be changed by this host");
      const previous = host.options;
      const previousId = host.state.activeConnectionId;
      const previousNamed = host.state.connections.find((c) => c.id === previousId);
      const previousSettings = host.state.settings,
        previousConnection = host.state.connection;
      await host.runtime?.close();
      host.unsubscribe?.();
      host.runtime = undefined;
      host.transition("settings.reconfiguring", {});
      host.transition("settings.revoking", {});
      let saved = false;
      let warning: string | undefined;
      try {
        const configured =
          command.type === "configure"
            ? await host.configure!(command.settings, command.apiKey)
            : await host.changeConnection!(command.change);
        saved = true;
        host.update({ settings: configured.settings });
        if (
          !configured.runtimeOptions.dataDirectory ||
          configured.runtimeOptions.dataDirectory !== previous.dataDirectory ||
          configured.runtimeOptions.store
        )
          throw Error("Configuration changed store ownership");
        host.options = configured.runtimeOptions;
        host.update({
          settings: configured.settings,
          ...(configured.connections
            ? {
                connections: configured.connections,
                activeConnectionId: configured.activeConnectionId!,
                searchConnectionId: configured.searchConnectionId ?? null,
              }
            : {}),
          connectionFailure: null,
          connection: configured.connection,
          model: host.options.model ? { ...host.options.model } : null,
          budgets: {
            maxRequests: host.options.limits?.maxModelRequests ?? null,
            timeoutMs: host.options.limits?.timeoutMs ?? null,
            maxOutputTokens: host.state.budgets.maxOutputTokens,
          },
        });
        await host.open(host.state.askEachRead);
        await host.reloadSelected();
        const nextNamed = host.state.connections.find(
          (c) => c.id === host.state.activeConnectionId,
        );
        if (
          previousNamed &&
          nextNamed &&
          previousId !== nextNamed.id &&
          host.state.activeSessionId
        ) {
          await host.runtime!.appendConnectionSwitched(host.state.activeSessionId, {
            from: previousNamed,
            to: nextNamed,
          });
        }
        warning = configured.warning;
      } catch {
        if (saved) {
          host.update({
            connection: {
              ready: false,
              message: "Settings were saved, but the runtime must be reopened",
            },
          });
          throw new BoundaryError(
            "Settings were saved, but the runtime could not reopen; existing conversations were retained",
          );
        }
        host.options = previous;
        host.update({
          settings: previousSettings,
          connection: previousConnection,
          model: previous.model ? { ...previous.model } : null,
          budgets: {
            maxRequests: previous.limits?.maxModelRequests ?? null,
            timeoutMs: previous.limits?.timeoutMs ?? null,
            maxOutputTokens: host.state.budgets.maxOutputTokens,
          },
        });
        if (host.state.status === "ready") {
          try {
            await host.open(host.state.askEachRead);
            await host.reloadSelected();
          } catch {
            host.update({
              connection: { ready: false, message: "Desktop runtime must be reopened" },
            });
          }
        }
        throw new BoundaryError(
          "Desktop settings could not be applied; existing conversations were retained",
        );
      }
      if (warning) throw new BoundaryError(warning);
      return;
    }
  },
});
