import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { createCliSession } from "../src/cli/session.ts";
import { type ModelStreamEvent, UNKNOWN_USAGE } from "../src/contracts/index.ts";
import { scriptedProfile, scriptedProvider } from "../src/plugins/provider-scripted/index.ts";
import { createRuntime } from "../src/runtime/index.ts";

it("drives explicit compaction and continuation through the CLI and real runtime", async () => {
  const directory = mkdtempSync(join(tmpdir(), "moyyi-cli-compact-"));
  const workspace = join(directory, "workspace");
  mkdirSync(workspace);
  const answer = (text: string): ModelStreamEvent[] => [
    { type: "part_completed", index: 0, part: { type: "text", text } },
    { type: "completed", stopReason: "end_turn", providerStopReason: null, usage: UNKNOWN_USAGE },
  ];
  const provider = scriptedProvider([
    ...Array.from({ length: 4 }, () => answer("Recorded context. ".repeat(100))),
    answer("Keep the project codename LANTERN."),
    answer("Continuation received."),
  ]);
  const runtime = await createRuntime({
    dataDirectory: join(directory, "data"),
    model: scriptedProfile.origin,
    plugins: [{ plugin: provider.plugin }],
  });
  let output = "";
  const cli = createCliSession(runtime, {
    workspaceRoot: workspace,
    interactive: true,
    prompt() {},
    write(text) {
      output += text;
    },
  });
  try {
    await cli.start();
    for (let i = 0; i < 4; i++) {
      await cli.line(`Turn ${i}: LANTERN. ${"Source detail. ".repeat(100)}`);
      await runtime.idle();
    }
    await cli.line("/compact");
    await runtime.idle();
    expect(output).toContain("compaction audit | Summary request recorded (end_turn).");
    expect(output).toContain("context summary | Keep the project codename LANTERN.");
    expect(output).not.toContain("assistant | Keep the project codename LANTERN.");
    expect(provider.client.requests.at(-1)?.tools).toEqual([]);
    await cli.line("Continue.");
    await runtime.idle();
    expect(JSON.stringify(provider.client.requests.at(-1))).toContain(
      "Keep the project codename LANTERN.",
    );
    expect(output).toContain("assistant | Continuation received.");
    await cli.line("/exit");
    expect(await cli.done).toBe(0);
  } finally {
    await runtime.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
