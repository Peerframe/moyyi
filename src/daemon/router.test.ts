import { describe, expect, it } from "vitest";
import type {
  ClientCommand,
  EffectId,
  EffectRecord,
  RunId,
  RuntimeEvent,
  SessionId,
  TranscriptEntry,
} from "../contracts/index.ts";
import { EventRouter } from "./router.ts";

const s1 = "session_1" as SessionId;
const s2 = "session_2" as SessionId;
const run = "run_1" as RunId;
const effectId = "effect_1" as EffectId;
const entry = (sessionId: SessionId) =>
  ({ type: "entry.appended", entry: { sessionId } as TranscriptEntry }) as RuntimeEvent;
const effect = {
  type: "effect.updated",
  effect: { id: effectId, runId: run } as EffectRecord,
} as const;

function reply(
  router: EventRouter,
  client: number,
  command: ClientCommand,
  events: RuntimeEvent[],
) {
  router.begin(client, command);
  try {
    return events.map((event) => router.route(event));
  } finally {
    router.end(client);
  }
}

function setup() {
  const router = new EventRouter();
  router.add(1);
  router.add(2);
  reply(router, 1, { type: "session.create", workspaceRoot: "/w" }, [
    { type: "session.ready", sessionId: s1 },
  ]);
  return router;
}

describe("daemon event routing", () => {
  it("sends command replies only to the sender and records what it views", () => {
    const router = new EventRouter();
    router.add(1);
    router.add(2);
    expect(
      reply(router, 1, { type: "session.create", workspaceRoot: "/w" }, [
        { type: "session.ready", sessionId: s1 },
      ]),
    ).toEqual([[1]]);
    expect(
      reply(router, 2, { type: "session.list" }, [
        { type: "session.listed", page: {} as never },
        { type: "command.rejected", command: "session.list", reason: "busy" },
      ]),
    ).toEqual([[2], [2]]);
    expect(router.route({ type: "session.ready", sessionId: s2 })).toEqual([]);
    expect(router.route(entry(s1))).toEqual([1]);
  });

  it("keeps replayed history with the loading client and routes later events to all viewers", () => {
    const router = setup();
    expect(
      reply(router, 2, { type: "session.load", sessionId: s1 }, [
        { type: "session.ready", sessionId: s1 },
        entry(s1),
      ]),
    ).toEqual([[2], [2]]);
    expect(router.route(entry(s1))).toEqual([1, 2]);
    expect(router.route(entry(s2))).toEqual([]);
  });

  it("routes run, effect and approval events by the run's session and forgets finished runs", () => {
    const router = setup();
    expect(
      reply(router, 1, { type: "run.start", sessionId: s1, input: [] }, [
        { type: "run.started", runId: run, sessionId: s1 },
      ]),
    ).toEqual([[1]]);
    expect(router.route({ type: "assistant.delta", runId: run, text: "x" })).toEqual([1]);
    expect(router.route(effect)).toEqual([1]);
    expect(
      router.route({ type: "approval.requested", effectId, digest: "d" as never, summary: "s" }),
    ).toEqual([1]);
    expect(
      router.route({ type: "run.finished", runId: run, outcome: { kind: "completed" } }),
    ).toEqual([1]);
    expect(router.route({ type: "assistant.delta", runId: run, text: "late" })).toEqual([]);
    expect(router.remove(1)).toEqual([]);
  });

  it("shows an unattributable approval to everyone instead of leaving it unseen", () => {
    const router = setup();
    expect(
      router.route({ type: "approval.requested", effectId, digest: "d" as never, summary: "s" }),
    ).toEqual([1, 2]);
    expect(router.route({ type: "plugin.status", name: "fs", state: "loaded" })).toEqual([1, 2]);
  });

  it("returns the active runs a disconnecting client started", () => {
    const router = setup();
    reply(router, 1, { type: "run.start", sessionId: s1, input: [] }, [
      { type: "run.started", runId: run, sessionId: s1 },
    ]);
    expect(router.remove(2)).toEqual([]);
    expect(router.remove(1)).toEqual([run]);
    expect(router.clients).toEqual([]);
  });

  it("refuses overlapping commands", () => {
    const router = setup();
    router.begin(1, { type: "session.list" });
    expect(() => router.begin(2, { type: "session.list" })).toThrow("serialized");
  });
});
