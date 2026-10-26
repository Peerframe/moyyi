import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";
import { documentSandbox } from "./document-sandbox.ts";

it("discovers a clean Node closure without inheriting host native addons or loader options", async () => {
  const scratch = await realpath(await mkdtemp(join(tmpdir(), "moyyi-document-closure-")));
  const hostReport = vi.spyOn(process.report, "getReport").mockImplementation(() => {
    throw Error("Host addon inventory must not authorize parser reads");
  });
  try {
    const plan = documentSandbox(
      fileURLToPath(new URL("./document-worker.ts", import.meta.url)),
      scratch,
    );
    expect(hostReport).not.toHaveBeenCalled();
    expect(plan.env).toMatchObject({ HOME: scratch, OPENSSL_CONF: "/dev/null" });
    expect(plan.env).not.toHaveProperty("NODE_OPTIONS");
    expect(plan.env).not.toHaveProperty("DEEPSEEK_API_KEY");
    expect(plan.args.at(-1)).toMatch(/document-worker\.ts$/u);
    expect(plan.args).not.toContain("/bin/sh");
  } finally {
    hostReport.mockRestore();
    await rm(scratch, { recursive: true, force: true });
  }
});
