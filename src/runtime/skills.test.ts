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
import { selectSkills } from "./skills.ts";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw Error("Missing test capability");
  return value;
}
const profile = { origin: { provider: "scripted", model: "test" } } as ModelProfile;
function setup(policy: PermissionPolicy = new ReadOnlyPolicy()) {
  const read = vi.fn<NodeWorkspaceFiles["readSkillDocument"]>(async (_context, name, guard) => {
    guard();
    return { path: `${name}/SKILL.md`, text: "synthetic", bytesRead: 9, truncated: false };
  });
  const controller = new AbortController();
  return {
    read,
    controller,
    collect: (
      sources: readonly ContextSource[],
      enabled: readonly string[] | undefined = ["test-skill"],
    ) =>
      collectContext(
        sources,
        { readSkillDocument: read } as unknown as NodeWorkspaceFiles,
        policy,
        "/workspace",
        profile,
        controller.signal,
        false,
        enabled === undefined ? undefined : { root: "/skills", enabled },
      ),
  };
}
const source = (collect: (input: ContextSourceInput) => Promise<void>): ContextSource => ({
  id: "test",
  async collect(input) {
    await collect(input);
    return [];
  },
});

describe("host-selected skill context capability", () => {
  it("copies and freezes selection; rejects invalid or excessive paths and names", () => {
    const config = { root: "/skills", enabled: ["test-skill"] };
    const selected = required(selectSkills(config));
    config.enabled.push("another");
    config.root = "/other";
    expect(selected).toEqual({ root: "/skills", enabled: ["test-skill"] });
    expect(Object.isFrozen(selected.enabled)).toBe(true);
    expect(selectSkills(undefined)).toBeUndefined();
    for (const bad of [
      { root: "relative", enabled: [] },
      { root: "/skills\0", enabled: [] },
      { root: "/skills", enabled: ["../escape"] },
      { root: "/skills", enabled: ["Test"] },
      { root: "/skills", enabled: ["x", "x"] },
      { root: "/skills", enabled: ["x".repeat(65)] },
      { root: "/skills", enabled: Array.from({ length: 9 }, (_, i) => `skill-${i}`) },
    ])
      expect(() => selectSkills(bad)).toThrow();
  });
  it("shares one immutable collection snapshot, refreshes later and expires retained ports", async () => {
    const t = setup();
    let saved: ContextSourceInput["skills"];
    const capture = source(async (input) => {
      saved = input.skills;
      const [a, b] = await Promise.all([
        required(saved).readEnabled(),
        required(saved).readEnabled(),
      ]);
      expect(a).toBe(b);
      expect(Object.isFrozen(a)).toBe(true);
      expect(Object.isFrozen(a[0])).toBe(true);
    });
    await t.collect([capture, capture]);
    expect(t.read).toHaveBeenCalledTimes(1);
    await expect(required(saved).readEnabled()).rejects.toThrow(/expired/);
    await t.collect([capture]);
    expect(t.read).toHaveBeenCalledTimes(2);
  });
  it.each(["ask", "deny", "missing", "throws", "invalid"])(
    "does no I/O with %s automatic-read policy",
    async (kind) => {
      const base = new ReadOnlyPolicy();
      const t = setup({
        beforePrepare: base.beforePrepare.bind(base),
        beforeExecute: base.beforeExecute.bind(base),
        ...(kind === "missing"
          ? {}
          : {
              beforeContextRead: () => {
                if (kind === "throws") throw Error("secret");
                return { kind } as ReturnType<NonNullable<PermissionPolicy["beforeContextRead"]>>;
              },
            }),
      });
      await t.collect([
        source(async (input) =>
          expect(await required(input.skills).readEnabled()).toEqual([
            { kind: "blocked", name: "test-skill" },
          ]),
        ),
      ]);
      expect(t.read).not.toHaveBeenCalled();
    },
  );
  it("requires the ordinary read prepare policy as well", async () => {
    const t = setup({
      beforeContextRead: () => ({ kind: "allow" }),
      beforePrepare: () => ({ kind: "ask" }),
      beforeExecute: () => ({ kind: "allow" }),
    });
    await t.collect([
      source(async (input) => {
        expect((await required(input.skills).readEnabled())[0]?.kind).toBe("blocked");
      }),
    ]);
    expect(t.read).not.toHaveBeenCalled();
  });
  it("passes actual absolute skill paths to policy", async () => {
    const base = new ReadOnlyPolicy();
    const paths: string[] = [];
    const t = setup({
      beforeContextRead: (path) => {
        paths.push(path);
        return { kind: "allow" };
      },
      beforePrepare: base.beforePrepare.bind(base),
      beforeExecute: base.beforeExecute.bind(base),
    });
    await t.collect([
      source(async (input) => {
        await required(input.skills).readEnabled();
      }),
    ]);
    expect(new Set(paths)).toEqual(new Set(["/skills/test-skill/SKILL.md"]));
  });
  it("fails after revoke-and-regrant during I/O", async () => {
    const policy = new ReadOnlyPolicy(),
      t = setup(policy);
    t.read.mockImplementation(async (_input, _name, guard) => {
      guard();
      policy.revoke();
      policy.grant();
      guard();
      throw Error("unreachable");
    });
    await expect(
      t.collect([
        source(async (input) => {
          await required(input.skills).readEnabled();
        }),
      ]),
    ).rejects.toThrow(/Cannot load selected/);
  });
  it("checks aggregate byte budget without truncating the selected set", async () => {
    const t = setup();
    t.read.mockImplementation(async (_input, name, guard) => {
      guard();
      return { path: `${name}/SKILL.md`, text: "x", bytesRead: 12 * 1024, truncated: false };
    });
    await expect(
      t.collect(
        [
          source(async (input) => {
            await required(input.skills).readEnabled();
          }),
        ],
        ["a", "b", "c", "d", "e"],
      ),
    ).rejects.toThrow(/48 KiB/);
  });
  it("cancellation or another source failure expires pending reads and redacts I/O errors", async () => {
    const t = setup();
    let saved: ContextSourceInput | undefined;
    await expect(
      t.collect([
        source(async (input) => {
          saved = input;
        }),
        source(async () => {
          throw Error("source failed");
        }),
      ]),
    ).rejects.toThrow("source failed");
    expect(required(saved).signal.aborted).toBe(true);
    await expect(required(required(saved).skills).readEnabled()).rejects.toThrow(/expired/);
    const t2 = setup();
    t2.read.mockImplementation(async (_input, _name, guard) => {
      t2.controller.abort();
      guard();
      throw Error("PRIVATE_IO_DETAIL");
    });
    await expect(
      t2.collect([
        source(async (input) => {
          await required(input.skills).readEnabled();
        }),
      ]),
    ).rejects.toThrow(/cancelled/);
    const t3 = setup();
    t3.read.mockRejectedValue(Error("PRIVATE_IO_DETAIL"));
    await expect(
      t3.collect([
        source(async (input) => {
          await required(input.skills).readEnabled();
        }),
      ]),
    ).rejects.toThrow(/^Cannot load selected SKILL.md safely:/);
  });
  it("empty enabled list withholds capability and performs no extra reads", async () => {
    const t = setup();
    await t.collect([source(async (input) => expect(input.skills).toBeUndefined())], []);
    expect(t.read).not.toHaveBeenCalled();
  });
});
