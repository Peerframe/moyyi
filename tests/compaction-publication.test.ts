import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  type ModelStreamEvent,
  type RuntimeEvent,
  type SessionId,
  type SessionStore,
  UNKNOWN_USAGE,
} from "../src/contracts/index.ts";
import { scriptedProfile, scriptedProvider } from "../src/plugins/provider-scripted/index.ts";
import { createRuntime, type Runtime } from "../src/runtime/index.ts";
import { SqliteSessionStore } from "../src/store/index.ts";

const response = (text: string): readonly ModelStreamEvent[] => [
  { type: "part_completed", index: 0, part: { type: "text", text } },
  { type: "completed", stopReason: "end_turn", providerStopReason: null, usage: UNKNOWN_USAGE },
];

it.each(
  (["cancel", "timeout"] as const).flatMap((action) =>
    (["summary", "committing", "committed"] as const).map((stage) => ({ action, stage })),
  ),
)("reports durable publication truthfully on $action at $stage", async ({ action, stage }) => {
  const root = mkdtempSync(join(tmpdir(), "moyyi-compaction-publication-"));
  const workspace = join(root, "workspace");
  mkdirSync(workspace);
  const backing = new SqliteSessionStore(join(root, "store"));
  const entered = Promise.withResolvers<void>(),
    release = Promise.withResolvers<void>();
  let expire = () => {};
  const store: SessionStore = {
    listSessions: () => backing.listSessions(),
    loadSession: (id) => backing.loadSession(id),
    unsettledEffects: () => backing.unsettledEffects(),
    putBlob: (bytes) => backing.putBlob(bytes),
    getBlob: (ref) => backing.getBlob(ref),
    async commit(batch) {
      const publishing = batch.entries.some((entry) => entry.body.kind === "compaction");
      if (publishing && stage === "committing") {
        entered.resolve();
        await release.promise;
      }
      await backing.commit(batch);
      if (publishing && stage === "committed") {
        entered.resolve();
        await release.promise;
      }
    },
  };
  const provider = scriptedProvider([
    ...Array.from({ length: 4 }, () => response("Synthetic history. ".repeat(200))),
    response("Retain all user constraints and the pending task."),
  ]);
  let runtime: Runtime | undefined;
  try {
    runtime = await createRuntime({
      store,
      model: scriptedProfile.origin,
      plugins: [{ plugin: provider.plugin }],
      scheduler: {
        sleep: async () => {},
        deadline: (_ms, callback) => {
          expire = callback;
          return () => {};
        },
      },
    });
    const events: RuntimeEvent[] = [];
    let sessionId: SessionId | undefined;
    runtime.subscribe((event) => {
      events.push(event);
      if (event.type === "session.ready") sessionId = event.sessionId;
    });
    await runtime.send({ type: "session.create", workspaceRoot: workspace });
    if (!sessionId) throw new Error("Missing fixture session");
    for (let turn = 0; turn < 4; turn++) {
      await runtime.send({
        type: "run.start",
        sessionId,
        input: [{ type: "text", text: `Question ${turn}: ${"context ".repeat(200)}` }],
      });
      await runtime.idle();
    }
    const before = await backing.loadSession(sessionId);
    if (!before) throw new Error("Missing fixture history");
    if (stage === "summary")
      provider.client.stream = async function* () {
        yield { type: "text_delta", index: 0, text: "Partial summary" };
        entered.resolve();
        await release.promise;
      };
    await runtime.send({ type: "session.compact", sessionId });
    await entered.promise;
    const run = events.findLast((event) => event.type === "run.started");
    if (!run) throw new Error("Missing compaction run");
    if (action === "cancel") await runtime.send({ type: "run.cancel", runId: run.runId });
    else expire();
    release.resolve();
    await runtime.idle();
    const after = await backing.loadSession(sessionId);
    if (!after) throw new Error("Lost compaction history");
    const published = stage !== "summary";
    const expected = published
      ? { kind: "completed" }
      : action === "cancel"
        ? { kind: "cancelled" }
        : { kind: "budget_exhausted", budget: "time" };
    expect(events.findLast((event) => event.type === "run.finished")?.outcome).toEqual(expected);
    expect(after.runs.find((record) => record.runId === run.runId)?.status).toBe(
      published ? "completed" : "interrupted",
    );
    expect(after.entries.filter((entry) => entry.body.kind === "compaction")).toHaveLength(
      published ? 1 : 0,
    );
    if (published) {
      const compact = after.entries.find((entry) => entry.body.kind === "compaction");
      expect(after.headEntryId).toBe(compact?.id);
      expect(after.headEntryId).not.toBe(before.headEntryId);
    } else expect(after.headEntryId).toBe(before.headEntryId);
    expect(after.entries.slice(0, before.entries.length)).toEqual(before.entries);
    expect(after.effects).toEqual([]);
    expect(after.leases).toEqual([]);
    expect(backing.diagnostics().integrity).toBe("ok");
  } finally {
    release.resolve();
    await runtime?.close();
    backing.close();
    rmSync(root, { recursive: true, force: true });
  }
});
