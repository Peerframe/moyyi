import type { AgentUnderTest } from "../harness/types.ts";

/** Does nothing and claims nothing. The floor every task must fail. */
export const nullAgent: AgentUnderTest = {
  name: "null",
  async run() {
    return { claimedSuccess: null };
  },
};
