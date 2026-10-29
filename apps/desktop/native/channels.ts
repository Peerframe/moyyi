import type { IpcChannel } from "./contract.ts";
import { featureContracts } from "./contracts.ts";

/** The catalogue is shared by native registration and preload; duplicate names fail closed. */
export const channels = new Map<string, IpcChannel>();
const names = new Set<string>();
for (const feature of featureContracts) {
  for (const [method, channel] of Object.entries(feature.channels)) {
    if (channels.has(method) || names.has(channel.name))
      throw Error(`Duplicate desktop channel: ${method}`);
    channels.set(method, channel);
    names.add(channel.name);
  }
}
const state = channels.get("getState");
if (!state) throw Error("Missing desktop state channel");
export const stateChannel = state;
