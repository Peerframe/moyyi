import {
  createDeepSeekClient,
  deepSeekProfile,
} from "../../src/plugins/provider-deepseek/index.ts";
import {
  type DeepSeekHttpOptions,
  deepSeekHttpTransport,
} from "../../src/runtime/deepseek-http.ts";
import type { RuntimeEvalHost } from "./moyyi.ts";

/** Repository-source host helper. Construction does not read a key or perform an HTTP request. */
export function deepSeekEvalHost(options: DeepSeekHttpOptions): RuntimeEvalHost {
  return {
    source: "live",
    profile: deepSeekProfile,
    createClient: () => createDeepSeekClient(deepSeekHttpTransport(options)),
  };
}
