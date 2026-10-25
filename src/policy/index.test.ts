import { describe, expect, it } from "vitest";
import type { ActionDigest, EffectId, EffectProfile, PreparedAction } from "../contracts/index.ts";
import { ReadOnlyPolicy, WorkspaceProcessPolicy } from "./index.ts";

const profile: EffectProfile = { class: "read", reversibility: "none", verification: "none" };
const action: PreparedAction = {
  digest: "sha256:test" as ActionDigest,
  summary: "Read",
  preconditions: [],
  payload: {},
};
const effect = "eff_test" as EffectId;

describe("ReadOnlyPolicy", () => {
  it("allows reads by default in both phases", () => {
    const policy = new ReadOnlyPolicy();
    expect(policy.beforePrepare("read", profile, {})).toEqual({ kind: "allow" });
    expect(policy.beforeExecute("read", profile, action, effect)).toEqual({ kind: "allow" });
  });
  it.each(["workspace_write", "process", "external"] as const)("always denies %s", (kind) => {
    const policy = new ReadOnlyPolicy({ requireApproval: ["tool"] });
    policy.grant();
    const candidate = { ...profile, class: kind };
    expect(policy.beforePrepare("tool", candidate, {})).toMatchObject({ kind: "deny" });
    expect(policy.beforeExecute("tool", candidate, action, effect)).toMatchObject({ kind: "deny" });
  });
  it("rechecks revocation and changes the revision even on repeated grants", () => {
    const policy = new ReadOnlyPolicy();
    expect(policy.revision()).toBe(0);
    policy.revoke();
    expect(policy.revision()).toBe(1);
    expect(policy.beforeExecute("read", profile, action, effect)).toMatchObject({ kind: "deny" });
    policy.grant();
    policy.grant();
    expect(policy.revision()).toBe(3);
    expect(policy.beforePrepare("read", profile, {})).toEqual({ kind: "allow" });
  });
  it("can start revoked and asks for configured tools only within the read grant", () => {
    const names = ["sensitive-read"];
    const policy = new ReadOnlyPolicy({ readAllowed: false, requireApproval: names });
    expect(policy.beforePrepare("sensitive-read", profile, {})).toMatchObject({ kind: "deny" });
    policy.grant();
    names.length = 0;
    expect(policy.beforePrepare("sensitive-read", profile, {})).toEqual({ kind: "allow" });
    expect(policy.beforeExecute("sensitive-read", profile, action, effect)).toEqual({
      kind: "ask",
    });
    expect(policy.beforePrepare("read", profile, { grant: "external" })).toEqual({ kind: "allow" });
  });
});

describe("WorkspaceProcessPolicy", () => {
  it("requires separate process authority and keeps file/external decisions independent", () => {
    const policy = new WorkspaceProcessPolicy();
    const process = { class: "process", reversibility: "none", verification: "none" } as const;
    expect(policy.beforePrepare("shell", process, {})).toEqual({ kind: "allow" });
    expect(policy.beforeExecute("shell", process, action, effect)).toEqual({ kind: "ask" });
    expect(
      policy.beforePrepare("write", { ...process, class: "workspace_write" }, {}),
    ).toMatchObject({ kind: "deny" });
    expect(policy.beforePrepare("web", { ...process, class: "external" }, {})).toMatchObject({
      kind: "deny",
    });
    expect(
      policy.beforePrepare("dishonest", { ...process, reversibility: "snapshot" }, {}),
    ).toMatchObject({ kind: "deny" });
    policy.revoke();
    expect(policy.revision()).toBe(1);
    expect(policy.beforePrepare("shell", process, {})).toMatchObject({ kind: "deny" });
    policy.grant();
    expect(policy.revision()).toBe(2);
    expect(policy.beforeExecute("shell", process, action, effect)).toEqual({ kind: "ask" });
  });
});
