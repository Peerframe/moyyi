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
} from "../../src/runtime/providers/deepseek-http.ts";
import type { RuntimeEvalHost } from "./moyyi.ts";

export interface DeepSeekEvalHostOptions
  extends DeepSeekHttpOptions,
    Omit<DeepSeekOptions, "reasoningEffort"> {
  /**
   * Required: an omitted effort used to fall back to `high`, silently spending a paid run on a
   * setting the daily default (`low`) never uses. Pass `high` explicitly to keep that profile.
   */
  readonly reasoningEffort: DeepSeekReasoningEffort;
}

export interface DeepSeekEvalHost extends RuntimeEvalHost {
  readonly reasoningEffort: DeepSeekReasoningEffort;
  readonly apiProfile: string;
}

/** Repository-source host helper. Construction does not read a key or perform an HTTP request. */
export function deepSeekEvalHost(options: DeepSeekEvalHostOptions): DeepSeekEvalHost {
  // Checked at runtime too, because private hosts are plain modules that may skip type checks.
  if ((options as { reasoningEffort?: unknown }).reasoningEffort === undefined)
    throw Error("DeepSeek eval hosts must set reasoningEffort explicitly (daily default: low)");
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
