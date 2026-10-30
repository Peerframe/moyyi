import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  canonicalizeJson,
  type ModelStreamEvent,
  type RuntimeEvent,
  type ToolCallPart,
  UNKNOWN_USAGE,
} from "../contracts/index.ts";
import { scriptedProvider } from "../plugins/provider-scripted/index.ts";
import { ReadOnlyPolicy } from "../policy/index.ts";
import { SqliteSessionStore } from "../store/index.ts";
import {
  createRuntime,
  type Runtime,
  type RuntimeOptions,
  type SkillLibraryAccess,
} from "./index.ts";

const resources: { runtime: Runtime; store: SqliteSessionStore; directory: string }[] = [];
afterEach(async () => {
  for (const { runtime, store, directory } of resources.splice(0)) {
    await runtime.close();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const text =
  "---\nname: report-style\ndescription: Use the fixed report headings.\nallowed-tools: shell\n---\nInclude Evidence and Verification headings. Do not run referenced scripts.";
const entry = {
  name: "report-style",
  description: "Use the fixed report headings.",
  sha256: digest(text),
};
const completed: Extract<ModelStreamEvent, { type: "completed" }> = {
  type: "completed",
  stopReason: "end_turn",
  providerStopReason: null,
  usage: UNKNOWN_USAGE,
};
function answer(): ModelStreamEvent[] {
  return [{ type: "part_completed", index: 0, part: { type: "text", text: "Done." } }, completed];
}
function readSkill(): ModelStreamEvent[] {
  const call: ToolCallPart = {
    type: "tool_call",
    callId: "skill-call" as ToolCallPart["callId"],
    providerCallId: "skill-call",
    providerItemId: null,
    name: "read_skill",
    rawArguments: '{"name":"report-style"}',
    argumentsSource: "verbatim",
  };
  return [
    { type: "part_completed", index: 0, part: call },
    { ...completed, type: "completed", stopReason: "tool_use" },
  ];
}
async function fixture(
  responses: readonly ModelStreamEvent[][],
  options: Partial<RuntimeOptions> = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "moyyi-personal-skills-")),
    workspace = join(directory, "workspace");
  mkdirSync(workspace);
  writeFileSync(join(workspace, "AGENTS.md"), "Project instructions: keep source evidence.");
  const store = new SqliteSessionStore(join(directory, "store")),
    scripted = scriptedProvider(responses),
    events: RuntimeEvent[] = [];
  const runtime = await createRuntime({
    ...options,
    store,
    model: { provider: "scripted", model: "scripted" },
    plugins: [{ plugin: scripted.plugin }],
    limits: { maxModelRequests: 4, maxRetries: 0 },
  });
  resources.push({ directory, store, runtime });
  runtime.subscribe((event) => events.push(event));
  await runtime.send({ type: "session.create", workspaceRoot: workspace });
  const ready = events.find((event) => event.type === "session.ready");
  if (ready?.type !== "session.ready") throw Error("Missing session");
  const sessionId = ready.sessionId;
  return {
    store,
    runtime,
    scripted,
    events,
    sessionId,
    async run() {
      await runtime.send({
        type: "run.start",
        sessionId,
        input: [{ type: "text", text: "Write the report using current guidance." }],
      });
      await runtime.idle();
      return events.findLast((event) => event.type === "run.finished");
    },
  };
}
describe("trusted personal instructions and skill library integration", () => {
  it("places personal guidance after defaults and before project rules, refreshing only future requests", async () => {
    let personal = "Personal instruction: answer in concise prose.";
    const test = await fixture([answer(), answer()], {
      personalInstructions: async () => ({ text: personal, sha256: digest(personal) }),
    });
    await test.run();
    const first = test.scripted.client.requests[0];
    if (!first) throw Error("Missing request");
    const before = canonicalizeJson(first),
      system = canonicalizeJson(first.system);
    expect(system.indexOf("You are moyyi")).toBeLessThan(system.indexOf("Personal instruction:"));
    expect(system.indexOf("Personal instruction:")).toBeLessThan(
      system.indexOf("Project instructions:"),
    );
    expect(system).toContain(digest(personal));
    personal = "Personal instruction: show one example.";
    await test.run();
    expect(canonicalizeJson(test.scripted.client.requests[1])).toContain(personal);
    expect(canonicalizeJson(first)).toBe(before);
    const snapshot = await test.store.loadSession(test.sessionId);
    const recorded = snapshot?.entries.find(
      (record) => record.body.kind === "assistant_message",
    )?.body;
    if (recorded?.kind !== "assistant_message") throw Error("Missing recorded request");
    const bytes = await test.store.getBlob(recorded.request.system);
    if (!bytes) throw Error("Missing blob");
    expect(new TextDecoder().decode(bytes)).toContain("answer in concise prose");
    expect(new TextDecoder().decode(bytes)).not.toContain("show one example");
  });
  it("rejects a personal source hash mismatch before making a model request", async () => {
    const test = await fixture([answer()], {
      personalInstructions: async () => ({ text: "Unverified text", sha256: "a".repeat(64) }),
    });
    expect(await test.run()).toMatchObject({ outcome: { kind: "failed" } });
    expect(test.scripted.client.requests).toHaveLength(0);
  });
  it("loads only the enabled immutable version, records it, and puts the catalog after history", async () => {
    const read = vi.fn<SkillLibraryAccess["read"]>(async () => ({ text, sha256: entry.sha256 }));
    const test = await fixture([readSkill(), answer()], {
      skillLibrary: { list: async () => [entry], read },
    });
    expect(await test.run()).toMatchObject({ outcome: { kind: "completed" } });
    expect(read).toHaveBeenCalledTimes(1);
    const first = test.scripted.client.requests[0];
    if (!first) throw Error("Missing request");
    expect(canonicalizeJson(first.system)).not.toContain("Current enabled skill catalog");
    expect(canonicalizeJson(first.messages.at(-1))).toContain("Current enabled skill catalog");
    expect(canonicalizeJson(first.messages)).not.toContain(
      "Include Evidence and Verification headings.",
    );
    const next = test.scripted.client.requests[1];
    if (!next) throw Error("Missing continuation");
    const results = next.messages
      .flatMap((message) => message.content)
      .filter((part) => part.type === "tool_result");
    expect(canonicalizeJson(results)).toContain("Include Evidence and Verification headings.");
    expect(canonicalizeJson(results)).toContain(entry.sha256);
    const snapshot = await test.store.loadSession(test.sessionId);
    expect(
      snapshot?.entries.find((record) => record.body.kind === "tool_results")?.body,
    ).toMatchObject({ results: [{ status: "succeeded" }] });
  });
  it("does not expose library tools or catalog without explicit host configuration", async () => {
    const test = await fixture([answer()]);
    await test.run();
    expect(test.scripted.client.requests[0]?.tools.some((tool) => tool.name === "read_skill")).toBe(
      false,
    );
    expect(canonicalizeJson(test.scripted.client.requests[0])).not.toContain(
      "Current enabled skill catalog",
    );
  });
  it.each(["deny", "ask"] as const)(
    "never reads skill bodies when the read policy is %s",
    async (mode) => {
      const read = vi.fn<SkillLibraryAccess["read"]>(async () => ({ text, sha256: entry.sha256 }));
      const policy = new ReadOnlyPolicy(
        mode === "deny" ? { readAllowed: false } : { requireApproval: ["read_skill"] },
      );
      const test = await fixture([readSkill(), answer()], {
        policy,
        skillLibrary: { list: async () => [entry], read },
      });
      if (mode === "ask")
        test.runtime.subscribe((event) => {
          if (event.type === "approval.requested")
            void test.runtime.send({
              type: "approval.respond",
              effectId: event.effectId,
              digest: event.digest,
              decision: "deny",
            });
        });
      await test.run();
      expect(read).not.toHaveBeenCalled();
      const snapshot = await test.store.loadSession(test.sessionId);
      expect(
        snapshot?.entries.find((record) => record.body.kind === "tool_results")?.body,
      ).toMatchObject({ results: [{ status: "denied" }] });
    },
  );
  it("revalidates hashes and the existing Skill parser before returning content", async () => {
    for (const body of ["Invalid SKILL.md body", text]) {
      const selected = { ...entry, sha256: body === text ? "b".repeat(64) : digest(body) };
      const test = await fixture([readSkill(), answer()], {
        skillLibrary: {
          list: async () => [selected],
          read: async () => ({ text: body, sha256: selected.sha256 }),
        },
      });
      await test.run();
      const results = (await test.store.loadSession(test.sessionId))?.entries.find(
        (record) => record.body.kind === "tool_results",
      )?.body;
      expect(results).toMatchObject({ results: [{ status: "failed" }] });
      expect(canonicalizeJson(results)).not.toContain("Invalid SKILL.md body");
    }
  });
  it("does not return an enabled body revoked while its reader is running", async () => {
    let enabled = true;
    const test = await fixture([readSkill(), answer()], {
      skillLibrary: {
        list: async () => (enabled ? [entry] : []),
        read: async () => {
          enabled = false;
          return { text, sha256: entry.sha256 };
        },
      },
    });
    await test.run();
    const next = test.scripted.client.requests[1];
    if (!next) throw Error("Missing next request");
    expect(canonicalizeJson(next)).toContain("No skills are currently enabled");
    expect(canonicalizeJson(next)).not.toContain("Include Evidence and Verification headings.");
  });
  it("keeps the verified source immutable across the final enabled-version check", async () => {
    const source = { text, sha256: entry.sha256 };
    let readStarted = false;
    const test = await fixture([readSkill(), answer()], {
      skillLibrary: {
        list: async () => {
          if (readStarted) source.text = "UNVERIFIED_MUTATION";
          return [entry];
        },
        read: async () => {
          readStarted = true;
          return source;
        },
      },
    });
    await test.run();
    expect(canonicalizeJson(test.scripted.client.requests[1])).toContain(
      "Include Evidence and Verification headings.",
    );
    expect(canonicalizeJson(test.scripted.client.requests[1])).not.toContain("UNVERIFIED_MUTATION");
  });
  it("records cancellation and withholds a late skill body", async () => {
    const entered = Promise.withResolvers<void>();
    const test = await fixture([readSkill(), answer()], {
      skillLibrary: {
        list: async () => [entry],
        read: async (_name, _sha256, signal) => {
          entered.resolve();
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true }),
          );
          return { text, sha256: entry.sha256 };
        },
      },
    });
    const running = test.run();
    await entered.promise;
    const started = test.events.find((event) => event.type === "run.started");
    if (started?.type !== "run.started") throw Error("Missing run");
    await test.runtime.send({ type: "run.cancel", runId: started.runId });
    expect(await running).toMatchObject({ outcome: { kind: "cancelled" } });
    expect(test.scripted.client.requests).toHaveLength(1);
    const snapshot = await test.store.loadSession(test.sessionId);
    const results = snapshot?.entries.find((record) => record.body.kind === "tool_results")?.body;
    // An already executing read is durably failed; the run itself is cancelled.
    expect(results).toMatchObject({ results: [{ status: "failed" }] });
    expect(canonicalizeJson(results)).not.toContain("Include Evidence and Verification headings.");
  });
});
