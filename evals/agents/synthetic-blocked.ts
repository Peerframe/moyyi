import { UNKNOWN_USAGE } from "../../src/contracts/index.ts";
import { scriptedProfile } from "../../src/plugins/provider-scripted/index.ts";
import type { RuntimeEvalHost } from "./moyyi.ts";

/** CLI wiring smoke host. It solves no tasks, reads no credentials and performs no I/O. */
const host: RuntimeEvalHost = {
  source: "synthetic",
  profile: scriptedProfile,
  createClient: () => ({
    async *stream() {
      yield {
        type: "part_completed",
        index: 0,
        part: {
          type: "text",
          text: '{"status":"blocked","summary":"This synthetic smoke host does not solve tasks."}',
        },
      };
      yield {
        type: "completed",
        stopReason: "end_turn",
        providerStopReason: null,
        usage: UNKNOWN_USAGE,
      };
    },
  }),
};
export default host;
