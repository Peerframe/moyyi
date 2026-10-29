import type { RuntimeEvent } from "moyyi/contracts";
import { describe, expect, it, vi } from "vitest";
import type { DesktopCommand, DesktopState } from "../shared.ts";
import { commandValidators } from "./command-registry.ts";
import { defineHostFeature, type HostContext, type HostFeature, HostFeatures } from "./feature.ts";
import { hostFeatures } from "./feature-registry.ts";

const context = () => ({ update: vi.fn() }) as unknown as HostContext;
const feature = (id: string, overrides: Partial<HostFeature> = {}): HostFeature => ({
  id,
  commands: [],
  handle: async () => {},
  ...overrides,
});
describe("desktop host feature ownership", () => {
  it("rejects duplicate feature, action and state ownership at composition", () => {
    expect(() => new HostFeatures([feature("a"), feature("a")])).toThrow(
      "Duplicate desktop feature",
    );
    expect(
      () =>
        new HostFeatures([
          feature("a", { commands: ["start"] }),
          feature("b", { commands: ["start"] }),
        ]),
    ).toThrow("Duplicate desktop action");
    expect(
      () =>
        new HostFeatures([
          feature("a", { stateKeys: ["run"] }),
          feature("b", { stateKeys: ["run"] }),
        ]),
    ).toThrow("Duplicate desktop state owner");
  });
  it("routes an action to one owner and rejects unowned actions", async () => {
    const first = vi.fn(async () => {}),
      second = vi.fn(async () => {}),
      host = context();
    const registry = new HostFeatures([
      feature("a", { commands: ["cancel"], handle: first }),
      feature("b", { commands: ["start"], handle: second }),
    ]);
    await registry.action(host, { type: "cancel", runId: "run" });
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
    await expect(
      registry.action(host, { type: "unknown" } as unknown as DesktopCommand),
    ).rejects.toThrow("Unknown desktop action");
  });
  it("delivers an event to every interested module and scopes each state write", () => {
    const host = context(),
      first = vi.fn(),
      second = vi.fn(),
      unrelated = vi.fn();
    const registry = new HostFeatures([
      defineHostFeature({
        id: "run",
        stateKeys: ["run"],
        commands: [],
        events: ["run.started"],
        async handle() {},
        event(ctx) {
          first();
          ctx.update({ run: null });
        },
      }),
      defineHostFeature({
        id: "results",
        stateKeys: ["artifactPreview"],
        commands: [],
        events: ["run.started"],
        async handle() {},
        event(ctx) {
          second();
          ctx.update({ artifactPreview: null });
        },
      }),
      feature("unrelated", { events: ["plugin.status"], event: unrelated }),
    ]);
    registry.event(host, { type: "run.started" } as RuntimeEvent);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(unrelated).not.toHaveBeenCalled();
    expect(host.update).toHaveBeenNthCalledWith(1, { run: null });
    expect(host.update).toHaveBeenNthCalledWith(2, { artifactPreview: null });
  });
  it("rejects a foreign state patch even when an untyped adapter bypasses TypeScript", async () => {
    const host = context();
    const module = defineHostFeature({
      id: "run",
      stateKeys: ["run"],
      commands: ["cancel"],
      async handle(ctx) {
        const patch: Partial<DesktopState> = { permissions: { writes: true, checks: true } };
        ctx.update(patch);
      },
    });
    await expect(module.handle(host, { type: "cancel", runId: "run" })).rejects.toThrow(
      "cannot update desktop state permissions",
    );
    expect(host.update).not.toHaveBeenCalled();
  });
  it("gives every validated command its contract's single host owner", () => {
    const actual = hostFeatures.flatMap((module) =>
      module.commands.map((type) => [type, module.id]),
    );
    expect(new Set(actual.map(([type]) => type)).size).toBe(actual.length);
    expect(actual.map(([type]) => type).sort()).toEqual([...commandValidators.keys()].sort());
  });
});
