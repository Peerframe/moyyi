import { BoundaryError, defineHostFeature } from "../../host/feature.ts";
import { commandTypes, stateKeys } from "./contract.ts";

export const hostFeature = defineHostFeature({
  id: "settings",
  stateKeys,
  commands: commandTypes,
  async handle(host, command) {
    if (command.type === "configure") {
      if (!host.configure)
        throw new BoundaryError("Desktop settings cannot be changed by this host");
      const previous = host.options;
      const previousSettings = host.state.settings,
        previousConnection = host.state.connection;
      await host.runtime?.close();
      host.unsubscribe?.();
      host.runtime = undefined;
      host.transition("settings.reconfiguring", {});
      host.transition("settings.revoking", {});
      let saved = false;
      try {
        const configured = await host.configure(command.settings, command.apiKey);
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
      return;
    }
  },
});
