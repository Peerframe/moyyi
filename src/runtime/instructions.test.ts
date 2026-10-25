import { describe, expect, it, vi } from "vitest";
import type {
  ContextSource,
  ContextSourceInput,
  ModelProfile,
  PermissionPolicy,
} from "../contracts/index.ts";
import { ReadOnlyPolicy } from "../policy/index.ts";
import type { NodeWorkspaceFiles } from "./files.ts";
import { collectContext } from "./instructions.ts";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw Error("Missing test capability");
  return value;
}

const profile = { origin: { provider: "scripted", model: "test" } } as ModelProfile;
function setup(policy: PermissionPolicy = new ReadOnlyPolicy()) {
  const read = vi.fn<NodeWorkspaceFiles["readProjectInstructions"]>(async (_input, guard) => {
    guard();
    return { path: "AGENTS.md", text: "synthetic rules", bytesRead: 15, truncated: false };
  });
  const files = { readProjectInstructions: read } as unknown as NodeWorkspaceFiles;
  const controller = new AbortController();
  return {
    read,
    controller,
    collect: (sources: readonly ContextSource[], enabled = true) =>
      collectContext(sources, files, policy, "/synthetic", profile, controller.signal, enabled),
  };
}

describe("automatic context read lifetime", () => {
  it("shares one snapshot per collection and expires retained capabilities", async () => {
    const t = setup();
    let saved: ContextSourceInput["projectInstructions"];
    const source: ContextSource = {
      id: "capture",
      async collect(input) {
        saved = input.projectInstructions;
        const [first, second] = await Promise.all([
          required(saved).readRoot(),
          required(saved).readRoot(),
        ]);
        expect(first).toEqual(second);
        return [];
      },
    };
    await t.collect([source, source]);
    expect(t.read).toHaveBeenCalledTimes(1);
    await expect(required(saved).readRoot()).rejects.toThrow(/expired/);
    await t.collect([source]);
    expect(t.read).toHaveBeenCalledTimes(2);
  });

  it.each(["deny", "ask", "missing", "throws", "invalid"])(
    "does not read under %s policy",
    async (kind) => {
      const base = new ReadOnlyPolicy();
      const policy: PermissionPolicy = {
        beforePrepare: base.beforePrepare.bind(base),
        beforeExecute: base.beforeExecute.bind(base),
        ...(kind === "missing"
          ? {}
          : {
              beforeContextRead: () => {
                if (kind === "throws") throw Error("private host detail");
                return { kind } as ReturnType<NonNullable<PermissionPolicy["beforeContextRead"]>>;
              },
            }),
      };
      const t = setup(policy);
      await t.collect([
        {
          id: "capture",
          async collect(input) {
            expect(await required(input.projectInstructions).readRoot()).toEqual({
              kind: "blocked",
            });
            return [];
          },
        },
      ]);
      expect(t.read).not.toHaveBeenCalled();
    },
  );

  it("invalidates a read after revoke-and-regrant even when permission is currently allowed", async () => {
    const policy = new ReadOnlyPolicy();
    const t = setup(policy);
    t.read.mockImplementation(async (_input, guard) => {
      guard();
      policy.revoke();
      policy.grant();
      guard();
      return null;
    });
    await expect(
      t.collect([
        {
          id: "capture",
          async collect(input) {
            await required(input.projectInstructions).readRoot();
            return [];
          },
        },
      ]),
    ).rejects.toThrow(/Cannot load AGENTS.md safely/);
  });

  it("cancels collection even when a trusted source ignores the signal", async () => {
    const t = setup();
    const work = t.collect([{ id: "stuck", collect: () => new Promise(() => {}) }]);
    t.controller.abort();
    await expect(work).rejects.toThrow(/cancelled/);
  });

  it("expires other sources when one source throws synchronously", async () => {
    const t = setup();
    let input: ContextSourceInput | undefined;
    await expect(
      t.collect([
        {
          id: "capture",
          async collect(value) {
            input = value;
            return [];
          },
        },
        {
          id: "failure",
          collect() {
            throw Error("synthetic failure");
          },
        },
      ]),
    ).rejects.toThrow("synthetic failure");
    expect(required(input).signal.aborted).toBe(true);
    await expect(required(required(input).projectInstructions).readRoot()).rejects.toThrow(
      /expired/,
    );
  });

  it("withholds the capability on explicit opt-out", async () => {
    const t = setup();
    await t.collect(
      [
        {
          id: "capture",
          async collect(input) {
            expect(input.projectInstructions).toBeUndefined();
            return [];
          },
        },
      ],
      false,
    );
    expect(t.read).not.toHaveBeenCalled();
  });

  it("redacts file adapter errors", async () => {
    const t = setup();
    t.read.mockRejectedValue(Error("private host pathname"));
    try {
      await t.collect([
        {
          id: "capture",
          async collect(input) {
            await required(input.projectInstructions).readRoot();
            return [];
          },
        },
      ]);
      expect.fail("Expected safe failure");
    } catch (error) {
      expect(String(error)).toContain("Cannot load AGENTS.md safely");
      expect(String(error)).not.toContain("private host pathname");
    }
  });
});
