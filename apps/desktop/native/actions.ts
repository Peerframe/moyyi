import type { DesktopCommand } from "../shared.ts";
import type { FeatureContract } from "./contract.ts";
import { featureContracts } from "./contracts.ts";

export function collectRendererActions(features: readonly FeatureContract[]) {
  const commands = new Set<DesktopCommand["type"]>();
  const actions = new Set<DesktopCommand["type"]>();
  for (const feature of features) {
    for (const type of feature.commands) {
      if (commands.has(type)) throw Error(`Duplicate desktop command: ${type}`);
      commands.add(type);
    }
    for (const type of feature.actions) {
      if (!feature.commands.includes(type)) throw Error(`Unowned desktop action: ${type}`);
      if (actions.has(type)) throw Error(`Duplicate desktop action: ${type}`);
      actions.add(type);
    }
  }
  return actions;
}
export const rendererActions = collectRendererActions(featureContracts);
