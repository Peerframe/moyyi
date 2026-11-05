import { describe, expect, it } from "vitest";
import type { EffectId, EffectRecord, RunId, SessionId } from "../contracts/index.ts";
import { SessionApprovals } from "./session-approvals.ts";

const ask = { kind: "ask" } as const;
const allow = { kind: "allow" } as const;
const deny = { kind: "deny", reason: "no grant" } as const;

function tracked() {
  const approvals = new SessionApprovals();
  let n = 0;
  const start = (session: string) => {
    const runId = `run_${++n}` as RunId;
    approvals.observe({ type: "run.started", runId, sessionId: session as SessionId });
    return runId;
  };
  const effect = (runId: RunId) => {
    const id = `effect_${++n}` as EffectId;
    approvals.observe({ type: "effect.updated", effect: { id, runId } as EffectRecord });
    return id;
  };
  return { approvals, start, effect };
}

describe("session-scoped approvals", () => {
  it("remembers a whole tool, or one exact shell command, for its session only", () => {
    const { approvals, start, effect } = tracked();
    const run = start("s1");
    const edit = effect(run);
    expect(approvals.lift(ask, "edit", edit, { path: "a.txt" })).toEqual(ask);
    expect(approvals.remember(edit)).toEqual({ tool: "edit" });
    expect(approvals.lift(ask, "edit", effect(run), { path: "b.txt" })).toEqual(allow);
    const test = effect(run);
    expect(approvals.lift(ask, "shell", test, { command: "npm test" })).toEqual(ask);
    expect(approvals.remember(test)).toEqual({ tool: "shell", command: "npm test" });
    expect(approvals.lift(ask, "shell", effect(run), { command: "npm test" })).toEqual(allow);
    expect(approvals.lift(ask, "shell", effect(run), { command: "npm test; rm -rf ." })).toEqual(
      ask,
    );
    expect(approvals.lift(ask, "edit", effect(start("s2")), { path: "a.txt" })).toEqual(ask);
  });

  it("never overrides a denial or an allow, and never remembers an unattributed call", () => {
    const { approvals, start, effect } = tracked();
    const run = start("s1");
    const edit = effect(run);
    approvals.lift(ask, "edit", edit, {});
    approvals.remember(edit);
    expect(approvals.lift(deny, "edit", effect(run), {})).toEqual(deny);
    expect(approvals.lift(allow, "write", effect(run), {})).toEqual(allow);
    const orphan = "effect_x" as EffectId;
    approvals.lift(ask, "edit", orphan, {});
    expect(approvals.remember(orphan)).toBeUndefined();
    const shell = effect(run);
    expect(approvals.lift(ask, "shell", shell, {})).toEqual(ask);
    expect(approvals.remember(shell)).toBeUndefined();
  });

  it("forgets rules when the session is loaded again", () => {
    const { approvals, start, effect } = tracked();
    const run = start("s1");
    const edit = effect(run);
    approvals.lift(ask, "edit", edit, {});
    approvals.remember(edit);
    expect(approvals.rules("s1" as SessionId)).toEqual([{ tool: "edit" }]);
    approvals.forget("s1" as SessionId);
    expect(approvals.lift(ask, "edit", effect(run), {})).toEqual(ask);
  });
});
