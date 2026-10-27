import { describe, expect, it } from "vitest";
import {
  approvalIdentity,
  createActionGate,
  createSnapshotReceiver,
  outcomeLabel,
  toolStateLabel,
} from "./view-state.ts";

describe("desktop view state", () => {
  it("keeps a pushed run state when the initial snapshot returns late", async () => {
    let resolve!: (value: string) => void;
    const observed: string[] = [];
    const receiver = createSnapshotReceiver<string>((value) => observed.push(value));
    const hydration = receiver.hydrate(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    receiver.receive("running");
    resolve("idle");
    await hydration;
    expect(observed).toEqual(["running"]);
  });

  it("ignores initial and pushed snapshots after a view is disposed", async () => {
    let resolve!: (value: string) => void;
    const observed: string[] = [];
    const receiver = createSnapshotReceiver<string>((value) => observed.push(value));
    const hydration = receiver.hydrate(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    receiver.dispose();
    receiver.receive("running");
    resolve("idle");
    await hydration;
    expect(observed).toEqual([]);
  });

  it("admits only one command until acknowledgement or failure releases its lock", () => {
    const gate = createActionGate();
    expect(gate.begin()).toBe(true);
    expect(gate.begin()).toBe(false);
    gate.end();
    expect(gate.begin()).toBe(true);
  });

  it("never treats an updated digest as the old approval", () => {
    expect(approvalIdentity({ effectId: "effect", digest: "before" })).not.toBe(
      approvalIdentity({ effectId: "effect", digest: "after" }),
    );
    expect(approvalIdentity({ effectId: "a:b", digest: "c" })).not.toBe(
      approvalIdentity({ effectId: "a", digest: "b:c" }),
    );
  });

  it("does not turn protocol completion or unknown effects into task success", () => {
    expect(outcomeLabel({ kind: "completed" })).toContain("核对");
    expect(outcomeLabel({ kind: "budget_exhausted" })).toContain("已经收到的内容");
    expect(toolStateLabel("unknown")).toBe("结果未知");
    expect(toolStateLabel("succeeded")).toBe("已返回");
  });
});
