import { describe, expect, it } from "vitest";
import type { PreparedAction, ProcessResult, RunId, ToolContext } from "../../contracts/index.ts";
import { shellTool } from "./index.ts";

const action = {} as PreparedAction;
const base: ToolContext = {
  runId: "run" as RunId,
  workspaceRoot: "/fixture",
  signal: new AbortController().signal,
  limits: { maxOutputBytes: 4096 },
};
describe("shell tool contract", () => {
  it("fails closed without a capability", async () => {
    await expect(shellTool.prepare({ command: "true" }, base)).rejects.toThrow("unavailable");
    await expect(shellTool.execute(action, base)).rejects.toThrow("unavailable");
  });
  it.each(["cancelled", "timeout", "revoked", "output_limit", "unknown"] as const)(
    "does not report %s as a known failure",
    async (termination) => {
      await expect(
        shellTool.execute(action, {
          ...base,
          processes: {
            prepare: async () => {
              throw Error("unused");
            },
            run: async () => ({ termination, exitCode: null, output: "partial", truncated: false }),
          },
        }),
      ).rejects.toThrow(termination);
    },
  );
  it.each([0, 7])("reports observed exit %s without retry", async (exitCode) => {
    const result: ProcessResult = {
      termination: "exited",
      exitCode,
      output: "hello",
      truncated: false,
    };
    const outcome = await shellTool.execute(action, {
      ...base,
      processes: {
        prepare: async () => {
          throw Error("unused");
        },
        run: async () => result,
      },
    });
    expect(outcome.status).toBe(exitCode === 0 ? "succeeded" : "failed");
  });
});
