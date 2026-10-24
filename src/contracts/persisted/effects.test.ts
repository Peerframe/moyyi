import { describe, expect, it } from "vitest";
import { canTransition, type EffectState, effectTransitions, isTerminal } from "./effects.ts";

describe("effect journal transitions", () => {
  it("never allows an interrupted effect to start again", () => {
    // Recovery must reconcile, not replay: no path from `unknown` or `started` back to `started`.
    expect(canTransition("unknown", "started")).toBe(false);
    expect(canTransition("started", "started")).toBe(false);
    expect(canTransition("unknown", "approved")).toBe(false);
  });

  it("requires approval before start", () => {
    expect(canTransition("intended", "started")).toBe(false);
    expect(canTransition("awaiting_approval", "started")).toBe(false);
    expect(canTransition("approved", "started")).toBe(true);
  });

  it("cannot cancel an effect that has started", () => {
    expect(canTransition("started", "cancelled")).toBe(false);
  });

  it("has terminal states with no outgoing transitions", () => {
    const terminal = (Object.keys(effectTransitions) as EffectState[]).filter(isTerminal);
    expect(terminal.sort()).toEqual(["cancelled", "denied", "failed", "succeeded"]);
  });

  it("only targets known states", () => {
    const states = new Set(Object.keys(effectTransitions));
    for (const targets of Object.values(effectTransitions)) {
      for (const target of targets) expect(states.has(target)).toBe(true);
    }
  });
});
