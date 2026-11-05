import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type ModelRequest,
  type ModelStreamEvent,
  type PermissionPolicy,
  type RuntimeEvent,
  type SessionId,
  type ToolCallId,
  UNKNOWN_USAGE,
} from "../src/contracts/index.ts";
import { scriptedProfile, scriptedProvider } from "../src/plugins/provider-scripted/index.ts";
import { ReadOnlyPolicy } from "../src/policy/index.ts";
import { createRuntime, type RuntimeOptions } from "../src/runtime/index.ts";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const read = (id: string, path: string): ModelStreamEvent[] => [
  {
    type: "part_completed",
    index: 0,
    part: {
      type: "tool_call",
      callId: id as ToolCallId,
      providerCallId: id,
      providerItemId: null,
      name: "read",
      rawArguments: JSON.stringify({ path }),
      argumentsSource: "verbatim",
    },
  },
  { type: "completed", stopReason: "tool_use", providerStopReason: null, usage: UNKNOWN_USAGE },
];
const done: ModelStreamEvent[] = [
  { type: "part_completed", index: 0, part: { type: "text", text: "Done." } },
  { type: "completed", stopReason: "end_turn", providerStopReason: null, usage: UNKNOWN_USAGE },
];

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "moyyi-nested-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const w = join(root, "w");
  mkdirSync(join(w, "sub", "deep"), { recursive: true });
  mkdirSync(join(w, "other"));
  writeFileSync(join(w, "AGENTS.md"), "ROOT RULE\n");
  writeFileSync(join(w, "sub", "AGENTS.md"), "SUB RULE\n");
  writeFileSync(join(w, "sub", "deep", "AGENTS.md"), "DEEP RULE\n");
  writeFileSync(join(w, "sub", "deep", "file.ts"), "export const x = 1;\n");
  writeFileSync(join(w, "other", "AGENTS.md"), "OTHER RULE\n");
  return { root, w };
}

async function turn(
  w: string,
  root: string,
  responses: ModelStreamEvent[][],
  extra: Partial<RuntimeOptions> = {},
) {
  const provider = scriptedProvider(responses);
  const runtime = await createRuntime({
    model: scriptedProfile.origin,
    dataDirectory: join(root, "d"),
    plugins: [{ plugin: provider.plugin }],
    ...extra,
  });
  cleanups.push(() => runtime.close());
  const events: RuntimeEvent[] = [];
  runtime.subscribe((event) => events.push(event));
  await runtime.send({ type: "session.create", workspaceRoot: w });
  const { sessionId } = events.find((event) => event.type === "session.ready") as {
    sessionId: SessionId;
  };
  await runtime.send({ type: "run.start", sessionId, input: [{ type: "text", text: "Go" }] });
  await runtime.idle();
  return { requests: provider.client.requests, events };
}

const system = (request: ModelRequest | undefined) => JSON.stringify(request?.system ?? []);

describe("nested AGENTS.md", () => {
  it("adds the guidance of directories the session touched, from the next request on", async () => {
    const { root, w } = workspace();
    const { requests } = await turn(w, root, [read("c1", "sub/deep/file.ts"), done], {
      nestedInstructions: true,
    });
    expect(system(requests[0])).toContain("ROOT RULE");
    expect(system(requests[0])).not.toContain("SUB RULE");
    const second = system(requests[1]);
    expect(second).toContain("SUB RULE");
    expect(second).toContain("DEEP RULE");
    expect(second).toContain('\\"scope\\":\\"sub/deep\\"');
    expect(second).not.toContain("OTHER RULE");
    expect(second.indexOf("SUB RULE")).toBeLessThan(second.indexOf("DEEP RULE"));
  });

  it("loads nothing below the root unless enabled", async () => {
    const { root, w } = workspace();
    const { requests } = await turn(w, root, [read("c1", "sub/deep/file.ts"), done]);
    expect(system(requests[1])).toContain("ROOT RULE");
    expect(system(requests[1])).not.toContain("SUB RULE");
  });

  it("reports denied, aliased and oversized files as unavailable without their text", async () => {
    const { root, w } = workspace();
    writeFileSync(join(w, "sub", "deep", "AGENTS.md"), `${"x".repeat(17 * 1024)}DEEP RULE\n`);
    mkdirSync(join(root, "elsewhere"));
    writeFileSync(join(root, "elsewhere", "AGENTS.md"), "ALIAS RULE\n");
    writeFileSync(join(root, "elsewhere", "f.ts"), "x\n");
    symlinkSync(join(root, "elsewhere"), join(w, "linked"));
    const base = new ReadOnlyPolicy();
    const policy: PermissionPolicy = {
      revision: () => base.revision(),
      beforeContextRead: (path, operation) =>
        path === "other/AGENTS.md"
          ? { kind: "deny", reason: "denied" }
          : (base.beforeContextRead?.(path, operation) ?? { kind: "deny", reason: "no" }),
      beforePrepare: (tool, profile, args) => base.beforePrepare(tool, profile, args),
      beforeExecute: (tool, profile, action, effect, args) =>
        base.beforeExecute(tool, profile, action, effect, args),
    };
    writeFileSync(join(w, "other", "f.ts"), "x\n");
    const { requests } = await turn(
      w,
      root,
      [read("c1", "sub/deep/file.ts"), read("c2", "other/f.ts"), read("c3", "linked/f.ts"), done],
      { nestedInstructions: true, policy },
    );
    const last = system(requests.at(-1));
    expect(last).toContain("SUB RULE");
    expect(last).not.toContain("DEEP RULE");
    expect(last).not.toContain("OTHER RULE");
    expect(last).not.toContain("ALIAS RULE");
    for (const scope of ["sub/deep", "other", "linked"])
      expect(last).toContain(
        `\\"path\\":\\"${scope}/AGENTS.md\\",\\"scope\\":\\"${scope}\\",\\"unavailable\\"`,
      );
  });

  it("stops at eight files", async () => {
    const { root, w } = workspace();
    const reads: ModelStreamEvent[][] = [];
    for (let i = 0; i < 10; i++) {
      mkdirSync(join(w, `d${i}`));
      writeFileSync(join(w, `d${i}`, "AGENTS.md"), `RULE ${i}\n`);
      writeFileSync(join(w, `d${i}`, "f.ts"), "x\n");
      reads.push(read(`c${i}`, `d${i}/f.ts`));
    }
    const { requests } = await turn(w, root, [...reads, done], {
      nestedInstructions: true,
      limits: { maxModelRequests: 20 },
    });
    const last = system(requests.at(-1));
    expect(last).toContain("RULE 7");
    expect(last).not.toContain("RULE 8");
  });
});
