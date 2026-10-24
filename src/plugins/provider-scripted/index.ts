import type { ModelProfile, ModelStreamEvent, Plugin } from "../../contracts/index.ts";
import { ScriptedModelClient } from "./client.ts";

export { ScriptedModelClient } from "./client.ts";

export const scriptedProfile: ModelProfile = {
  origin: { provider: "scripted", model: "scripted" },
  contextWindowTokens: 200_000,
  maxOutputTokens: 8_000,
  parallelToolCalls: true,
  reasoning: "none",
  promptCache: "none",
  editFormat: "search_replace",
};

/**
 * Model provider for deterministic tests, evals and fault injection. Returns the client too,
 * so a test can inspect the requests the runtime sent.
 */
export function scriptedProvider(responses: readonly (readonly ModelStreamEvent[])[]): {
  plugin: Plugin;
  client: ScriptedModelClient;
} {
  const client = new ScriptedModelClient(responses);
  const plugin: Plugin = {
    name: "provider-scripted",
    apiVersion: 1,
    setup(host) {
      host.registerModelProvider({
        id: "scripted",
        models: [scriptedProfile],
        createClient: () => client,
      });
    },
  };
  return { plugin, client };
}
