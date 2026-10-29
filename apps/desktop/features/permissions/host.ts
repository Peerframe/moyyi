import { BoundaryError, defineHostFeature } from "../../host/feature.ts";
import { commandTypes, stateKeys } from "./contract.ts";

export const hostFeature = defineHostFeature({
  id: "permissions",
  stateKeys,
  commands: commandTypes,
  async handle(host, command) {
    if (command.type === "permissions") {
      host.selected(command.sessionId);
      host.transition("permissions.reconfiguring", {
        permissions: { writes: false, checks: false },
      });
      try {
        await host.open(
          host.state.askEachRead,
          null,
          {
            writes: command.writes,
            checks: command.checks,
          },
          host.state.webAccess,
        );
        await host.reloadSelected();
      } catch {
        host.update({ permissions: { writes: false, checks: false } });
        if (host.state.status === "ready") {
          await host.open(host.state.askEachRead);
          await host.reloadSelected();
        }
        throw new BoundaryError(
          "Desktop permissions could not be enabled; no effect permissions were retained",
        );
      }
      return;
    }
  },
});
