import { describe, expect, it, vi } from "vitest";
import type { ModelProfile, SessionId, SessionSnapshot, Timestamp } from "../contracts/index.ts";
import { entries } from "../contracts/persisted/fixtures/v1.ts";
import { sessionFacts } from "./session-facts.ts";

describe("stable runtime facts", () => {
  it("uses the session's date, remains stable across turns and reopen, and identifies the actual model", async () => {
    const original = entries[0];
    if (!original) throw Error("missing fixture");
    const sessionId = "facts_session" as SessionId;
    const snapshot: SessionSnapshot = {
      sessionId,
      workspaceRoot: "/selected",
      headEntryId: original.id,
      entries: [{ ...original, createdAt: "2020-06-15T12:00:00Z" as Timestamp }],
      runs: [],
      effects: [],
      leases: [],
    };
    const store = { loadSession: vi.fn(async () => snapshot) };
    const clock = { now: vi.fn(() => "2026-10-29T00:00:00Z" as Timestamp) };
    const profile = { origin: { provider: "synthetic", model: "test" } } as ModelProfile;
    const collect = sessionFacts(store, clock);
    const first = await collect(sessionId, "/selected", profile);
    expect(first.stability).toBe("session");
    expect(first.content[0]?.text).toContain("2020");
    expect(first.content[0]?.text).toContain("Workspace: /selected");
    expect(first.content[0]?.text).toContain("Model: synthetic/test");
    expect(first.content[0]?.text).toContain("Time zone:");
    expect(first.content[0]?.text).toContain("Operating system:");
    expect(await collect(sessionId, "/selected", profile)).toBe(first);
    expect(store.loadSession).toHaveBeenCalledTimes(1);
    expect(clock.now).not.toHaveBeenCalled();
    expect(await sessionFacts(store, clock)(sessionId, "/selected", profile)).toEqual(first);
    expect(
      (
        await collect(sessionId, "/selected", {
          ...profile,
          origin: { provider: "synthetic", model: "other" },
        })
      ).content[0]?.text,
    ).toContain("Model: synthetic/other");
  });
});
