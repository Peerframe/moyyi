import {
  createDeepSeekClient,
  type DeepSeekOptions,
  type DeepSeekReasoningEffort,
  deepSeekApiProfile,
  deepSeekProfile,
  resolveDeepSeekReasoningEffort,
} from "../../src/plugins/provider-deepseek/index.ts";
import {
  type DeepSeekHttpOptions,
  deepSeekHttpTransport,
} from "../../src/runtime/deepseek-http.ts";
import type { RuntimeEvalHost } from "./moyyi.ts";

export interface DeepSeekEvalHostOptions extends DeepSeekHttpOptions, DeepSeekOptions {}

export interface DeepSeekEvalHost extends RuntimeEvalHost {
  readonly reasoningEffort: DeepSeekReasoningEffort;
  readonly apiProfile: string;
}

/** Repository-source host helper. Construction does not read a key or perform an HTTP request. */
export function deepSeekEvalHost(options: DeepSeekEvalHostOptions): DeepSeekEvalHost {
  // Capture the selected profile once; later host-object edits cannot change a trial's wire mode.
  const reasoningEffort = resolveDeepSeekReasoningEffort(options.reasoningEffort);
  const transport = deepSeekHttpTransport({
    getApiKey: options.getApiKey,
    ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
  });
  return {
    source: "live",
    profile: deepSeekProfile,
    reasoningEffort,
    apiProfile: deepSeekApiProfile(reasoningEffort),
    createClient: () => createDeepSeekClient(transport, { reasoningEffort }),
  };
}
